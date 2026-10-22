// =============================================================
// 管理画面 — 全体のサマリー（対象メンバー数・のべ利用日数・利用なし・最も利用が多い人）
// 管理ダッシュボードの概要と、利用状況レポートで共通に使う
// =============================================================
import { periodNounOf, type MemberUsage } from "./_usage-shared";
import type { PeriodChoice } from "./_period-switcher";

/** 全体のサマリー（対象メンバー数・のべ利用日数・利用なしの人・最も利用が多い人） */
export function UsageSummaryCards({ rows, unit }: { rows: MemberUsage[]; unit: PeriodChoice }) {
  const totalMembers = rows.length;
  // 「ログイン日数」には、ログイン済みのままの利用日も含むので、0日の人＝累計では一度も使っていない人、期間指定ではその期間に使っていない人
  const neverLoggedIn = rows.filter((r) => r.login === 0);
  const totalLogins = rows.reduce((s, r) => s + r.login, 0);
  const mostActive = [...rows].sort((a, b) => b.total - a.total)[0];
  const avgLogins = totalMembers > 0 ? (totalLogins / totalMembers).toFixed(1) : "0";

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="card-paper p-4">
        <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>対象メンバー数</p>
        <p className="text-2xl font-bold" style={{ color: "var(--color-ink-900)" }}>{totalMembers}<span className="text-sm font-medium ml-0.5" style={{ color: "var(--color-ink-500)" }}>人</span></p>
      </div>
      <div className="card-paper p-4">
        <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>{unit === "all" ? "のべ利用日数" : "のべ利用日数（ログイン含む）"}</p>
        <p className="text-2xl font-bold" style={{ color: "var(--color-brand)" }}>{totalLogins}<span className="text-sm font-medium ml-0.5" style={{ color: "var(--color-ink-500)" }}>日</span></p>
        <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>平均 {avgLogins} 日/人</p>
      </div>
      <div className="card-paper p-4">
        <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>{unit === "all" ? "利用実績なし" : `${periodNounOf(unit)}アクセスなし`}</p>
        <p className="text-2xl font-bold" style={{ color: neverLoggedIn.length > 0 ? "var(--color-brand)" : "var(--color-ink-900)" }}>
          {neverLoggedIn.length}<span className="text-sm font-medium ml-0.5" style={{ color: "var(--color-ink-500)" }}>人</span>
        </p>
        {neverLoggedIn.length > 0 && (
          <p className="text-xs mt-1 truncate" style={{ color: "var(--color-ink-400)" }} title={neverLoggedIn.map((r) => r.name).join("・")}>
            {neverLoggedIn.map((r) => r.name).join("・")}
          </p>
        )}
      </div>
      <div className="card-paper p-4">
        <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>最も利用件数が多い</p>
        <p className="text-lg font-bold truncate" style={{ color: "var(--color-accent)" }}>{mostActive?.name ?? "—"}</p>
        <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>合計 {mostActive?.total ?? 0} 件</p>
      </div>
    </div>
  );
}
