// =============================================================
// 管理画面 — 統計レポート（BNIのメンバー・トラフィック・ライト・レポート = MTLR）
// 月ごとのレポートを取り込み、表の再現・チャプター全体の分析・メンバーごとの推移とアドバイスを見られる。
// 当面は管理者だけの機能。
// =============================================================
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { mtlrYmLabel } from "@shared/mtlr";
import { useIsStatsAdmin, useMtlrData } from "./_stats-shared";
import { MtlrTable } from "./_stats-table";
import { MtlrChapterAnalysis } from "./_stats-chapter";
import { MtlrImportPanel } from "./_stats-import";
import { MtlrLinkPanel, MtlrReportList } from "./_stats-manage";

type Tab = "table" | "chapter" | "import";
const TABS: { key: Tab; label: string }[] = [
  { key: "table", label: "📋 月ごとの表" },
  { key: "chapter", label: "📊 チャプターの分析" },
  { key: "import", label: "📥 取り込み・管理" },
];

export function AdminStatsScreen() {
  const { data, isLoading, isError } = useMtlrData();
  const statsAdmin = useIsStatsAdmin();
  const [params, setParams] = useSearchParams();

  const reports = data?.reports ?? [];
  const yms = reports.map((r) => r.ym);
  const requestedTab = params.get("tab");
  const tab: Tab = requestedTab === "chapter" || requestedTab === "import" || requestedTab === "table"
    ? requestedTab
    : reports.length === 0 ? "import" : "table";
  const ymParam = params.get("ym");
  const ym = ymParam && yms.includes(ymParam) ? ymParam : yms[yms.length - 1] ?? "";
  const report = reports.find((r) => r.ym === ym);
  const idx = yms.indexOf(ym);

  function update(next: { tab?: Tab; ym?: string }) {
    const p = new URLSearchParams(params);
    if (next.tab) p.set("tab", next.tab);
    if (next.ym) p.set("ym", next.ym);
    setParams(p, { replace: true });
  }

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-24">
      <h1 className="text-2xl font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
        🚦 統計レポート
      </h1>
      <p className="text-sm mb-5" style={{ color: "var(--color-ink-500)" }}>
        BNIのメンバー・トラフィック・ライト・レポート（MTLR）を取り込んで、表の確認・分析・メンバーごとの推移やアドバイスを見られます。
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => update({ tab: t.key })}
            className="px-4 py-2 rounded-xl text-sm font-medium transition"
            style={{
              background: tab === t.key ? "var(--color-ink-800)" : "var(--color-paper-50)",
              color: tab === t.key ? "white" : "var(--color-ink-700)",
              border: "1px solid var(--color-paper-300)",
            }}>
            {t.label}
          </button>
        ))}

        {tab !== "import" && reports.length > 0 && (
          <div className="ml-auto flex items-center gap-1">
            <button type="button" aria-label="ひとつ前の月" disabled={idx <= 0} onClick={() => update({ ym: yms[idx - 1] })}
              className="w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-30" style={{ border: "1px solid var(--color-paper-300)", background: "var(--color-paper-50)" }}>
              <ChevronLeft size={18} />
            </button>
            <select value={ym} onChange={(e) => update({ ym: e.target.value })} aria-label="見たい月"
              className="rounded-xl px-3 py-2 text-sm font-medium" style={{ border: "1px solid var(--color-paper-300)", background: "var(--color-paper-50)", color: "var(--color-ink-900)" }}>
              {[...yms].reverse().map((y) => <option key={y} value={y}>{mtlrYmLabel(y)}末のレポート</option>)}
            </select>
            <button type="button" aria-label="ひとつ後の月" disabled={idx < 0 || idx >= yms.length - 1} onClick={() => update({ ym: yms[idx + 1] })}
              className="w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-30" style={{ border: "1px solid var(--color-paper-300)", background: "var(--color-paper-50)" }}>
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin" style={{ color: "var(--color-ink-400)" }} /></div>
      ) : isError || !data ? (
        <p className="text-sm text-center py-16" style={{ color: "var(--color-ink-500)" }}>読み込めませんでした。時間をおいて、もう一度お試しください。</p>
      ) : tab === "import" ? (
        <div className="space-y-5">
          <MtlrImportPanel onImported={(y) => update({ ym: y })} />
          <MtlrReportList data={data} canDelete={!statsAdmin} />
          {reports.length > 0 && !statsAdmin && <MtlrLinkPanel data={data} />}
        </div>
      ) : !report ? (
        <div className="card-paper p-8 text-center">
          <p className="text-sm mb-3" style={{ color: "var(--color-ink-600)" }}>まだレポートが取り込まれていません。</p>
          <button type="button" onClick={() => update({ tab: "import" })} className="px-5 py-2.5 rounded-2xl text-sm font-medium text-white" style={{ background: "var(--color-brand)" }}>
            レポートを取り込む
          </button>
        </div>
      ) : tab === "table" ? (
        <div className="space-y-3">
          <MtlrTable report={report} />
          <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
            名前を押すと、そのメンバーの推移グラフとアドバイスを見られます。色は、MTLR新基準（2025年10月〜）の 緑・黄・赤・グレー です。数字は「直近6か月」の合計です。
          </p>
        </div>
      ) : (
        <MtlrChapterAnalysis reports={reports} ym={ym} />
      )}
    </div>
  );
}
