// =============================================================
// 管理画面「統計レポート」— MTLRの取り込み（PDFを選ぶ、または表の文字を貼り付ける → 確認 → 取り込む）
// =============================================================
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { extractPdfLines } from "@/lib/mtlr-pdf";
import { computeMtlr, mtlrDisplayName, mtlrYmLabel, mtlrYmOf, parseMtlrLines, totalColor, type ParsedMtlr } from "@shared/mtlr";
import { COLOR_CLASS, MTLR_QUERY_KEY, fmtImportedAt } from "./_stats-shared";

type PersonMatch = {
  personKey: string;
  displayName: string;
  memberId: string | null;
  memberName: string | null;
  via: "link" | "auto" | "excluded" | "none";
};
type PreviewResult = { people: PersonMatch[]; existing: { ym: string; rowCount: number; importedAt: number } | null };
type ImportResult = { ym: string; rowCount: number; replaced: boolean; unmatched: string[] };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const VIA_LABEL: Record<PersonMatch["via"], string> = {
  link: "✅ ひも付け済み",
  auto: "✅ 名前が一致",
  excluded: "－ メンバーではない",
  none: "❓ 見つかりません（登録前の人は、登録後に自動で結びつきます）",
};

export function MtlrImportPanel({ onImported }: { onImported: (ym: string) => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [parsed, setParsed] = useState<ParsedMtlr | null>(null);
  const [parseId, setParseId] = useState(0);
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [createdOn, setCreatedOn] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [done, setDone] = useState<ImportResult | null>(null);

  function accept(p: ParsedMtlr, name: string) {
    setError(null);
    setDone(null);
    setConfirmReplace(false);
    if (p.rows.length === 0) {
      setParsed(null);
      setError("表の数字が読み取れませんでした。MTLR（メンバー・トラフィック・ライト・レポート）のPDFかどうか確認してください。PDFが画像だけのときは、表の文字をコピーして、下の欄に貼り付けてください。");
      return;
    }
    setParsed(p);
    setFileName(name);
    setPeriodFrom(p.periodFrom ?? "");
    setPeriodTo(p.periodTo ?? "");
    setCreatedOn(p.createdOn ?? "");
    setParseId((n) => n + 1);
  }

  async function readFile(file: File) {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      setError("PDFファイルを選んでください。");
      return;
    }
    setParsing(true);
    setError(null);
    try {
      accept(parseMtlrLines(await extractPdfLines(file)), file.name);
    } catch {
      setParsed(null);
      setError("PDFを読み取れませんでした。ファイルが壊れていないか確認するか、表の文字をコピーして、下の欄に貼り付けてください。");
    } finally {
      setParsing(false);
    }
  }

  function readPaste() {
    accept(parseMtlrLines(pasteText.split(/\r?\n/)), "貼り付けたテキスト");
  }

  const rows = parsed?.rows ?? [];
  const periodOk = ISO.test(periodFrom) && ISO.test(periodTo) && periodFrom <= periodTo;

  const preview = useQuery({
    queryKey: ["admin", "mtlr", "preview", parseId, periodOk ? periodTo : ""],
    queryFn: async () => (await api.post<{ data: PreviewResult }>("/admin/mtlr/preview", { rows, periodTo: periodOk ? periodTo : undefined })).data,
    enabled: rows.length > 0,
    staleTime: Infinity,
  });
  const existing = preview.data?.existing ?? null;

  const mismatches = rows.filter((r) => !computeMtlr(r.raw).matchesReported);
  const unmatched = (preview.data?.people ?? []).filter((p) => p.via === "none");

  const importMutation = useMutation({
    mutationFn: async () => (await api.post<{ data: ImportResult }>("/admin/mtlr/import", {
      periodFrom, periodTo, createdOn: ISO.test(createdOn) ? createdOn : undefined, sourceFilename: fileName,
      overwrite: Boolean(existing), rows,
    })).data,
    onSuccess: (r) => {
      setDone(r);
      setParsed(null);
      setPasteText("");
      setConfirmReplace(false);
      qc.invalidateQueries({ queryKey: MTLR_QUERY_KEY });
      onImported(r.ym);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "取り込めませんでした。時間をおいて、もう一度お試しください。"),
  });

  return (
    <div className="space-y-4">
      <div className="card-paper p-5">
        <h2 className="font-semibold text-base mb-1" style={{ color: "var(--color-ink-800)" }}>📥 レポートを取り込む</h2>
        <p className="text-sm mb-4" style={{ color: "var(--color-ink-600)" }}>
          BNIのメンバー・トラフィック・ライト・レポート（PDF）を選んでください。1か月に1つのPDFです。同じ月をもう一度取り込むと、置き換わります。
        </p>

        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void readFile(f); }}
          className="flex flex-col items-center justify-center gap-2 rounded-2xl py-8 px-4 cursor-pointer text-center transition"
          style={{ border: `2px dashed ${dragging ? "var(--color-brand)" : "var(--color-paper-400)"}`, background: dragging ? "var(--color-paper-200)" : "var(--color-paper-100)" }}
        >
          {parsing ? <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-ink-400)" }} /> : <FileUp size={28} style={{ color: "var(--color-ink-500)" }} />}
          <span className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>{parsing ? "PDFを読み取っています…" : "ここにPDFをドラッグ、またはクリックして選ぶ"}</span>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ""; }} />
        </label>

        <details className="mt-3">
          <summary className="text-xs cursor-pointer" style={{ color: "var(--color-ink-500)" }}>PDFがうまく読み取れないとき：表の文字を貼り付ける</summary>
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={5}
            placeholder={"PDFを開いて表の部分をコピーし、ここに貼り付けてください。\n（例）山本 忍 21 0 0 0 1 14 44 76 1 40 4 113 2,886 54 2 1 94"}
            className="w-full mt-2 rounded-xl px-3 py-2 text-sm" style={{ border: "1px solid var(--color-paper-300)", background: "var(--color-paper-50)" }} />
          <button type="button" onClick={readPaste} disabled={!pasteText.trim()}
            className="mt-2 px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-40" style={{ background: "var(--color-ink-700)" }}>
            貼り付けた文字を読み取る
          </button>
        </details>

        {error && (
          <div className="mt-4 flex gap-2 rounded-xl px-3 py-2.5 text-sm" style={{ background: "#fdecec", color: "var(--color-brand-dk)" }} role="alert">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" /><span>{error}</span>
          </div>
        )}
        {done && (
          <div className="mt-4 flex gap-2 rounded-xl px-3 py-2.5 text-sm" style={{ background: "#e8f4e8", color: "var(--color-success-dk)" }} role="status">
            <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
            <span>
              {mtlrYmLabel(done.ym)}のレポート（{done.rowCount}人）を{done.replaced ? "置き換えて" : ""}取り込みました。
              {done.unmatched.length > 0 && `メンバーと結びつかなかった人が${done.unmatched.length}人います（登録前の人は、登録後に自動で結びつきます。名前が違う場合は、下の「名前のひも付け」で設定できます）。`}
            </span>
          </div>
        )}
      </div>

      {parsed && rows.length > 0 && (
        <div className="card-paper p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-base" style={{ color: "var(--color-ink-800)" }}>✅ 読み取れた内容の確認</h2>
            <p className="text-sm mt-1" style={{ color: "var(--color-ink-600)" }}>{fileName}から、<b>{rows.length}人</b>の数字を読み取りました。内容を確認して、取り込んでください。</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {([["期間の始まり（From）", periodFrom, setPeriodFrom], ["期間の終わり（To）", periodTo, setPeriodTo], ["レポートの作成日", createdOn, setCreatedOn]] as const).map(([label, value, set]) => (
              <label key={label} className="block text-xs" style={{ color: "var(--color-ink-600)" }}>
                {label}
                <input type="date" value={value} onChange={(e) => { set(e.target.value); setConfirmReplace(false); }}
                  className="mt-1 w-full rounded-xl px-3 py-2 text-sm" style={{ border: "1px solid var(--color-paper-300)", background: "var(--color-paper-50)", color: "var(--color-ink-900)" }} />
              </label>
            ))}
          </div>
          {!periodOk && (
            <p className="text-sm" style={{ color: "var(--color-brand-dk)" }}>期間が読み取れませんでした。レポートの上にある「From」と「To」の日付を入力してください。</p>
          )}
          {periodOk && (
            <p className="text-sm" style={{ color: "var(--color-ink-600)" }}>この表は <b>{mtlrYmLabel(mtlrYmOf(periodTo))}</b> のレポートとして保存されます。</p>
          )}

          {parsed.skipped.length > 0 && (
            <div className="rounded-xl px-3 py-2.5 text-sm" style={{ background: "#fff6e0", color: "var(--color-ink-800)" }}>
              <p className="font-medium">⚠️ 読み取れなかった行が{parsed.skipped.length}行あります</p>
              <ul className="mt-1 text-xs list-disc pl-5">{parsed.skipped.slice(0, 5).map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          )}
          {mismatches.length > 0 ? (
            <div className="rounded-xl px-3 py-2.5 text-sm" style={{ background: "#fff6e0", color: "var(--color-ink-800)" }}>
              <p className="font-medium">⚠️ 計算した点数とレポートの点数が違う人が{mismatches.length}人います</p>
              <p className="text-xs mt-1">点数のつけ方（基準）が変わったか、読み取りに間違いがあるかもしれません。&emsp;{mismatches.slice(0, 5).map((r) => mtlrDisplayName(r.rawName)).join("、")}{mismatches.length > 5 ? " ほか" : ""}</p>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--color-success-dk)" }}>✅ 全員、計算した点数がレポートの点数と一致しました（読み取りに間違いはなさそうです）。</p>
          )}

          {existing && (
            <div className="rounded-xl px-3 py-2.5 text-sm" style={{ background: "#fdecec", color: "var(--color-brand-dk)" }}>
              <p className="font-medium">🔁 {mtlrYmLabel(existing.ym)}のレポートは、すでに取り込まれています</p>
              <p className="text-xs mt-1">{fmtImportedAt(existing.importedAt)}に取り込んだ{existing.rowCount}人分があります。取り込むと、そちらは新しい内容に置き換わります。</p>
            </div>
          )}

          {preview.isLoading ? (
            <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>メンバーとの照合中…</p>
          ) : unmatched.length > 0 ? (
            <p className="text-sm" style={{ color: "var(--color-ink-700)" }}>
              ❓ メンバーと結びつかない人が{unmatched.length}人います（{unmatched.slice(0, 6).map((p) => p.displayName).join("、")}{unmatched.length > 6 ? " ほか" : ""}）。
              アカウント登録がまだの人は、そのままで大丈夫です。数字は先に保存され、あとで登録・承認されて名前が同じなら、自動で結びつきます。名前の書き方が違うときは、取り込んだあとに「名前のひも付け」で設定できます。
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid var(--color-paper-300)", maxHeight: 320 }}>
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0" style={{ background: "var(--color-paper-100)" }}>
                <tr className="text-xs text-left" style={{ color: "var(--color-ink-600)" }}>
                  <th className="px-3 py-2">名前</th><th className="px-3 py-2 text-center">スコア</th><th className="px-3 py-2">メンバーとの照合</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const m = preview.data?.people[i];
                  return (
                    <tr key={r.rawName} style={{ borderTop: "1px solid var(--color-paper-300)" }}>
                      <td className="px-3 py-1.5">{mtlrDisplayName(r.rawName)}</td>
                      <td className="px-3 py-1.5 text-center"><span className={`inline-block min-w-9 rounded px-1.5 font-bold tabular-nums ${COLOR_CLASS[totalColor(r.raw.score)]}`}>{r.raw.score}</span></td>
                      <td className="px-3 py-1.5 text-xs" style={{ color: m?.via === "none" ? "var(--color-brand-dk)" : "var(--color-ink-600)" }}>
                        {m ? `${VIA_LABEL[m.via]}${m.memberName ? `（${m.memberName}）` : ""}` : "…"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {existing && !confirmReplace ? (
            <button type="button" disabled={!periodOk} onClick={() => setConfirmReplace(true)}
              className="px-5 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-40" style={{ background: "var(--color-brand)" }}>
              置き換えて取り込む…
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {existing && <p className="text-sm font-medium" style={{ color: "var(--color-brand-dk)" }}>本当に置き換えますか？（元には戻せません）</p>}
              <button type="button" disabled={!periodOk || importMutation.isPending} onClick={() => importMutation.mutate()}
                className="px-5 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-40 inline-flex items-center gap-2" style={{ background: "var(--color-brand)" }}>
                {importMutation.isPending && <Loader2 size={15} className="animate-spin" />}
                {existing ? "はい、置き換える" : `${rows.length}人ぶんを取り込む`}
              </button>
              {existing && !importMutation.isPending && (
                <button type="button" onClick={() => setConfirmReplace(false)} className="px-4 py-2.5 rounded-2xl text-sm" style={{ color: "var(--color-ink-600)" }}>やめる</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
