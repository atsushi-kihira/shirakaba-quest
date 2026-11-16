// =============================================================
// 管理画面「統計レポート」— MTLRの表（PDFと同じ列・同じ色）。名前を押すと、そのメンバーのページへ
// =============================================================
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronsUpDown, RotateCcw, X } from "lucide-react";
import { computeMtlr, MTLR_COLUMNS, MTLR_HEADERS, type MtlrRaw } from "@shared/mtlr";
import { COLOR_CLASS, cellColor, fmtJpDate, type MtlrReportData } from "./_stats-shared";

function fmtCell(column: keyof MtlrRaw, v: number): string {
  return column === "tyfcb" ? v.toLocaleString() : String(v);
}

type SortKey = "name" | keyof MtlrRaw;
type SortState = { key: SortKey; dir: "asc" | "desc" } | null;

type MtlrTableProps = {
  report: MtlrReportData;
  highlightPersonKey?: string;
  /** 一覧のタイトル（「🟢 緑の人」など）。指定すると、表の見出しの上に出す */
  caption?: ReactNode;
  /** 指定すると、「閉じる」ボタンを出す */
  onClose?: () => void;
};

/** MTLRの表。列のタイトルを押すと、昇順・降順に並び替えられる（初期の並び順＝レポートの並び順に戻すボタンつき） */
export function MtlrTable({ report, highlightPersonKey, caption, onClose }: MtlrTableProps) {
  const [sort, setSort] = useState<SortState>(null);

  const rows = useMemo(() => {
    if (!sort) return report.rows;
    const sign = sort.dir === "asc" ? 1 : -1;
    const indexed = report.rows.map((row, i) => ({ row, i }));
    indexed.sort((x, y) => {
      const d = sort.key === "name"
        ? x.row.displayName.localeCompare(y.row.displayName, "ja")
        : x.row.raw[sort.key] - y.row.raw[sort.key];
      // 同じ値のときは、もとの並び順のまま
      return d !== 0 ? d * sign : x.i - y.i;
    });
    return indexed.map((x) => x.row);
  }, [report.rows, sort]);

  function toggleSort(key: SortKey) {
    setSort((cur) => (cur?.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  function sortHeader(k: SortKey, label: string, left = false) {
    const cur = sort && sort.key === k ? sort : null;
    const active = cur != null;
    const Icon = !cur ? ChevronsUpDown : cur.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th key={k} aria-sort={cur ? (cur.dir === "asc" ? "ascending" : "descending") : "none"}
        className={left ? "sticky left-0 z-10 p-0" : "p-0"} style={{ background: "var(--color-brand)" }}>
        <button type="button" onClick={() => toggleSort(k)}
          title={`「${label}」で並び替え（押すたびに、小さい順・大きい順が入れ替わります）`}
          className={`w-full inline-flex items-center gap-0.5 whitespace-nowrap font-semibold text-white hover:bg-white/15 transition ${left ? "px-3 py-2 justify-start" : "px-1.5 py-2 justify-center"}`}>
          {label}
          <Icon size={12} style={{ opacity: active ? 1 : 0.45 }} aria-hidden="true" />
        </button>
      </th>
    );
  }

  return (
    <div className="card-paper overflow-hidden">
      {caption && (
        <div className="px-4 py-2.5 flex items-center justify-between gap-3" style={{ background: "var(--color-paper-200)", borderBottom: "1px solid var(--color-paper-300)" }}>
          <div className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>{caption}</div>
          {onClose && (
            <button type="button" onClick={onClose} className="shrink-0 inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg"
              style={{ background: "var(--color-paper-50)", color: "var(--color-ink-600)", border: "1px solid var(--color-paper-300)" }}>
              <X size={12} />閉じる
            </button>
          )}
        </div>
      )}
      <div className="px-4 py-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1" style={{ borderBottom: "1px solid var(--color-paper-300)" }}>
        <div className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>
          Member Traffic Lights Report&emsp;<span className="font-normal" style={{ color: "var(--color-ink-600)" }}>BNI 白樺</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="text-xs" style={{ color: "var(--color-ink-500)" }}>
            {fmtJpDate(report.periodFrom)} 〜 {fmtJpDate(report.periodTo)}
            {report.createdOn && <>&emsp;／&emsp;{fmtJpDate(report.createdOn)} 作成</>}
            &emsp;／&emsp;{report.rows.length}人
          </div>
          <button type="button" onClick={() => setSort(null)} disabled={!sort}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg disabled:opacity-40"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)", border: "1px solid var(--color-paper-300)" }}>
            <RotateCcw size={12} />初期の並び順に戻す
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse" style={{ minWidth: 880 }}>
          <thead>
            <tr>
              {sortHeader("name", "名前", true)}
              {MTLR_COLUMNS.map((c) => sortHeader(c, MTLR_HEADERS[c]))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const b = computeMtlr(row.raw);
              const isMe = row.personKey === highlightPersonKey;
              return (
                <tr key={row.personKey} style={{ background: isMe ? "var(--color-paper-200)" : undefined, borderBottom: "1px solid var(--color-paper-300)" }}>
                  <td className="sticky left-0 z-10 px-3 py-1.5 whitespace-nowrap" style={{ background: isMe ? "var(--color-paper-200)" : "var(--color-paper-50)" }}>
                    <Link to={`/admin/stats/members/${encodeURIComponent(row.personKey)}`}
                      className="font-medium underline-offset-2 hover:underline" style={{ color: "var(--color-ink-900)" }} title="このメンバーの推移とアドバイスを見る">
                      {row.displayName}
                    </Link>
                  </td>
                  {MTLR_COLUMNS.map((c) => {
                    const color = cellColor(c, row.raw);
                    const v = row.raw[c];
                    const emphasize = (c === "absent" && v > 0) || (c === "substitute" && v > 0) || c === "score";
                    return (
                      <td key={c} className={`px-1.5 py-1.5 text-center tabular-nums ${color ? COLOR_CLASS[color] : ""}`}
                        style={{ color: c === "absent" && v > 0 ? "var(--color-brand)" : "var(--color-ink-900)", fontWeight: emphasize ? 700 : 400, borderLeft: "1px solid var(--color-paper-300)" }}
                        title={c === "score" && !b.matchesReported ? `計算した点数は${b.total}点で、レポートの点数と一致しません` : undefined}>
                        {fmtCell(c, v)}{c === "score" && !b.matchesReported ? " ⚠️" : ""}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
