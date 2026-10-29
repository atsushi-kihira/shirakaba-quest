// =============================================================
// 管理画面 — 利用状況レポート（メンバーごとの訪問回数・画面閲覧数・操作件数）
// =============================================================
import { useMemo, useState } from "react";
import { ChevronUp, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { AccessChart } from "./_access-chart";
import { PeriodSwitcher, rangeTitle } from "./_period-switcher";
import { AdminMemberUsageModal } from "./_admin-member-usage-modal";
import { FEATURES, STATUS_LABEL, fmtDate, useUsagePeriod, useUsageReport, type MemberUsage, type FeatureKey } from "./_usage-shared";
import { UsageSummaryCards } from "./_usage-summary-cards";

/** `screen:home` のように、画面ごとの閲覧数の列を指す */
type SortKey = "name" | "status" | "lastLoginAt" | FeatureKey | "visits" | "views" | "actions" | `screen:${string}`;

function sortValue(r: MemberUsage, key: SortKey): string | number | null {
  if (key.startsWith("screen:")) return r.viewsByScreen[key.slice("screen:".length)] ?? 0;
  return r[key as keyof MemberUsage] as string | number | null;
}

export function AdminUsageReportScreen() {
  // 集計期間（日・週・月・累計）。訪問回数・サマリー・機能別・メンバー別のすべてに共通で反映される
  const period = useUsagePeriod("all");
  const { unit, date, tz } = period;
  const { data, isLoading } = useUsageReport(unit, date, tz);
  const periodLabel = unit === "all" ? "累計" : rangeTitle(unit, data?.rangeStart ?? null, data?.rangeEnd ?? null);
  const [detailMemberId, setDetailMemberId] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("actions");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const rows = data?.data ?? [];

  // メンバー別の表では、ゲストと休会中の人は、チェックしたときだけ表示する
  const [showGuests, setShowGuests] = useState(false);
  const [showOnLeave, setShowOnLeave] = useState(false);
  // 画面閲覧数を、画面ごとの列に分けて表示するか
  const [splitViews, setSplitViews] = useState(false);
  const screens = data?.screens ?? [];
  const guestCount = rows.filter((r) => r.status === "guest").length;
  const onLeaveCount = rows.filter((r) => r.status === "on_leave").length;
  const tableRows = useMemo(
    () => rows.filter((r) => (r.status !== "guest" || showGuests) && (r.status !== "on_leave" || showOnLeave)),
    [rows, showGuests, showOnLeave],
  );

  const sortedRows = useMemo(() => {
    return [...tableRows].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
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

  const mostActive = [...rows].sort((a, b) => b.actions - a.actions)[0];

  const featureTotals = FEATURES.map((f) => ({
    ...f,
    total: rows.reduce((s, r) => s + (r[f.key] as number), 0),
    totalExclTop: mostActive ? rows.filter((r) => r.id !== mostActive.id).reduce((s, r) => s + (r[f.key] as number), 0) : 0,
  }));
  const maxFeatureTotal = Math.max(1, ...featureTotals.map((f) => f.total));
  // 画面別の閲覧数（全体）。閲覧のない画面も、0件として並べる
  const viewTotals = screens.map((s) => ({ ...s, total: data?.viewBreakdown.find((v) => v.screen === s.screen)?.count ?? 0 }));
  const maxViewTotal = Math.max(1, ...viewTotals.map((v) => v.total));

  function ThSort({ label, sortKeyValue, hint }: { label: string; sortKeyValue: SortKey; hint?: string }) {
    const active = sortKey === sortKeyValue;
    return (
      <th
        onClick={() => handleSort(sortKeyValue)}
        title={hint}
        className="px-2.5 py-2.5 text-right text-xs font-medium cursor-pointer select-none whitespace-nowrap sticky top-0 z-10"
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
        メンバーごとの訪問回数・画面閲覧数・操作件数を確認できます
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
              📅 集計期間（訪問回数・機能別の操作件数・メンバー別の内訳のすべてが、この期間の数字になります。画面を下へ動かしても、ここは見えたままです）
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

          {/* 訪問回数（期間に応じた棒グラフ） */}
          <AccessChart unit={unit} date={date} />

          {/* 機能別の操作件数（合計） */}
          <div className="card-paper p-5">
            <h2 className="font-semibold text-base mb-3" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
              機能別の操作件数（{periodLabel}）
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
              1to1・人脈登録・金の卵・金のガチョウ・ミーティング主催・クエスト挑戦・カード発注・ご縁さがしの件数です。ログインや、画面を見ただけの利用は含めていません。
              画面を見た回数は、メンバー別の「画面閲覧数」と、下の「画面別の閲覧数」にまとめています。
            </p>
            {mostActive && (
              <p className="text-xs mt-3" style={{ color: "var(--color-ink-400)" }}>
                カッコ内は「{mostActive.name}」を除いた合計です（最も活発に利用しているメンバーの件数だけで全体の傾向が見えにくくならないよう、参考として併記しています）。
              </p>
            )}
          </div>

          {/* 画面別の閲覧数（合計） */}
          <div className="card-paper p-5">
            <h2 className="font-semibold text-base mb-3" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
              画面別の閲覧数（{periodLabel}）
            </h2>
            <div className="space-y-2">
              {viewTotals.map((v) => (
                <div key={v.screen} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-xs" style={{ color: "var(--color-ink-600)" }}>{v.label}</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--color-paper-200)" }}>
                    <div className="h-full rounded-full" style={{ width: `${v.total === 0 ? 0 : Math.max(4, Math.round((v.total / maxViewTotal) * 100))}%`, background: "var(--color-accent)" }} />
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs font-semibold tabular-nums" style={{ color: "var(--color-ink-800)" }}>{v.total.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <p className="text-xs mt-3" style={{ color: "var(--color-ink-500)" }}>
              メンバー別の「画面閲覧数」の合計を、見た画面ごとに分けたものです（同じ画面の5分以内の連続閲覧は1回）。協働は、協働マップ・チーム詳細などの画面です。
              画面の閲覧は、記録の仕組みができた日以降の分だけです。
            </p>
          </div>

          {/* メンバー別内訳 */}
          <div className="card-paper p-5">
            <h2 className="font-semibold text-base mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
              メンバー別の利用状況（{periodLabel}）
            </h2>
            <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
              列見出しをタップ・クリックすると並び替えできます。ゲストと休会中の方は、最初は表示しません（下のチェックで表示できます）。上のサマリーや機能別の件数には、これらの方も含まれています。メンバーの行をタップ・クリックすると、そのメンバーの詳しい利用状況（プロフィール・訪問回数・機能ごとの操作件数・よくやりとりしている相手）を見られます。
              「訪問回数」は、アプリを使った回数です。ログイン・アプリを開いた・画面を見た・何かを登録した、などの利用の時刻をつなげて、最後の利用から30分あいたら、別の訪問と数えます。「画面閲覧数」は、見た画面の数です（ホーム・ミーティング・通知などと、協働マップ・チーム詳細などの協働画面の合計。同じ画面の5分以内の連続閲覧は1回）。「操作件数」は、1to1・人脈登録・金の卵・金のガチョウ・ミーティング主催・クエスト挑戦・カード発注・ご縁さがしの件数を足したものです。
              画面の閲覧とアプリを開いた記録は、記録の仕組みができた日以降にしかありません。それ以前の訪問は、1to1や人脈の登録などの操作があった時刻から数えています。
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
              <span className="text-xs ml-2" style={{ color: "var(--color-ink-500)" }}>表の見え方：</span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={splitViews} onChange={(e) => setSplitViews(e.target.checked)} />
                画面閲覧数を、画面ごとに分けて表示する
              </label>
            </div>
            {/* 人数が多くて下まで見えないときも、列のタイトル行が見えたままになるよう、表の枠の中で縦にもスクロールさせる */}
            <div className="overflow-auto rounded-2xl" style={{ border: "1px solid var(--color-paper-300)", maxHeight: "min(70vh, 640px)" }}>
              <table className="w-full" style={{ minWidth: splitViews ? 1120 + screens.length * 72 : 1120 }}>
                <thead>
                  <tr>
                    <th onClick={() => handleSort("name")} className="px-2.5 py-2.5 text-left text-xs font-medium cursor-pointer select-none whitespace-nowrap sticky top-0 left-0 z-20"
                      style={{ color: sortKey === "name" ? "var(--color-ink-700)" : "var(--color-ink-500)", background: "var(--color-paper-50)" }}>
                      <span className="inline-flex items-center gap-0.5">
                        名前 {sortKey === "name" && (sortDir === -1 ? <ChevronDown size={11} /> : <ChevronUp size={11} />)}
                      </span>
                    </th>
                    <th onClick={() => handleSort("status")} className="px-2.5 py-2.5 text-left text-xs font-medium cursor-pointer select-none whitespace-nowrap sticky top-0 z-10"
                      style={{ color: sortKey === "status" ? "var(--color-ink-700)" : "var(--color-ink-500)", background: "var(--color-paper-50)" }}>
                      状態
                    </th>
                    <ThSort label="最終ログイン・利用" sortKeyValue="lastLoginAt" />
                    <ThSort label="訪問回数" sortKeyValue="visits" hint="アプリを使った回数です。最後の利用から30分あいたら、別の訪問と数えます" />
                    <ThSort label="画面閲覧数" sortKeyValue="views" hint="見た画面の数です（ホーム・ミーティング・通知などと、協働画面の合計。同じ画面の5分以内の連続閲覧は1回）" />
                    {splitViews && screens.map((s) => <ThSort key={s.screen} label={`👀${s.label}`} sortKeyValue={`screen:${s.screen}`} hint={`「${s.label}」画面の閲覧数`} />)}
                    {FEATURES.map((f) => <ThSort key={f.key} label={f.label} sortKeyValue={f.key} />)}
                    <ThSort label="操作件数" sortKeyValue="actions" hint="1to1・人脈登録・金の卵・金のガチョウ・ミーティング主催・クエスト挑戦・カード発注・ご縁さがしの件数の合計です（ログイン・訪問・画面の閲覧は含みません）" />
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
                      <td className="px-2.5 py-2 text-right text-sm font-bold tabular-nums" style={{ color: r.visits === 0 ? "var(--color-ink-400)" : "var(--color-ink-800)" }}>{r.visits}</td>
                      <td className="px-2.5 py-2 text-right text-sm tabular-nums" style={{ color: r.views === 0 ? "var(--color-ink-400)" : "var(--color-ink-800)" }} title={`情報参照 ${r.view} ／ 協働画面 ${r.collabView}`}>{r.views}</td>
                      {splitViews && screens.map((s) => {
                        const n = r.viewsByScreen[s.screen] ?? 0;
                        return <td key={s.screen} className="px-2.5 py-2 text-right text-sm tabular-nums" style={{ color: n === 0 ? "var(--color-ink-400)" : "var(--color-ink-800)" }}>{n}</td>;
                      })}
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
                      <td className="px-2.5 py-2 text-right text-sm font-bold tabular-nums" style={{ color: r.actions === 0 ? "var(--color-ink-400)" : "var(--color-brand)" }}>{r.actions}</td>
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
