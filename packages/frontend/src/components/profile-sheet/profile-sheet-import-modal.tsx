// =============================================================
// 紹介シートの取り込み・編集ダイアログ
//   1) 資料のファイル（PDF・画像・テキスト）を選ぶ → AIが10項目に読み取る
//   2) 読み取り結果を確認して、直したいところを直す
//   3) 保存（deferSave のときは、保存せずに内容だけ呼び出し元へ返す）
//   手で入力することも、すでにある内容を直すこともできる
// =============================================================
import { useRef, useState } from "react";
import { Loader2, FileUp, PenLine } from "lucide-react";
import { ApiError } from "@/lib/api";
import { DialogCloseButton } from "@/components/dialog-close-button";
import type { ProfileSheet, ProfileSheetFields } from "@shared/types";
import {
  SHEET_FIELDS, SHEET_FILE_ACCEPT, SHEET_FILE_MAX_MB, extractSheet, sheetToFields, tagsToText, textToTags, useSaveSheet,
} from "./profile-sheet-shared";

type Step = "choose" | "reading" | "edit";

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
  onClose: () => void;
  onDone: (fields: ProfileSheetFields, saved: ProfileSheet | null) => void;
};

const inputStyle = { background: "var(--color-paper-100)", border: "1px solid var(--color-paper-300)", color: "var(--color-ink-800)" } as const;

/** 読み取った内容を、すでにある内容に重ねる（読み取れなかった空の項目は、いまの内容を残す） */
function mergeOver(base: ProfileSheetFields, next: ProfileSheetFields): ProfileSheetFields {
  const out = { ...base };
  for (const f of SHEET_FIELDS) if (next[f.key]) out[f.key] = next[f.key];
  out.tags = next.tags.length > 0 ? next.tags : base.tags;
  return out;
}

export function ProfileSheetImportModal({ subject, existing, defaultDate, startAtEdit, deferSave, initialFields, onClose, onDone }: Props) {
  const save = useSaveSheet();
  const fileRef = useRef<HTMLInputElement>(null);
  const initial = initialFields ?? sheetToFields(existing, subject.name);
  const [step, setStep] = useState<Step>(startAtEdit || initialFields ? "edit" : "choose");
  const [fields, setFields] = useState<ProfileSheetFields>(() => ({
    ...initial, oneononeDate: initial.oneononeDate || defaultDate || "",
  }));
  const [tagText, setTagText] = useState(() => tagsToText(initial.tags));
  const [fromFile, setFromFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = step === "reading" || save.isPending;

  async function handleFile(file: File) {
    setError(null);
    if (file.size > SHEET_FILE_MAX_MB * 1024 * 1024) {
      setError(`ファイルが大きすぎます。${SHEET_FILE_MAX_MB}MBまでです`);
      return;
    }
    setStep("reading");
    try {
      const got = await extractSheet(file, subject.id ? { type: subject.type, id: subject.id } : { hintName: subject.name || undefined });
      const merged = mergeOver({ ...fields }, got);
      if (!merged.oneononeDate && defaultDate) merged.oneononeDate = defaultDate;
      setFields(merged);
      setTagText(tagsToText(merged.tags));
      setFromFile(file.name);
      setStep("edit");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "資料の読み取りに失敗しました。もう一度お試しください");
      setStep("choose");
    }
  }

  function setField(key: keyof Omit<ProfileSheetFields, "tags">, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  function submit() {
    setError(null);
    const finalFields: ProfileSheetFields = { ...fields, tags: textToTags(tagText) };
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
            📎 {subject.name || "相手"}さんの資料を取り込む
          </h2>
          <DialogCloseButton onClick={close} disabled={busy} />
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--color-ink-500)" }}>
          もらった略歴シート・GAINSシート・1to1シートを、決まった項目に整理して残せます。<b>登録したあなただけが見られ</b>、ほかのメンバーには見えません。
        </p>

        {step === "choose" && (
          <div className="space-y-3">
            <input ref={fileRef} type="file" accept={SHEET_FILE_ACCEPT} className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleFile(f); }} />
            <button onClick={() => fileRef.current?.click()}
              className="w-full flex items-center gap-3 p-4 rounded-2xl text-left transition active:opacity-80"
              style={{ background: "rgba(181,56,75,0.08)", border: "1px dashed var(--color-brand)" }}>
              <FileUp size={22} style={{ color: "var(--color-brand)" }} />
              <span>
                <span className="block text-sm font-semibold" style={{ color: "var(--color-ink-900)" }}>資料のファイルを選ぶ</span>
                <span className="block text-[11px] mt-0.5" style={{ color: "var(--color-ink-500)" }}>
                  PDF・画像（写真・スクリーンショット）・テキスト／{SHEET_FILE_MAX_MB}MBまで。AIが読み取ります
                </span>
              </span>
            </button>
            <button onClick={() => { setError(null); setStep("edit"); }}
              className="w-full flex items-center gap-3 p-4 rounded-2xl text-left transition active:opacity-80"
              style={{ background: "var(--color-paper-200)" }}>
              <PenLine size={22} style={{ color: "var(--color-ink-500)" }} />
              <span>
                <span className="block text-sm font-semibold" style={{ color: "var(--color-ink-800)" }}>手で入力する</span>
                <span className="block text-[11px] mt-0.5" style={{ color: "var(--color-ink-500)" }}>資料がなくても、聞いた内容を残せます</span>
              </span>
            </button>
            {error && <p className="text-xs" style={{ color: "var(--color-brand)" }}>{error}</p>}
            <p className="text-[11px]" style={{ color: "var(--color-ink-400)" }}>
              ※ 資料のファイルそのものは保存しません。読み取った項目だけを残します。WordやPowerPointの資料は、PDFにしてから選んでください。
            </p>
          </div>
        )}

        {step === "reading" && (
          <div className="py-10 flex flex-col items-center gap-3">
            <Loader2 className="animate-spin" style={{ color: "var(--color-brand)" }} />
            <p className="text-sm" style={{ color: "var(--color-ink-600)" }}>資料を読み取っています…（30秒ほどかかることがあります）</p>
          </div>
        )}

        {step === "edit" && (
          <div className="space-y-3">
            {fromFile && (
              <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "rgba(90,140,92,0.12)", color: "var(--color-ink-700)" }}>
                ✅ 「{fromFile}」から読み取りました。内容を確かめて、違うところは直してください。
                {existing ? "すでにある内容のうち、資料から読み取れた項目は置き換わります。" : ""}
              </p>
            )}
            {SHEET_FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="block text-xs font-semibold mb-1" style={{ color: "var(--color-ink-700)" }}>{f.label}</span>
                {f.key === "oneononeDate" ? (
                  <input type="date" value={fields.oneononeDate} onChange={(e) => setField("oneononeDate", e.target.value)}
                    className="w-full rounded-xl px-3 py-2 text-sm" style={inputStyle} />
                ) : f.multiline ? (
                  <textarea value={fields[f.key]} rows={f.key === "expertise" ? 6 : 3} onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.hint} className="w-full rounded-xl px-3 py-2 text-sm" style={inputStyle} />
                ) : (
                  <input type="text" value={fields[f.key]} onChange={(e) => setField(f.key, e.target.value)}
                    className="w-full rounded-xl px-3 py-2 text-sm" style={inputStyle} />
                )}
              </label>
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
                {deferSave ? "この内容で決める" : "保存する"}
              </button>
            </div>
            {!existing && !fromFile && (
              <button onClick={() => setStep("choose")} className="text-xs underline" style={{ color: "var(--color-ink-500)" }}>
                ← 資料のファイルから読み取る
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
