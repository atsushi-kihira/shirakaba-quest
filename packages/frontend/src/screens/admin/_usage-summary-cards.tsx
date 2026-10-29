// =============================================================
// 管理画面 — 全体のサマリー（対象メンバー数・のべ訪問回数・訪問なし・最も操作が多い人）
// 管理ダッシュボードの概要と、利用状況レポートで共通に使う
// =============================================================
import { periodNounOf, type MemberUsage } from "./_usage-shared";
import type { PeriodChoice } from "./_period-switcher";

/** 全体のサマリー（対象メンバー数・のべ訪問回数と画面閲覧数・訪問なしの人・最も操作が多い人） */
export function UsageSummaryCards({ rows, unit }: { rows: MemberUsage[]; unit: PeriodChoice }) {
  const totalMembers = rows.length;
  // 訪問回数が0回の人＝累計では一度も使っていない人、期間指定ではその期間に使っていない人
  const neverVisited = rows.filter((r) => r.visits === 0);
  const totalVisits = rows.reduce((s, r) => s + r.visits, 0);
  const totalViews = rows.reduce((s, r) => s + r.views, 0);
  const mostActive = [...rows].sort((a, b) => b.actions - a.actions)[0];
  const avgVisits = totalMembers > 0 ? (totalVisits / totalMembers).toFixed(1) : "0";

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="card-paper p-4">
        <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>対象メンバー数</p>
        <p className="text-2xl font-bold" style={{ color: "var(--color-ink-900)" }}>{totalMembers}<span className="text-sm font-medium ml-0.5" style={{ color: "var(--color-ink-500)" }}>人</span></p>
      </div>
      <div className="card-paper p-4">
        <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>のべ訪問回数</p>
        <p className="text-2xl font-bold" style={{ color: "var(--color-brand)" }}>{totalVisits.toLocaleString()}<span className="text-sm font-medium ml-0.5" style={{ color: "var(--color-ink-500)" }}>回</span></p>
        <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>平均 {avgVisits} 回/人 ・ 画面閲覧 {totalViews.toLocaleString()} 回</p>
      </div>
      <div className="card-paper p-4">
        <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>{unit === "all" ? "利用実績なし" : `${periodNounOf(unit)}訪問なし`}</p>
        <p className="text-2xl font-bold" style={{ color: neverVisited.length > 0 ? "var(--color-brand)" : "var(--color-ink-900)" }}>
          {neverVisited.length}<span className="text-sm font-medium ml-0.5" style={{ color: "var(--color-ink-500)" }}>人</span>
        </p>
        {neverVisited.length > 0 && (
          <p className="text-xs mt-1 truncate" style={{ color: "var(--color-ink-400)" }} title={neverVisited.map((r) => r.name).join("・")}>
            {neverVisited.map((r) => r.name).join("・")}
          </p>
        )}
      </div>
      <div className="card-paper p-4">
        <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>最も操作件数が多い</p>
        <p className="text-lg font-bold truncate" style={{ color: "var(--color-accent)" }}>{mostActive?.name ?? "—"}</p>
        <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>操作 {mostActive?.actions ?? 0} 件</p>
      </div>
    </div>
  );
}
