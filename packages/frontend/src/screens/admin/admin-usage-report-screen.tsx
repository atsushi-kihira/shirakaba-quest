// =============================================================
// 管理画面 — 利用状況レポート（メンバーごとのログイン・機能別利用件数）
// =============================================================
import { useMemo, useState } from "react";
import { ChevronUp, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { AccessChart } from "./_access-chart";
import { PeriodSwitcher, rangeTitle } from "./_period-switcher";
import { AdminMemberUsageModal } from "./_admin-member-usage-modal";
import { FEATURES, STATUS_LABEL, fmtDate, useUsagePeriod, useUsageReport, type MemberUsage, type FeatureKey } from "./_usage-shared";
import { UsageSummaryCards } from "./_usage-summary-cards";

type SortKey = "name" | "status" | "lastLoginAt" | FeatureKey | "total";

export function AdminUsageReportScreen() {
  // 集計期間（日・週・月・累計）。アクセス数・サマリー・機能別・メンバー別のすべてに共通で反映される
  const period = useUsagePeriod("all");
  const { unit, date, tz } = period;
  const { data, isLoading } = useUsageReport(unit, date, tz);
  const periodLabel = unit === "all" ? "累計" : rangeTitle(unit, data?.rangeStart ?? null, data?.rangeEnd ?? null);
  const [detailMemberId, setDetailMemberId] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const rows = data?.data ?? [];

  // メンバー別の表では、ゲストと休会中の人は、チェックしたときだけ表示する
  const [showGuests, setShowGuests] = useState(false);
  const [showOnLeave, setShowOnLeave] = useState(false);
  const guestCount = rows.filter((r) => r.status === "guest").length;
  const onLeaveCount = rows.filter((r) => r.status === "on_leave").length;
  const tableRows = useMemo(
    () => rows.filter((r) => (r.status !== "guest" || showGuests) && (r.status !== "on_leave" || showOnLeave)),
    [rows, showGuests, showOnLeave],
  );

  const sortedRows = useMemo(() => {
    return [...tableRows].sort((a, b) => {
      const av = a[sortKey as keyof MemberUsage];
      const bv = b[sortKey as keyof MemberUsage];
      if (typeof av === "string" || typeof bv === "string" || sortKey === "lastLoginAt") {
        const as = av ?? "";
        const bs = bv ?? "";
        if (as < bs) return -1 * sortDir;
        if (as > bs) return 1 * sortDir;
        return 0;
      }
      return ((av as number) - (bv as number)) * sortDir;
    });
  }, [tableRows, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(-1); }
  }

  const mostActive = [...rows].sort((a, b) => b.total - a.total)[0];

  const featureTotals = FEATURES.map((f) => ({
    ...f,
    total: rows.reduce((s, r) => s + (r[f.key] as number), 0),
    totalExclTop: mostActive ? rows.filter((r) => r.id !== mostActive.id).reduce((s, r) => s + (r[f.key] as number), 0) : 0,
  }));
  const maxFeatureTotal = Math.max(1, ...featureTotals.map((f) => f.total));

  function ThSort({ label, sortKeyValue }: { label: string; sortKeyValue: SortKey }) {
    const active = sortKey === sortKeyValue;
    return (
      <th
        onClick={() => handleSort(sortKeyValue)}
        className="px-2.5 py-2.5 text-right text-xs font-medium cursor-pointer select-none whitespace-nowrap sticky top-0"
        style={{ color: active ? "var(--color-ink-700)" : "var(--color-ink-500)", background: "var(--color-paper-50)" }}
      >
        <span className="inline-flex items-center gap-0.5">
          {label}
          {active && (sortDir === -1 ? <ChevronDown size={11} /> : <ChevronUp size={11} />)}
        </span>
      </th>
    );
  }

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-24">
      <h1 className="text-2xl font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
        📊 利用状況レポート
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-ink-500)" }}>
        メンバーごとの利用日数・機能別の利用件数を確認できます
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin" style={{ color: "var(--color-ink-400)" }} />
        </div>
      ) : (
        <div className="space-y-6">
          {/* 集計期間（サマリー・機能別・メンバー別の内訳に反映される） */}
          <div className="card-paper p-4 sticky top-0 z-20" style={{ background: "var(--color-paper-50)", boxShadow: "0 2px 10px rgba(60,40,20,0.12)" }}>
            <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>
              📅 集計期間（アクセス数・機能別の利用件数・メンバー別の内訳のすべてが、この期間の数字になります。画面を下へ動かしても、ここは見えたままです）
            </p>
            <PeriodSwitcher
              units={["day", "week", "month", "all"]}
              unit={unit}
              rangeStart={data?.rangeStart ?? null}
              rangeEnd={data?.rangeEnd ?? null}
              today={period.today}
              onUnitChange={period.changeUnit}
              onShift={(dir) => period.shift(data?.rangeStart ?? null, dir)}
              onToday={period.backToToday}
            />
          </div>

          {/* 全体サマリー */}
          <UsageSummaryCards rows={rows} unit={unit} />

          {/* アクセス数（期間に応じた棒グラフ） */}
          <AccessChart unit={unit} date={date} />

          {/* 機能別の利用件数（合計） */}
          <div className="card-paper p-5">
            <h2 className="font-semibold text-base mb-3" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
              機能別の利用件数（{periodLabel}）
            </h2>
            <div className="space-y-2">
              {featureTotals.map((f) => (
                <div key={f.key} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-xs" style={{ color: "var(--color-ink-600)" }}>{f.label}</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--color-paper-200)" }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.max(4, Math.round((f.total / maxFeatureTotal) * 100))}%`, background: "var(--color-success)" }} />
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs font-semibold" style={{ color: "var(--color-ink-800)" }}>
                    {f.total.toLocaleString()}
                    {f.totalExclTop !== f.total && (
                      <span className="font-normal ml-1" style={{ color: "var(--color-ink-400)" }}>({f.totalExclTop})</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs mt-3" style={{ color: "var(--color-ink-500)" }}>
              「情報参照」は、ホーム・ミーティング・通知などの画面を開いて見た回数です（ログインしたままの継続利用も含みます。同じ画面の5分以内の連続閲覧は1回）。協働マップ・チーム詳細などの「協働画面」は、情報参照とは別に数えています。
              {data?.viewBreakdown && data.viewBreakdown.length > 0
                ? ` 内訳：${data.viewBreakdown.map((v) => `${v.label} ${v.count}`).join("、")}`
                : " まだ記録がありません。これから画面が開かれると、ここに内訳が表示されます。"}
            </p>
            {mostActive && (
              <p className="text-xs mt-3" style={{ color: "var(--color-ink-400)" }}>
                カッコ内は「{mostActive.name}」を除いた合計です（最も活発に利用しているメンバーの件数だけで全体の傾向が見えにくくならないよう、参考として併記しています）。
              </p>
            )}
          </div>

          {/* メンバー別内訳 */}
          <div className="card-paper p-5">
            <h2 className="font-semibold text-base mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
              メンバー別 利用件数内訳（{periodLabel}）
            </h2>
            <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
              列見出しをタップ・クリックすると並び替えできます。ゲストと休会中の方は、最初は表示しません（下のチェックで表示できます）。上のサマリーや機能別の件数には、これらの方も含まれています。メンバーの行をタップ・クリックすると、そのメンバーの詳しい利用状況（プロフィール・アクセス数・機能ごとの利用数・よくやりとりしている相手）を見られます。「合計」には、画面を見ただけの「情報参照」「協働画面」は含めていません。
              「ログイン日数」は、ログインした日に加え、ログインしたまま使い続けた日（アプリを開いた・画面を見た・何かを登録した日）も1日と数えます。記録の仕組みができる前の分は、1to1や人脈の登録などの操作があった日で補っています。
              「1to1」は、メンバー同士の1to1に、外部ゲストとの予約・予約ページ経由の1to1（キャンセルを除く）を加えた件数です。{unit !== "all" && "（件数は上で選んだ期間のもの。最終ログインは、期間に関係なく最も新しい日です）"}
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-3 text-sm" style={{ color: "var(--color-ink-700)" }}>
              <span className="text-xs" style={{ color: "var(--color-ink-500)" }}>表示する人：</span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={showGuests} onChange={(e) => setShowGuests(e.target.checked)} />
                ゲスト（{guestCount}人）
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={showOnLeave} onChange={(e) => setShowOnLeave(e.target.checked)} />
                休会中（{onLeaveCount}人）
              </label>
            </div>
            <div className="overflow-x-auto rounded-2xl" style={{ border: "1px solid var(--color-paper-300)" }}>
              <table className="w-full" style={{ minWidth: 1010 }}>
                <thead>
                  <tr>
                    <th onClick={() => handleSort("name")} className="px-2.5 py-2.5 text-left text-xs font-medium cursor-pointer select-none whitespace-nowrap sticky top-0 left-0 z-10"
                      style={{ color: sortKey === "name" ? "var(--color-ink-700)" : "var(--color-ink-500)", background: "var(--color-paper-50)" }}>
                      <span className="inline-flex items-center gap-0.5">
                        名前 {sortKey === "name" && (sortDir === -1 ? <ChevronDown size={11} /> : <ChevronUp size={11} />)}
                      </span>
                    </th>
                    <th onClick={() => handleSort("status")} className="px-2.5 py-2.5 text-left text-xs font-medium cursor-pointer select-none whitespace-nowrap sticky top-0"
                      style={{ color: sortKey === "status" ? "var(--color-ink-700)" : "var(--color-ink-500)", background: "var(--color-paper-50)" }}>
                      状態
                    </th>
                    <ThSort label="最終ログイン・利用" sortKeyValue="lastLoginAt" />
                    {FEATURES.map((f) => <ThSort key={f.key} label={f.label} sortKeyValue={f.key} />)}
                    <ThSort label="合計" sortKeyValue="total" />
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <tr key={r.id} onClick={() => setDetailMemberId(r.id)} className="cursor-pointer hover:bg-black/5" style={{ borderTop: "1px solid var(--color-paper-200)" }}>
                      <td className="px-2.5 py-2 text-sm font-semibold whitespace-nowrap sticky left-0" style={{ color: "var(--color-ink-900)", background: "var(--color-paper-50)" }}>
                        <span className="inline-flex items-center gap-0.5">{r.name}<ChevronRight size={13} style={{ color: "var(--color-ink-400)" }} /></span>
                      </td>
                      <td className="px-2.5 py-2 whitespace-nowrap">
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{
                          background: r.status === "active" ? "rgba(90,140,92,0.12)" : "var(--color-paper-200)",
                          color: r.status === "active" ? "var(--color-success)" : "var(--color-ink-500)",
                        }}>
                          {STATUS_LABEL[r.status] ?? r.status}
                        </span>
                      </td>
                      <td className="px-2.5 py-2 text-right text-xs whitespace-nowrap" style={{ color: "var(--color-ink-600)" }}>
                        {r.lastLoginAt === null ? (
                          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(181,56,75,0.1)", color: "var(--color-brand)" }}>利用なし</span>
                        ) : fmtDate(r.lastLoginAt)}
                      </td>
                      <td className="px-2.5 py-2 text-right text-sm tabular-nums" style={{ color: r.login === 0 ? "var(--color-ink-400)" : "var(--color-ink-800)" }}>{r.login}</td>
                      <td className="px-2.5 py-2 text-right text-sm tabular-nums" style={{ color: r.view === 0 ? "var(--color-ink-400)" : "var(--color-ink-800)" }}>{r.view}</td>
                      <td className="px-2.5 py-2 text-right text-sm tabular-nums" style={{ color: r.collabView === 0 ? "var(--color-ink-400)" : "var(--color-ink-800)" }}>{r.collabView}</td>
                      <td className="px-2.5 py-2 text-right text-sm tabular-nums" style={{ color: r.oneonone === 0 ? "var(--color-ink-400)" : "var(--color-ink-800)" }}>{r.oneonone}</td>
                      <td className="px-2.5 py-2 text-right text-sm tabular-nums whitespace-nowrap" style={{ color: r.contact === 0 ? "var(--color-ink-400)" : "var(--color-ink-800)" }}>
                        {r.contact}{r.contactEight > 0 && <span className="text-xs ml-1" style={{ color: "var(--color-ink-400)" }}>(内Eight{r.contactEight})</span>}
                      </td>
                      <td className="px-2.5 py-2 text-right text-sm tabular-nums" style={{ color: r.egg === 0 ? "var(--color-ink-400)" : "var(--color-ink-800)" }}>{r.egg}</td>
                      <td className="px-2.5 py-2 text-right text-sm tabular-nums" style={{ color: r.goose === 0 ? "var(--color-ink-400)" : "var(--color-ink-800)" }}>{r.goose}</td>
                      <td className="px-2.5 py-2 text-right text-sm tabular-nums" style={{ color: r.meeting === 0 ? "var(--color-ink-400)" : "var(--color-ink-800)" }}>{r.meeting}</td>
                      <td className="px-2.5 py-2 text-right text-sm tabular-nums" style={{ color: r.quest === 0 ? "var(--color-ink-400)" : "var(--color-ink-800)" }}>{r.quest}</td>
                      <td className="px-2.5 py-2 text-right text-sm tabular-nums" style={{ color: r.cardOrder === 0 ? "var(--color-ink-400)" : "var(--color-ink-800)" }}>{r.cardOrder}</td>
                      <td className="px-2.5 py-2 text-right text-sm tabular-nums" style={{ color: r.enishi === 0 ? "var(--color-ink-400)" : "var(--color-ink-800)" }}>{r.enishi}</td>
                      <td className="px-2.5 py-2 text-right text-sm font-bold tabular-nums" style={{ color: "var(--color-brand)" }}>{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {detailMemberId && (
        <AdminMemberUsageModal memberId={detailMemberId} initialUnit={unit} initialDate={date} onClose={() => setDetailMemberId(null)} />
      )}
    </div>
  );
}
