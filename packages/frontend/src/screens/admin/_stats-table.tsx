// =============================================================
// 管理画面「統計レポート」— MTLRの表（PDFと同じ列・同じ色）。名前を押すと、そのメンバーのページへ
// =============================================================
import { Link } from "react-router-dom";
import { computeMtlr, MTLR_COLUMNS, MTLR_HEADERS, type MtlrRaw } from "@shared/mtlr";
import { COLOR_CLASS, cellColor, fmtJpDate, type MtlrReportData } from "./_stats-shared";

function fmtCell(column: keyof MtlrRaw, v: number): string {
  return column === "tyfcb" ? v.toLocaleString() : String(v);
}

export function MtlrTable({ report, highlightPersonKey }: { report: MtlrReportData; highlightPersonKey?: string }) {
  return (
    <div className="card-paper overflow-hidden">
      <div className="px-4 py-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1" style={{ borderBottom: "1px solid var(--color-paper-300)" }}>
        <div className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>
          Member Traffic Lights Report&emsp;<span className="font-normal" style={{ color: "var(--color-ink-600)" }}>BNI 白樺</span>
        </div>
        <div className="text-xs" style={{ color: "var(--color-ink-500)" }}>
          {fmtJpDate(report.periodFrom)} 〜 {fmtJpDate(report.periodTo)}
          {report.createdOn && <>&emsp;／&emsp;{fmtJpDate(report.createdOn)} 作成</>}
          &emsp;／&emsp;{report.rows.length}人
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse" style={{ minWidth: 880 }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 px-3 py-2 text-left font-semibold text-white whitespace-nowrap" style={{ background: "var(--color-brand)" }}>名前</th>
              {MTLR_COLUMNS.map((c) => (
                <th key={c} className="px-1.5 py-2 text-center font-semibold text-white whitespace-nowrap" style={{ background: "var(--color-brand)" }}>
                  {MTLR_HEADERS[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => {
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
