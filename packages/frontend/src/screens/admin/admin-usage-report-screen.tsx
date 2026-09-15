// =============================================================
// 管理画面 — 利用状況レポート（メンバーごとのログイン・機能別利用件数）
// =============================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronUp, ChevronDown, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

type MemberUsage = {
  id: string;
  name: string;
  status: string;
  registeredAt: number;
  lastLoginAt: number | null;
  login: number;
  oneonone: number;
  contact: number;
  contactEight: number;
  egg: number;
  goose: number;
  meeting: number;
  quest: number;
  cardOrder: number;
  enishi: number;
  total: number;
};

const STATUS_LABEL: Record<string, string> = {
  active: "承認済み",
  on_leave: "休会中",
  guest: "ゲスト",
  pending: "承認待ち",
  rejected: "利用却下",
};

type FeatureKey = "login" | "oneonone" | "contact" | "egg" | "goose" | "meeting" | "quest" | "cardOrder" | "enishi";

const FEATURES: { key: FeatureKey; label: string }[] = [
  { key: "login", label: "ログイン" },
  { key: "oneonone", label: "1to1" },
  { key: "contact", label: "人脈登録" },
  { key: "egg", label: "金の卵" },
  { key: "goose", label: "金のガチョウ" },
  { key: "meeting", label: "ミーティング主催" },
  { key: "quest", label: "クエスト挑戦" },
  { key: "cardOrder", label: "カード発注" },
  { key: "enishi", label: "ご縁さがし" },
];

type SortKey = "name" | "status" | "lastLoginAt" | FeatureKey | "total";

function fmtDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("ja-JP", { year: "numeric", month: "numeric", day: "numeric" });
}

export function AdminUsageReportScreen() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "usage-report"],
    queryFn: () => api.get<{ data: MemberUsage[]; generatedAt: number }>("/admin/usage-report"),
  });

  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const rows = data?.data ?? [];

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
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
  }, [rows, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(-1); }
  }

  const totalMembers = rows.length;
  const neverLoggedIn = rows.filter((r) => r.login === 0);
  const totalLogins = rows.reduce((s, r) => s + r.login, 0);
  const mostActive = [...rows].sort((a, b) => b.total - a.total)[0];
  const avgLogins = totalMembers > 0 ? (totalLogins / totalMembers).toFixed(1) : "0";

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
        メンバーごとのログイン回数・機能別の利用件数を確認できます
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin" style={{ color: "var(--color-ink-400)" }} />
        </div>
      ) : (
        <div className="space-y-6">
          {/* 全体サマリー */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="card-paper p-4">
              <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>対象メンバー数</p>
              <p className="text-2xl font-bold" style={{ color: "var(--color-ink-900)" }}>{totalMembers}<span className="text-sm font-medium ml-0.5" style={{ color: "var(--color-ink-500)" }}>人</span></p>
            </div>
            <div className="card-paper p-4">
              <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>総ログイン回数</p>
              <p className="text-2xl font-bold" style={{ color: "var(--color-brand)" }}>{totalLogins}<span className="text-sm font-medium ml-0.5" style={{ color: "var(--color-ink-500)" }}>回</span></p>
              <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>平均 {avgLogins} 回/人</p>
            </div>
            <div className="card-paper p-4">
              <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>ログイン未経験</p>
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

          {/* 機能別の利用件数（合計） */}
          <div className="card-paper p-5">
            <h2 className="font-semibold text-base mb-3" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
              機能別の利用件数（合計）
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
            {mostActive && (
              <p className="text-xs mt-3" style={{ color: "var(--color-ink-400)" }}>
                カッコ内は「{mostActive.name}」を除いた合計です（管理者操作やデータ整備を含み件数が突出しやすいため）。
              </p>
            )}
          </div>

          {/* メンバー別内訳 */}
          <div className="card-paper p-5">
            <h2 className="font-semibold text-base mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
              メンバー別 利用件数内訳
            </h2>
            <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
              列見出しをタップ・クリックすると並び替えできます
            </p>
            <div className="overflow-x-auto rounded-2xl" style={{ border: "1px solid var(--color-paper-300)" }}>
              <table className="w-full" style={{ minWidth: 860 }}>
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
                    <ThSort label="最終ログイン" sortKeyValue="lastLoginAt" />
                    {FEATURES.map((f) => <ThSort key={f.key} label={f.label} sortKeyValue={f.key} />)}
                    <ThSort label="合計" sortKeyValue="total" />
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--color-paper-200)" }}>
                      <td className="px-2.5 py-2 text-sm font-semibold whitespace-nowrap sticky left-0" style={{ color: "var(--color-ink-900)", background: "var(--color-paper-50)" }}>
                        {r.name}
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
                        {r.login === 0 ? (
                          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(181,56,75,0.1)", color: "var(--color-brand)" }}>未ログイン</span>
                        ) : fmtDate(r.lastLoginAt)}
                      </td>
                      <td className="px-2.5 py-2 text-right text-sm tabular-nums" style={{ color: r.login === 0 ? "var(--color-ink-400)" : "var(--color-ink-800)" }}>{r.login}</td>
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
    </div>
  );
}
