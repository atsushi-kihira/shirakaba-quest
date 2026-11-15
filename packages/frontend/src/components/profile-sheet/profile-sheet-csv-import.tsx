// =============================================================
// 紹介シートのCSV一括取り込み（メンバー用・外部人脈用で、それぞれ使う）
//   ファイルを選ぶ → 取り込み結果の確認（誰に入るか・入らない行とその理由）→ 実行
// =============================================================
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Loader2, Download } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { decodeFile, parseDelimited } from "@/lib/csv-parse";
import { DialogCloseButton } from "@/components/dialog-close-button";
import type { ProfileSheetSubjectType } from "@shared/types";

/** CSVの列（この順に並べたものを、ひな形にする） */
const COLUMNS = [
  { key: "name", header: "名前", match: ["名前", "氏名", "お名前"] },
  { key: "furigana", header: "ふりがな", match: ["ふりがな", "フリガナ", "読み"] },
  { key: "company", header: "会社・屋号", match: ["会社", "屋号"] },
  { key: "title", header: "業種・肩書き", match: ["業種", "肩書"] },
  { key: "oneononeDate", header: "1to1した日", match: ["1to1", "1対1", "面談日"] },
  { key: "expertise", header: "専門・強み", match: ["専門", "強み"] },
  { key: "wantedReferrals", header: "紹介してほしい相手（理想のお客様）", match: ["紹介してほしい", "理想のお客", "理想"] },
  { key: "personality", header: "人柄・話題メモ", match: ["人柄", "話題"] },
  { key: "contactInfo", header: "連絡手段", match: ["連絡"] },
  { key: "tags", header: "タグ", match: ["タグ"] },
] as const;

type ColKey = (typeof COLUMNS)[number]["key"];
type CsvRow = Record<ColKey, string>;

type RowResult = { line: number; name: string; status: "update" | "create" | "skip"; reason?: string };
type Preview = { results: RowResult[]; summary: { update: number; create: number; skip: number } };

/** 見出し行から、列の位置を決める。名前の列が見つからなければ null */
function mapHeader(headerRow: string[]): Partial<Record<ColKey, number>> | null {
  const norm = (s: string) => s.normalize("NFKC").replace(/[\s ]/g, "");
  const map: Partial<Record<ColKey, number>> = {};
  const used = new Set<number>();
  for (const col of COLUMNS) {
    const idx = headerRow.findIndex((h, i) => !used.has(i) && col.match.some((m) => norm(h).includes(norm(m))));
    if (idx >= 0) { map[col.key] = idx; used.add(idx); }
  }
  return map.name === undefined || Object.keys(map).length < 3 ? null : map;
}

function toRows(table: string[][]): CsvRow[] | null {
  const head = table[0];
  if (!head) return null;
  const map = mapHeader(head);
  if (!map) return null;
  return table.slice(1).map((r) => {
    const row = {} as CsvRow;
    for (const col of COLUMNS) {
      const idx = map[col.key];
      row[col.key] = idx === undefined ? "" : (r[idx] ?? "").trim();
    }
    return row;
  }).filter((r) => COLUMNS.some((c) => r[c.key]));
}

function downloadTemplate() {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const sample = ["山田 太郎", "やまだ たろう", "株式会社サンプル", "ITコンサルタント", "2026-06-03", "システム開発の相談が得意です", "システム開発に困っている経営者", "ゴルフ・コーヒー好き", "https://example.com", "#ITコンサル #ゴルフ"];
  const csv = "\uFEFF" + [COLUMNS.map((c) => esc(c.header)).join(","), sample.map(esc).join(",")].join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = "紹介シート_取り込み用ひな形.csv"; a.click();
  URL.revokeObjectURL(url);
}

type Props = { type: ProfileSheetSubjectType; onClose: () => void };

export function ProfileSheetCsvImportModal({ type, onClose }: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<CsvRow[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [createVisibility, setCreateVisibility] = useState<"existence" | "private" | "full">("existence");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState<Preview | null>(null);
  const label = type === "member" ? "メンバー" : "外部人脈";

  const check = useMutation({
    mutationFn: (v: { rows: CsvRow[]; visibility: string }) =>
      api.post<{ data: Preview }>("/profile-sheets/import-csv", { subjectType: type, rows: v.rows, dryRun: true, createVisibility: v.visibility }),
    onSuccess: (r) => setPreview(r.data),
    onError: (e) => { setPreview(null); setError(e instanceof ApiError ? e.message : "確認に失敗しました。もう一度お試しください"); },
  });
  const run = useMutation({
    mutationFn: () => api.post<{ data: Preview }>("/profile-sheets/import-csv", { subjectType: type, rows, createVisibility }),
    onSuccess: (r) => {
      setDone(r.data);
      qc.invalidateQueries({ queryKey: ["profile-sheet"] });
      qc.invalidateQueries({ queryKey: ["collab", "contacts"] });
      qc.invalidateQueries({ queryKey: ["collab", "graph"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "取り込みに失敗しました。もう一度お試しください"),
  });
  const busy = check.isPending || run.isPending;

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    if (files.length > 1) { setError("ファイルは1つずつ入れてください"); return; }
    void handleFile(files[0]);
  }

  async function handleFile(file: File) {
    setError(null); setPreview(null); setRows(null);
    if (file.size > 5 * 1024 * 1024) { setError("ファイルが大きすぎます。5MBまでです"); return; }
    try {
      const table = parseDelimited(await decodeFile(file));
      const parsed = toRows(table);
      if (!parsed) { setError("見出し（1行目）が見つかりません。「名前」「専門・強み」などの見出しが、1行目にある形にしてください。ひな形をお使いいただくと確実です"); return; }
      if (parsed.length === 0) { setError("取り込める行がありません"); return; }
      if (parsed.length > 500) { setError("一度に取り込めるのは500行までです。ファイルを分けてお試しください"); return; }
      setFileName(file.name); setRows(parsed);
      check.mutate({ rows: parsed, visibility: createVisibility });
    } catch {
      setError("ファイルを読み込めませんでした。CSV形式（カンマまたはタブ区切り）か確認してください");
    }
  }

  const close = () => { if (!busy) onClose(); };
  const problems = (preview ?? done)?.results.filter((r) => r.status === "skip") ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={close}>
      <div className="card-paper w-full max-w-lg rounded-3xl p-5 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            📄 {label}の紹介シートを、CSVでまとめて取り込む
          </h2>
          <DialogCloseButton onClick={close} disabled={busy} />
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
          取り込んだ内容は、<b>あなただけが見られます</b>。名前が一致する{type === "member" ? "メンバー" : "人脈"}に入ります
          {type === "contact" ? "（一致する人がいなければ、新しい外部人脈として登録します）" : "（白樺クエストに登録されている人だけが対象です）"}。
          すでにシートがある人は、CSVの内容で置き換わります。
        </p>

        {done ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold" style={{ color: "var(--color-ink-800)" }}>✅ 取り込みました</p>
            <p className="text-sm" style={{ color: "var(--color-ink-700)" }}>
              {done.summary.update > 0 && <>更新 {done.summary.update}人 </>}
              {done.summary.create > 0 && <>新しく登録 {done.summary.create}人 </>}
              {done.summary.skip > 0 && <>取り込めなかった行 {done.summary.skip}行</>}
            </p>
            {problems.length > 0 && <ProblemList items={problems} />}
            <button onClick={onClose} className="w-full py-3 rounded-2xl text-sm font-medium text-white" style={{ background: "var(--color-brand)" }}>閉じる</button>
          </div>
        ) : (
          <div className="space-y-3">
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleFile(f); }} />
            <div className="rounded-2xl p-3 space-y-2 transition"
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
              onDrop={handleDrop}
              style={{ border: `${dragging ? 2 : 1}px dashed var(--color-brand)`, background: dragging ? "rgba(181,56,75,0.12)" : "rgba(181,56,75,0.05)" }}>
            <p className="text-xs" style={{ color: "var(--color-ink-600)" }}>
              {dragging ? "ここにファイルを離してください" : "CSVファイルをここにドラッグ＆ドロップするか、下のボタンで選んでください"}
            </p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => fileRef.current?.click()} disabled={busy}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
                <FileSpreadsheet size={16} /> CSVファイルを選ぶ
              </button>
              <button onClick={downloadTemplate} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
                <Download size={16} /> ひな形をダウンロード
              </button>
            </div>
            </div>
            <p className="text-[11px]" style={{ color: "var(--color-ink-400)" }}>
              1行目は見出し：{COLUMNS.map((c) => c.header).join("／")}。Excelで作った場合は「CSV UTF-8」で保存してください。
            </p>

            {type === "contact" && (
              <label className="block">
                <span className="block text-xs font-semibold mb-1" style={{ color: "var(--color-ink-700)" }}>新しく登録する人脈の公開範囲</span>
                <select value={createVisibility} disabled={busy}
                  onChange={(e) => { const v = e.target.value as typeof createVisibility; setCreateVisibility(v); if (rows) check.mutate({ rows, visibility: v }); }}
                  className="w-full rounded-xl px-3 py-2 text-sm" style={{ background: "var(--color-paper-100)", border: "1px solid var(--color-paper-300)" }}>
                  <option value="existence">🌫️ 存在のみ公開（詳細は非公開）</option>
                  <option value="private">🔒 非公開（自分だけ）</option>
                  <option value="full">📖 詳細まで公開（連絡先は非公開）</option>
                </select>
              </label>
            )}

            {check.isPending && (
              <p className="flex items-center gap-2 text-sm" style={{ color: "var(--color-ink-600)" }}><Loader2 size={14} className="animate-spin" /> 内容を確認しています…</p>
            )}
            {error && <p className="text-xs" style={{ color: "var(--color-brand)" }}>{error}</p>}

            {preview && fileName && (
              <div className="rounded-2xl p-3" style={{ background: "var(--color-paper-200)" }}>
                <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>「{fileName}」の確認結果（まだ取り込んでいません）</p>
                <p className="text-sm font-semibold" style={{ color: "var(--color-ink-800)" }}>
                  {preview.summary.update > 0 && <>更新 {preview.summary.update}人 </>}
                  {preview.summary.create > 0 && <>新しく登録 {preview.summary.create}人 </>}
                  {preview.summary.skip > 0 && <span style={{ color: "var(--color-brand)" }}>取り込めない行 {preview.summary.skip}行</span>}
                </p>
                {problems.length > 0 && <div className="mt-2"><ProblemList items={problems} /></div>}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={close} disabled={busy} className="px-5 py-3 rounded-2xl text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
              <button onClick={() => { setError(null); run.mutate(); }}
                disabled={busy || !preview || preview.summary.update + preview.summary.create === 0}
                className="flex-1 py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
                {run.isPending && <Loader2 size={14} className="animate-spin" />}
                {preview ? `${preview.summary.update + preview.summary.create}人を取り込む` : "取り込む"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProblemList({ items }: { items: RowResult[] }) {
  return (
    <ul className="text-xs space-y-1 max-h-40 overflow-y-auto" style={{ color: "var(--color-ink-600)" }}>
      {items.map((r) => (
        <li key={r.line}>・{r.line}人目{r.name ? `「${r.name}」` : ""}：{r.reason}</li>
      ))}
    </ul>
  );
}
