// =============================================================
// 管理画面「統計レポート」— チャプター全体の分析（平均・信号の人数・項目ごとの強みと弱み・前回からの動き）
// =============================================================
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { MTLR_CATEGORY_LABEL, mtlrYmLabel, summarizeChapter, type MtlrColor } from "@shared/mtlr";
import { TrendChart, ChartCard } from "./_stats-charts";
import { COLOR_STRONG, ymShort, type MtlrReportData } from "./_stats-shared";

const COLOR_NAME: Record<MtlrColor, string> = { green: "緑（70点以上）", yellow: "黄（50点以上）", red: "赤（30点以上）", gray: "グレー（30点未満）" };
const COLORS: MtlrColor[] = ["green", "yellow", "red", "gray"];

export function MtlrChapterAnalysis({ reports, ym }: { reports: MtlrReportData[]; ym: string }) {
  const summaries = useMemo(() => reports.map((r) => ({ report: r, s: summarizeChapter(r.rows.map((x) => x.raw)) })), [reports]);
  const index = summaries.findIndex((x) => x.report.ym === ym);
  const cur = summaries[index];
  const prev = index > 0 ? summaries[index - 1] : null;

  const movers = useMemo(() => {
    if (!cur || !prev) return null;
    const before = new Map(prev.report.rows.map((r) => [r.personKey, r.raw.score]));
    const diffs = cur.report.rows
      .filter((r) => before.has(r.personKey))
      .map((r) => ({ personKey: r.personKey, name: r.displayName, now: r.raw.score, diff: r.raw.score - (before.get(r.personKey) ?? 0) }));
    return {
      up: diffs.filter((d) => d.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 5),
      down: diffs.filter((d) => d.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 5),
    };
  }, [cur, prev]);

  if (!cur) return null;
  const { s } = cur;
  const labels = summaries.map((x) => ymShort(x.report.ym));
  const cats = [...s.categories].sort((a, b) => a.averageRatio - b.averageRatio);
  const weakest = cats[0];
  const strongest = cats[cats.length - 1];
  const delta = prev ? Math.round((s.averageScore - prev.s.averageScore) * 10) / 10 : null;
  const pct = (n: number) => `${Math.round((n / Math.max(s.count, 1)) * 100)}%`;

  return (
    <div className="space-y-5">
      {/* 全体のようす */}
      <div className="card-paper p-5">
        <h2 className="font-semibold text-base mb-3" style={{ color: "var(--color-ink-800)" }}>📌 {mtlrYmLabel(ym)}のチャプターのようす</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-xl p-3 text-center" style={{ background: "var(--color-paper-100)" }}>
            <div className="text-xs" style={{ color: "var(--color-ink-500)" }}>平均スコア</div>
            <div className="text-2xl font-bold" style={{ color: "var(--color-ink-900)" }}>{s.averageScore.toFixed(1)}</div>
            {delta != null && <div className="text-xs font-medium" style={{ color: delta > 0 ? "var(--color-success-dk)" : delta < 0 ? "var(--color-brand)" : "var(--color-ink-500)" }}>{delta > 0 ? "▲ +" : delta < 0 ? "▼ " : "± "}{Math.abs(delta)}（前回比）</div>}
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: "var(--color-paper-100)" }}>
            <div className="text-xs" style={{ color: "var(--color-ink-500)" }}>人数</div>
            <div className="text-2xl font-bold" style={{ color: "var(--color-ink-900)" }}>{s.count}<span className="text-sm font-medium">人</span></div>
          </div>
          {COLORS.map((c) => (
            <div key={c} className="rounded-xl p-3 text-center" style={{ background: "var(--color-paper-100)", borderTop: `4px solid ${COLOR_STRONG[c]}` }} title={COLOR_NAME[c]}>
              <div className="text-xs" style={{ color: "var(--color-ink-500)" }}>{COLOR_NAME[c]}</div>
              <div className="text-2xl font-bold" style={{ color: "var(--color-ink-900)" }}>{s.colorCounts[c]}<span className="text-sm font-medium">人</span></div>
              <div className="text-xs" style={{ color: "var(--color-ink-500)" }}>{pct(s.colorCounts[c])}</div>
            </div>
          ))}
        </div>

        <ul className="mt-4 space-y-1.5 text-sm" style={{ color: "var(--color-ink-800)" }}>
          <li>💡 いちばん伸びしろが大きいのは<b>「{MTLR_CATEGORY_LABEL[weakest.key]}」</b>です。平均は{weakest.averagePoints.toFixed(1)}点（満点{weakest.max}点の{Math.round(weakest.averageRatio * 100)}%）で、赤・グレーの人が{weakest.lowCount}人（{pct(weakest.lowCount)}）います。</li>
          <li>🌟 いちばん得意なのは<b>「{MTLR_CATEGORY_LABEL[strongest.key]}」</b>です。平均は満点の{Math.round(strongest.averageRatio * 100)}%で、満点の人が{strongest.fullCount}人います。</li>
          <li>🚦 緑の人は{s.colorCounts.green}人（{pct(s.colorCounts.green)}）、赤・グレーの人は{s.colorCounts.red + s.colorCounts.gray}人（{pct(s.colorCounts.red + s.colorCounts.gray)}）です。</li>
        </ul>
      </div>

      {/* 推移 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="平均スコアの推移" hint="背景の色は、緑（70点〜）・黄（50点〜）・赤（30点〜）・グレー（〜29点）" current={s.averageScore.toFixed(1)} delta={delta} deltaUnit="点">
          <TrendChart labels={labels} kind="line" yMin={0} yMax={100}
            bands={[{ from: 70, to: 100, color: "var(--mtlr-green)" }, { from: 50, to: 70, color: "var(--mtlr-yellow)" }, { from: 30, to: 50, color: "var(--mtlr-red)" }, { from: 0, to: 30, color: "var(--mtlr-gray)" }]}
            series={[{ name: "平均スコア", color: "var(--color-brand)", values: summaries.map((x) => Math.round(x.s.averageScore * 10) / 10) }]}
            fmt={(n) => String(n)} />
        </ChartCard>
        <ChartCard title="信号の人数の推移" hint="その月に、緑・黄・赤・グレーだった人の数">
          <TrendChart labels={labels} kind="stack"
            series={COLORS.map((c) => ({ name: COLOR_NAME[c].replace(/（.*/, ""), color: COLOR_STRONG[c], values: summaries.map((x) => x.s.colorCounts[c]) }))}
            fmt={(n) => String(n)} />
        </ChartCard>
      </div>

      {/* 項目ごとの強みと弱み */}
      <div className="card-paper p-5">
        <h2 className="font-semibold text-base mb-1" style={{ color: "var(--color-ink-800)" }}>🧭 項目ごとの強みと弱み</h2>
        <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>平均点が満点に対してどのくらいか（低い項目が上）。チャプター全体で伸ばしたい項目の目安になります。</p>
        <ul className="space-y-3">
          {cats.map((c) => {
            const ratio = Math.round(c.averageRatio * 100);
            const color: MtlrColor = ratio >= 70 ? "green" : ratio >= 50 ? "yellow" : "red";
            return (
              <li key={c.key}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
                  <span className="font-medium" style={{ color: "var(--color-ink-900)" }}>{MTLR_CATEGORY_LABEL[c.key]}</span>
                  <span className="text-xs" style={{ color: "var(--color-ink-600)" }}>
                    平均 {c.averagePoints.toFixed(1)} / {c.max}点&emsp;赤・グレー {c.lowCount}人&emsp;満点 {c.fullCount}人
                  </span>
                </div>
                <div className="h-3 rounded-full mt-1 overflow-hidden" style={{ background: "var(--color-paper-200)" }} aria-label={`満点の${ratio}%`}>
                  <div className="h-full rounded-full" style={{ width: `${Math.max(2, ratio)}%`, background: COLOR_STRONG[color] }} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 前回からの動き */}
      {movers && (
        <div className="grid gap-4 lg:grid-cols-2">
          {([["📈 前回からスコアが上がった人", movers.up, "up"], ["📉 前回からスコアが下がった人", movers.down, "down"]] as const).map(([title, list, dir]) => (
            <div key={dir} className="card-paper p-5">
              <h2 className="font-semibold text-base mb-3" style={{ color: "var(--color-ink-800)" }}>{title}</h2>
              {list.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>該当する人はいません。</p>
              ) : (
                <ul className="space-y-1.5">
                  {list.map((m) => (
                    <li key={m.personKey} className="flex items-center justify-between text-sm">
                      <Link to={`/admin/stats/members/${encodeURIComponent(m.personKey)}`} className="hover:underline" style={{ color: "var(--color-ink-900)" }}>{m.name}</Link>
                      <span className="tabular-nums" style={{ color: dir === "up" ? "var(--color-success-dk)" : "var(--color-brand)", fontWeight: 600 }}>
                        {m.now}点（{m.diff > 0 ? "+" : ""}{m.diff}）
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
