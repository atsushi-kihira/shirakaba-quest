// =============================================================
// 紹介シートの取り込み・編集ダイアログ
//   1) 資料のファイル（PDF・画像・テキスト）を選ぶ → AIが10項目に読み取る
//   2) 読み取り結果を確認して、直したいところを直す
//   3) 保存（deferSave のときは、保存せずに内容だけ呼び出し元へ返す）
//   手動で入力することも、すでにある内容を直すこともできる
//   basics を渡すと「新しい外部人脈の登録」用になり、人脈の基本情報（名前・会社・専門分野など）も同じ画面で入力できる
// =============================================================
import { Fragment, useRef, useState, type ReactNode } from "react";
import { Loader2, FileUp, PenLine, Plus } from "lucide-react";
import { ApiError } from "@/lib/api";
import { DialogCloseButton } from "@/components/dialog-close-button";
import { useSettings } from "@/hooks/use-settings";
import type { ProfileSheet, ProfileSheetFields } from "@shared/types";
import {
  type ContactBasics, SHEET_FIELDS, SHEET_FILE_ACCEPT, SHEET_FILE_MAX_MB, combineFields, extractSheet, hasSheetContent, sheetToFields, tagsToText, textToTags, useSaveSheet,
} from "./profile-sheet-shared";

type Step = "choose" | "reading" | "edit";
/** 読み込み方：いまの内容に足す / いまの内容を消して読み込み直す */
type ReadMode = "add" | "reset";
/** 一度に読み込めるファイルの数 */
const MAX_FILES = 5;

type Props = {
  /** 相手。deferSave のときは、まだ存在しなくてもよい（name だけ使う） */
  subject: { type: "member" | "contact"; id: string | null; name: string };
  /** いま登録されているシート（編集・上書きのとき） */
  existing?: ProfileSheet | null;
  /** 1to1した日の初期値（1to1の完了のときなど） */
  defaultDate?: string;
  /** 最初から編集画面で始める（「編集」ボタンから） */
  startAtEdit?: boolean;
  /** 保存前の下書き（人脈をこれから作るとき、取り込み済みの内容をもう一度開く場合） */
  initialFields?: ProfileSheetFields | null;
  /** true なら、保存せずに、内容だけ onDone に返す（人脈をこれから作るとき） */
  deferSave?: boolean;
  /** 新しい外部人脈の登録用：人脈の基本情報の初期値と、その入力欄の描き方（呼び出し側が持つ入力部品を使うため） */
  basics?: { initial: ContactBasics; render: (b: ContactBasics, set: (patch: Partial<ContactBasics>) => void) => ReactNode };
  onClose: () => void;
  onDone: (fields: ProfileSheetFields, saved: ProfileSheet | null, basics?: ContactBasics) => void;
};

const inputStyle = { background: "var(--color-paper-100)", border: "1px solid var(--color-paper-300)", color: "var(--color-ink-800)" } as const;

export function ProfileSheetImportModal({ subject, existing, defaultDate, startAtEdit, deferSave, initialFields, basics, onClose, onDone }: Props) {
  const save = useSaveSheet();
  const { termSheetMemo } = useSettings();
  const contactMode = !!basics;
  const [basicsState, setBasicsState] = useState<ContactBasics | null>(basics?.initial ?? null);
  const setBasics = (patch: Partial<ContactBasics>) => setBasicsState((b) => (b ? { ...b, ...patch } : b));
  /** 相手の名前（新しい人脈のときは、入力中の名前） */
  const subjectName = basicsState ? basicsState.name : subject.name;
  const fileRef = useRef<HTMLInputElement>(null);
  const initial = initialFields ?? sheetToFields(existing, subjectName);
  const [step, setStep] = useState<Step>(startAtEdit || initialFields ? "edit" : "choose");
  const [fields, setFields] = useState<ProfileSheetFields>(() => ({
    ...initial, oneononeDate: initial.oneononeDate || defaultDate || "",
  }));
  const [tagText, setTagText] = useState(() => tagsToText(initial.tags));
  const [fromFiles, setFromFiles] = useState<string[]>([]);
  const [readNote, setReadNote] = useState<string | null>(null);
  const [hasCurrentBeforeRead, setHasCurrentBeforeRead] = useState(false);
  const [mode, setMode] = useState<ReadMode>("add");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [memoText, setMemoText] = useState("");
  const busy = step === "reading" || save.isPending;
  // 新しい人脈のときは、名前・会社は、基本情報の入力欄のものを使う
  const current: ProfileSheetFields = {
    ...fields, tags: textToTags(tagText),
    ...(basicsState ? { name: basicsState.name, company: basicsState.company } : {}),
  };
  /** すでに内容がある（登録済み・読み取り済み・入力済み）ときは、読み込み方を選べる */
  const hasCurrent = hasSheetContent(basicsState ? { ...current, company: "" } : current);

  /** 資料のファイルや貼り付けたメモを（複数でも）読み取って、いまの内容に足す／リセットして入れ替える */
  async function handleSources(input: { file: File; memo?: boolean }[]) {
    setError(null);
    const files = input.slice(0, MAX_FILES);
    const tooBig = files.filter((f) => f.file.size > SHEET_FILE_MAX_MB * 1024 * 1024).map((f) => f.file);
    const targets = files.filter((f) => f.file.size <= SHEET_FILE_MAX_MB * 1024 * 1024);
    if (targets.length === 0) {
      setError(`ファイルが大きすぎます。1つ${SHEET_FILE_MAX_MB}MBまでです`);
      return;
    }
    const notes: string[] = [];
    if (input.length > MAX_FILES) notes.push(`一度に読み込めるのは${MAX_FILES}つまでなので、最初の${MAX_FILES}つだけ読み込みました。残りは、もう一度「追加で読み込む」から入れてください。`);
    if (tooBig.length > 0) notes.push(`大きすぎて読み込めなかったファイル：${tooBig.map((f) => `「${f.name}」`).join("")}（${SHEET_FILE_MAX_MB}MBまで）`);

    setStep("reading");
    setProgress({ done: 0, total: targets.length });
    const subj = subject.id ? { type: subject.type, id: subject.id } : { hintName: subjectName || undefined };
    const results = await Promise.allSettled(targets.map(async (t) => {
      try { return await extractSheet(t.file, subj, { memo: t.memo }); }
      finally { setProgress((p) => (p ? { ...p, done: p.done + 1 } : p)); }
    }));

    const okFields: ProfileSheetFields[] = [];
    const okNames: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") { okFields.push(r.value); okNames.push(targets[i].file.name); }
      else {
        const msg = r.reason instanceof ApiError ? r.reason.message : "読み取りに失敗しました";
        notes.push(`「${targets[i].file.name}」：${msg}`);
      }
    });
    setProgress(null);

    if (okFields.length === 0) {
      setError(notes.join("\n") || "資料の読み取りに失敗しました。もう一度お試しください");
      setStep("choose");
      return;
    }

    // 「リセット」のときは、いまの内容を空にしてから読み込む（名前の初期値と1to1した日は残す）
    const base: ProfileSheetFields = mode === "reset" && hasCurrent
      ? { ...sheetToFields(null, subjectName), oneononeDate: defaultDate || "", ...(basicsState ? { company: basicsState.company } : {}) }
      : current;
    let merged = okFields.reduce((acc, f) => combineFields(acc, f), base);
    if (!merged.oneononeDate && defaultDate) merged = { ...merged, oneononeDate: defaultDate };

    setFields(merged);
    setTagText(tagsToText(merged.tags));
    // 新しい人脈のときは、読み取れた名前・会社を、基本情報の空のところに入れる
    if (basicsState) setBasics({ name: basicsState.name || merged.name, company: basicsState.company || merged.company });
    setHasCurrentBeforeRead(hasCurrent);
    setFromFiles(okNames);
    setReadNote(notes.length > 0 ? notes.join("\n") : null);
    setStep("edit");
  }

  /** ドラッグ＆ドロップで受け取る（ファイル以外は無視） */
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) void handleSources(files.map((file) => ({ file })));
  }

  /** 貼り付けたメモ（議事メモ・AIの要約・自由なメモ）を、読み取る */
  function readMemo() {
    const text = memoText.trim();
    if (!text) return;
    setMemoText("");
    void handleSources([{ file: new File([text], "貼り付けたメモ.txt", { type: "text/plain" }), memo: true }]);
  }

  function setField(key: keyof Omit<ProfileSheetFields, "tags">, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  function submit() {
    setError(null);
    const finalFields: ProfileSheetFields = { ...current };
    if (basicsState) {
      // 新しい人脈：名前だけ必須。資料メモの項目は、空でもよい
      if (!basicsState.name.trim()) { setError("名前を入力してください"); return; }
      onDone({ ...finalFields, name: basicsState.name.trim(), company: basicsState.company.trim() }, null, { ...basicsState, name: basicsState.name.trim(), company: basicsState.company.trim() });
      return;
    }
    const hasContent = SHEET_FIELDS.some((f) => f.key !== "oneononeDate" && finalFields[f.key].trim()) || finalFields.tags.length > 0;
    if (!hasContent) { setError("どれか1つ以上の項目を入力してください"); return; }
    if (deferSave || !subject.id) { onDone(finalFields, null); return; }
    save.mutate({ type: subject.type, id: subject.id, fields: finalFields }, {
      onSuccess: (r) => onDone(finalFields, r.data),
      onError: (e) => setError(e instanceof ApiError ? e.message : "保存に失敗しました。もう一度お試しください"),
    });
  }

  const close = () => { if (!busy) onClose(); };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-3 sm:p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={close}>
      <div className="card-paper w-full max-w-lg rounded-3xl p-5 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            {contactMode ? "📎 新しい人脈の登録（資料の取り込み・手動入力）" : `📎 ${subjectName || "相手"}さんの資料を取り込む`}
          </h2>
          <DialogCloseButton onClick={close} disabled={busy} />
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--color-ink-500)" }}>
          {contactMode
            ? "もらった資料（略歴シート・GAINSシート・1to1シートなど）やメモを読み取るか、手動で入力して、人脈を登録します。この画面で決めたあと、内容を確認してから登録します。"
            : <>もらった略歴シート・GAINSシート・1to1シートを、決まった項目に整理して残せます。<b>登録したあなただけが見られ</b>、ほかのメンバーには見えません。</>}
        </p>

        {step === "choose" && (
          <div className="space-y-3">
            <input ref={fileRef} type="file" accept={SHEET_FILE_ACCEPT} multiple className="hidden"
              onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; if (fs.length > 0) void handleSources(fs.map((file) => ({ file }))); }} />
            {hasCurrent && (
              <fieldset className="rounded-2xl p-3 space-y-2" style={{ background: "var(--color-paper-200)" }}>
                <legend className="px-1 text-xs font-semibold" style={{ color: "var(--color-ink-700)" }}>いまの内容があります。どう読み込みますか？</legend>
                {([
                  { v: "add", title: "追加情報として読み込む", desc: "いまの内容は残し、読み取った内容を足します（別の資料を重ねるとき）" },
                  { v: "reset", title: "リセットして読み込み直す", desc: "いまの内容をいったん消して、読み取った内容だけにします" },
                ] as const).map((o) => (
                  <label key={o.v} className="flex items-start gap-2 cursor-pointer">
                    <input type="radio" name="read-mode" checked={mode === o.v} onChange={() => setMode(o.v)} className="mt-1" />
                    <span>
                      <span className="block text-sm font-semibold" style={{ color: "var(--color-ink-900)" }}>{o.title}</span>
                      <span className="block text-[11px]" style={{ color: "var(--color-ink-500)" }}>{o.desc}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <button onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
              onDrop={handleDrop}
              className="w-full flex items-center gap-3 p-4 rounded-2xl text-left transition active:opacity-80"
              style={{
                background: dragging ? "rgba(181,56,75,0.18)" : "rgba(181,56,75,0.08)",
                border: dragging ? "2px dashed var(--color-brand)" : "1px dashed var(--color-brand)",
              }}>
              <FileUp size={22} style={{ color: "var(--color-brand)" }} />
              <span>
                <span className="block text-sm font-semibold" style={{ color: "var(--color-ink-900)" }}>
                  {dragging ? "ここにファイルを離してください" : "資料のファイルを選ぶ（ドラッグ＆ドロップもできます）"}
                </span>
                <span className="block text-[11px] mt-0.5" style={{ color: "var(--color-ink-500)" }}>
                  PDF・画像（写真・スクリーンショット）・テキスト。略歴シート・GAINSシート・1to1シートなど、{MAX_FILES}つまで一緒に読み込めます（1つ{SHEET_FILE_MAX_MB}MBまで）
                </span>
              </span>
            </button>
            <div className="rounded-2xl p-3 space-y-2" style={{ background: "rgba(181,56,75,0.05)", border: "1px solid var(--color-paper-300)" }}>
              <label className="block text-sm font-semibold" htmlFor="sheet-memo-text" style={{ color: "var(--color-ink-900)" }}>
                📝 議事メモ・自由なメモを貼り付ける
              </label>
              <p className="text-[11px]" style={{ color: "var(--color-ink-500)" }}>
                1to1の議事メモ、AIの要約、手書きメモの書き起こしなど、書き方は自由です。決まった項目に分けて入れ、入らない内容は「補足情報」に残します。
              </p>
              <textarea id="sheet-memo-text" value={memoText} onChange={(e) => setMemoText(e.target.value)} rows={4} maxLength={30000}
                placeholder="ここにメモを貼り付けてください" className="w-full rounded-xl px-3 py-2 text-sm" style={inputStyle} />
              <button onClick={readMemo} disabled={!memoText.trim()}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-40" style={{ background: "var(--color-brand)" }}>
                このメモを読み取る
              </button>
            </div>
            {!hasCurrent && <button onClick={() => { setError(null); setStep("edit"); }}
              className="w-full flex items-center gap-3 p-4 rounded-2xl text-left transition active:opacity-80"
              style={{ background: "var(--color-paper-200)" }}>
              <PenLine size={22} style={{ color: "var(--color-ink-500)" }} />
              <span>
                <span className="block text-sm font-semibold" style={{ color: "var(--color-ink-800)" }}>手動で入力する</span>
                <span className="block text-[11px] mt-0.5" style={{ color: "var(--color-ink-500)" }}>{contactMode ? "資料がなくても、名前や会社などを入力して登録できます" : "資料がなくても、聞いた内容を残せます"}</span>
              </span>
            </button>}
            {error && <p className="text-xs whitespace-pre-line" style={{ color: "var(--color-brand)" }}>{error}</p>}
            {hasCurrent && (
              <button onClick={() => { setError(null); setStep("edit"); }} className="text-xs underline" style={{ color: "var(--color-ink-500)" }}>
                ← 読み込まずに、編集画面に戻る
              </button>
            )}
            <p className="text-[11px]" style={{ color: "var(--color-ink-400)" }}>
              ※ 資料のファイルそのものは保存しません。読み取った項目だけを残します。WordやPowerPointの資料は、PDFにしてから選んでください。
            </p>
          </div>
        )}

        {step === "reading" && (
          <div className="py-10 flex flex-col items-center gap-3">
            <Loader2 className="animate-spin" style={{ color: "var(--color-brand)" }} />
            <p className="text-sm" style={{ color: "var(--color-ink-600)" }}>
              資料を読み取っています…{progress && progress.total > 1 ? `（${progress.done}/${progress.total}）` : ""}（30秒ほどかかることがあります）
            </p>
          </div>
        )}

        {step === "edit" && (
          <div className="space-y-3">
            {fromFiles.length > 0 && (
              <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "rgba(90,140,92,0.12)", color: "var(--color-ink-700)" }}>
                ✅ {fromFiles.map((n) => `「${n}」`).join("")}から読み取りました。
                {mode === "reset" && hasCurrentBeforeRead ? "いまの内容をリセットして、読み取った内容に入れ替えました。" : hasCurrentBeforeRead ? "いまの内容に、読み取った内容を追加しました。" : fromFiles.length > 1 ? "複数の資料の内容をまとめています。" : ""}
                内容を確かめて、違うところは直してください。
              </p>
            )}
            {readNote && (
              <p className="text-xs px-3 py-2 rounded-xl whitespace-pre-line" style={{ background: "rgba(212,160,59,0.14)", color: "var(--color-ink-700)" }}>
                ⚠️ {readNote}
              </p>
            )}
            {basics && basicsState && (
              <div className="rounded-2xl p-3" style={{ background: "var(--color-paper-200)" }}>
                <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-ink-700)" }}>👤 人脈の基本情報</p>
                {basics.render(basicsState, setBasics)}
              </div>
            )}
            {contactMode && (
              <p className="text-xs font-semibold pt-1" style={{ color: "var(--color-ink-700)" }}>📎 {termSheetMemo}（任意）</p>
            )}
            {SHEET_FIELDS.filter((f) => !(contactMode && (f.key === "name" || f.key === "company"))).map((f) => (
              <Fragment key={f.key}>
              <label className="block">
                <span className="block text-xs font-semibold mb-1" style={{ color: "var(--color-ink-700)" }}>{f.label}</span>
                {f.key === "oneononeDate" ? (
                  <input type="date" value={fields.oneononeDate} onChange={(e) => setField("oneononeDate", e.target.value)}
                    className="w-full rounded-xl px-3 py-2 text-sm" style={inputStyle} />
                ) : f.multiline ? (
                  <textarea value={fields[f.key]} rows={f.key === "expertise" || f.key === "supplement" ? 6 : 3} onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.hint} className="w-full rounded-xl px-3 py-2 text-sm" style={inputStyle} />
                ) : (
                  <input type="text" value={fields[f.key]} onChange={(e) => setField(f.key, e.target.value)}
                    className="w-full rounded-xl px-3 py-2 text-sm" style={inputStyle} />
                )}
              </label>
              {f.key === "company" && !contactMode && (
                <div className="space-y-3 pl-3" style={{ borderLeft: "3px solid var(--color-paper-300)" }}>
                  <label className="block">
                    <span className="block text-xs font-semibold mb-1" style={{ color: "var(--color-ink-700)" }}>会社のホームページ</span>
                    <input type="text" value={fields.companyUrl} onChange={(e) => setField("companyUrl", e.target.value)} placeholder="https://"
                      className="w-full rounded-xl px-3 py-2 text-sm" style={inputStyle} />
                  </label>
                  <label className="block">
                    <span className="block text-xs font-semibold mb-1" style={{ color: "var(--color-ink-700)" }}>事業内容</span>
                    <textarea value={fields.companyDescription} rows={2} onChange={(e) => setField("companyDescription", e.target.value)}
                      className="w-full rounded-xl px-3 py-2 text-sm" style={inputStyle} />
                  </label>
                  <p className="text-[11px]" style={{ color: "var(--color-ink-400)" }}>
                    この2つは、空のままにしておくと、保存したあとに会社・屋号から自動で調べて入ります。
                  </p>
                </div>
              )}
              </Fragment>
            ))}
            <label className="block">
              <span className="block text-xs font-semibold mb-1" style={{ color: "var(--color-ink-700)" }}>タグ</span>
              <input type="text" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="#CTO代行 #ITコンサル #ゴルフ"
                className="w-full rounded-xl px-3 py-2 text-sm" style={inputStyle} />
              <span className="block text-[11px] mt-1" style={{ color: "var(--color-ink-400)" }}>空白かカンマで区切ります。リファーラルさがしや、人脈の検索で使われます</span>
            </label>
            {error && <p className="text-xs" style={{ color: "var(--color-brand)" }}>{error}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={close} disabled={busy} className="px-5 py-3 rounded-2xl text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
              <button onClick={submit} disabled={busy}
                className="flex-1 py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: "var(--color-brand)" }}>
                {save.isPending && <Loader2 size={14} className="animate-spin" />}
                {deferSave || contactMode ? "この内容で決める" : "保存する"}
              </button>
            </div>
            <button onClick={() => { setError(null); setStep("choose"); }} disabled={busy}
              className="inline-flex items-center gap-1.5 text-xs underline disabled:opacity-50" style={{ color: "var(--color-ink-600)" }}>
              <Plus size={12} /> {hasCurrent ? "別の資料を読み込む（追加／リセットを選べます）" : "資料のファイルから読み取る"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
