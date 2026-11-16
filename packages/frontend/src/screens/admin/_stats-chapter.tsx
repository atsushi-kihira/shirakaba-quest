// =============================================================
// 管理画面「統計レポート」— チャプター全体の分析（平均・信号の人数・項目ごとの強みと弱み・前回からの動き）
// =============================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import {
  computeMtlr, MTLR_CATEGORY_LABEL, MTLR_CATEGORY_ORDER, MTLR_COLOR_LABEL, mtlrYmLabel, summarizeChapter, totalColor,
  type MtlrCategoryKey, type MtlrColor,
} from "@shared/mtlr";
import { TrendChart, ChartCard } from "./_stats-charts";
import { MtlrTable } from "./_stats-table";
import { COLOR_CLASS, COLOR_STRONG, ymShort, type MtlrReportData } from "./_stats-shared";

const COLOR_NAME: Record<MtlrColor, string> = { green: "緑（70点以上）", yellow: "黄（50点以上）", red: "赤（30点以上）", gray: "グレー（30点未満）" };
const COLORS: MtlrColor[] = ["green", "yellow", "red", "gray"];
const COLOR_DOT: Record<MtlrColor, string> = { green: "🟢", yellow: "🟡", red: "🔴", gray: "⚪" };

/** 押した場所と、見たい「月・色（・項目）」。一覧は、押した場所のすぐ下に出す */
type Drill = { source: "summary" | "trend" | "category"; ym: string; color: MtlrColor; category?: MtlrCategoryKey };

function sameDrill(a: Drill | null, b: Drill): boolean {
  return !!a && a.source === b.source && a.ym === b.ym && a.color === b.color && a.category === b.category;
}

/** 色ごとの該当者を、月ごとのMTLRと同じ表で出す */
function DrillList({ reports, drill, onClose }: { reports: MtlrReportData[]; drill: Drill; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, []);

  const report = reports.find((r) => r.ym === drill.ym);
  const rows = useMemo(() => {
    if (!report) return [];
    return report.rows.filter((r) => drill.category
      ? computeMtlr(r.raw).categories[drill.category].color === drill.color
      : totalColor(r.raw.score) === drill.color);
  }, [report, drill]);
  if (!report) return null;

  const what = drill.category ? MTLR_CATEGORY_LABEL[drill.category] : "総合スコア";
  const caption = `${COLOR_DOT[drill.color]} ${mtlrYmLabel(drill.ym)}末\u3000${what}が「${MTLR_COLOR_LABEL[drill.color]}」の人（${rows.length}人）`;

  return (
    <div ref={ref} className="scroll-mt-4">
      {rows.length === 0 ? (
        <div className="card-paper p-4 flex items-center justify-between gap-3">
          <p className="text-sm" style={{ color: "var(--color-ink-600)" }}>{caption}：該当する人はいません。</p>
          <button type="button" onClick={onClose} className="shrink-0 text-xs px-2.5 py-1 rounded-lg" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>閉じる</button>
        </div>
      ) : (
        <MtlrTable key={`${drill.ym}-${drill.category ?? "total"}-${drill.color}`} report={{ ...report, rows }} caption={caption} onClose={onClose} />
      )}
    </div>
  );
}

/** 人数を押せるボタン（押すと、該当者の一覧が開く） */
function CountButton({ color, count, active, onClick, children }: { color: MtlrColor; count: number; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={count === 0} aria-pressed={active}
      title={count === 0 ? "該当する人はいません" : "押すと、該当する人の一覧を表示"}
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition disabled:opacity-35 disabled:cursor-default ${COLOR_CLASS[color]}`}
      style={{ border: `2px solid ${active ? "var(--color-ink-900)" : "transparent"}`, color: "var(--color-ink-900)" }}>
      {children}
    </button>
  );
}

export function MtlrChapterAnalysis({ reports, ym }: { reports: MtlrReportData[]; ym: string }) {
  const summaries = useMemo(() => reports.map((r) => ({ report: r, s: summarizeChapter(r.rows.map((x) => x.raw)) })), [reports]);
  const index = summaries.findIndex((x) => x.report.ym === ym);
  const cur = summaries[index];
  const prev = index > 0 ? summaries[index - 1] : null;
  const [drill, setDrill] = useState<Drill | null>(null);
  const [showAllMovers, setShowAllMovers] = useState(false);
  const toggleDrill = (d: Drill) => setDrill((cur) => (sameDrill(cur, d) ? null : d));

  // 項目ごとに、緑・黄・赤・グレーの人が何人いるか（その月）
  const categoryCounts = useMemo(() => {
    const out = {} as Record<MtlrCategoryKey, Record<MtlrColor, number>>;
    for (const k of MTLR_CATEGORY_ORDER) out[k] = { green: 0, yellow: 0, red: 0, gray: 0 };
    for (const r of cur?.report.rows ?? []) {
      const b = computeMtlr(r.raw);
      for (const k of MTLR_CATEGORY_ORDER) out[k][b.categories[k].color]++;
    }
    return out;
  }, [cur]);

  const movers = useMemo(() => {
    if (!cur || !prev) return null;
    const before = new Map(prev.report.rows.map((r) => [r.personKey, r.raw.score]));
    const diffs = cur.report.rows
      .filter((r) => before.has(r.personKey))
      .map((r) => ({ personKey: r.personKey, name: r.displayName, now: r.raw.score, diff: r.raw.score - (before.get(r.personKey) ?? 0) }));
    return {
      up: diffs.filter((d) => d.diff > 0).sort((a, b) => b.diff - a.diff),
      down: diffs.filter((d) => d.diff < 0).sort((a, b) => a.diff - b.diff),
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
          {COLORS.map((c) => {
            const d: Drill = { source: "summary", ym, color: c };
            const active = sameDrill(drill, d);
            return (
              <button key={c} type="button" onClick={() => toggleDrill(d)} disabled={s.colorCounts[c] === 0} aria-pressed={active}
                className="rounded-xl p-3 text-center transition hover:brightness-95 disabled:opacity-50 disabled:cursor-default"
                style={{ background: "var(--color-paper-100)", borderTop: `4px solid ${COLOR_STRONG[c]}`, outline: active ? "2px solid var(--color-ink-900)" : "none" }}
                title={s.colorCounts[c] === 0 ? "該当する人はいません" : `押すと、${COLOR_NAME[c]}の人の一覧を表示`}>
                <div className="text-xs" style={{ color: "var(--color-ink-500)" }}>{COLOR_NAME[c]}</div>
                <div className="text-2xl font-bold" style={{ color: "var(--color-ink-900)" }}>{s.colorCounts[c]}<span className="text-sm font-medium">人</span></div>
                <div className="text-xs" style={{ color: "var(--color-ink-500)" }}>{pct(s.colorCounts[c])}</div>
                {s.colorCounts[c] > 0 && <div className="text-xs mt-0.5 underline" style={{ color: "var(--color-ink-600)" }}>{active ? "一覧を閉じる" : "一覧を見る"}</div>}
              </button>
            );
          })}
        </div>

        <ul className="mt-4 space-y-1.5 text-sm" style={{ color: "var(--color-ink-800)" }}>
          <li>💡 いちばん伸びしろが大きいのは<b>「{MTLR_CATEGORY_LABEL[weakest.key]}」</b>です。平均は{weakest.averagePoints.toFixed(1)}点（満点{weakest.max}点の{Math.round(weakest.averageRatio * 100)}%）で、赤・グレーの人が{weakest.lowCount}人（{pct(weakest.lowCount)}）います。</li>
          <li>🌟 いちばん得意なのは<b>「{MTLR_CATEGORY_LABEL[strongest.key]}」</b>です。平均は満点の{Math.round(strongest.averageRatio * 100)}%で、満点の人が{strongest.fullCount}人います。</li>
          <li>🚦 緑の人は{s.colorCounts.green}人（{pct(s.colorCounts.green)}）、赤・グレーの人は{s.colorCounts.red + s.colorCounts.gray}人（{pct(s.colorCounts.red + s.colorCounts.gray)}）です。</li>
        </ul>
      </div>
      {drill?.source === "summary" && <DrillList reports={reports} drill={drill} onClose={() => setDrill(null)} />}

      {/* 推移 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="平均スコアの推移" hint="背景の色は、緑（70点〜）・黄（50点〜）・赤（30点〜）・グレー（〜29点）" current={s.averageScore.toFixed(1)} delta={delta} deltaUnit="点">
          <TrendChart labels={labels} kind="line" yMin={0} yMax={100}
            bands={[{ from: 70, to: 100, color: "var(--mtlr-green)" }, { from: 50, to: 70, color: "var(--mtlr-yellow)" }, { from: 30, to: 50, color: "var(--mtlr-red)" }, { from: 0, to: 30, color: "var(--mtlr-gray)" }]}
            series={[{ name: "平均スコア", color: "var(--color-brand)", values: summaries.map((x) => Math.round(x.s.averageScore * 10) / 10) }]}
            fmt={(n) => String(n)} />
        </ChartCard>
        <ChartCard title="信号の人数の推移" hint="その月に、緑・黄・赤・グレーだった人の数。棒の色や、下の色の名前を押すと、該当する人の一覧を表示します">
          <TrendChart labels={labels} kind="stack"
            series={COLORS.map((c) => ({ name: COLOR_NAME[c].replace(/（.*/, ""), color: COLOR_STRONG[c], values: summaries.map((x) => x.s.colorCounts[c]) }))}
            fmt={(n) => String(n)}
            onBarClick={(si, pi) => toggleDrill({ source: "trend", ym: summaries[pi].report.ym, color: COLORS[si] })}
            onLegendClick={(si) => toggleDrill({ source: "trend", ym, color: COLORS[si] })}
            selected={drill?.source === "trend" && !drill.category ? { seriesIndex: COLORS.indexOf(drill.color), pointIndex: summaries.findIndex((x) => x.report.ym === drill.ym) } : null} />
        </ChartCard>
      </div>
      {drill?.source === "trend" && <DrillList reports={reports} drill={drill} onClose={() => setDrill(null)} />}

      {/* 項目ごとの強みと弱み */}
      <div className="card-paper p-5">
        <h2 className="font-semibold text-base mb-1" style={{ color: "var(--color-ink-800)" }}>🧭 項目ごとの強みと弱み</h2>
        <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>平均点が満点に対してどのくらいか（低い項目が上）。チャプター全体で伸ばしたい項目の目安になります。色の人数を押すと、その項目でその色の人の一覧を表示します。</p>
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
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className="text-xs" style={{ color: "var(--color-ink-500)" }}>該当する人：</span>
                  {COLORS.map((col) => {
                    const d: Drill = { source: "category", ym, color: col, category: c.key };
                    return (
                      <CountButton key={col} color={col} count={categoryCounts[c.key][col]} active={sameDrill(drill, d)} onClick={() => toggleDrill(d)}>
                        {MTLR_COLOR_LABEL[col]} {categoryCounts[c.key][col]}人
                      </CountButton>
                    );
                  })}
                </div>
                {drill?.source === "category" && drill.category === c.key && (
                  <div className="mt-3"><DrillList reports={reports} drill={drill} onClose={() => setDrill(null)} /></div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* 前回からの動き */}
      {movers && (
        <div className="grid gap-4 lg:grid-cols-2">
          {([["📈 前回からスコアが上がった人", movers.up, "up"], ["📉 前回からスコアが下がった人", movers.down, "down"]] as const).map(([title, list, dir]) => {
            const shown = showAllMovers ? list : list.slice(0, 5);
            return (
              <div key={dir} className="card-paper p-5">
                <h2 className="font-semibold text-base mb-1" style={{ color: "var(--color-ink-800)" }}>{title}（{list.length}人）</h2>
                <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>名前を押すと、その人の詳しい推移とアドバイスを見られます。</p>
                {list.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>該当する人はいません。</p>
                ) : (
                  <ul className="space-y-1">
                    {shown.map((m) => (
                      <li key={m.personKey}>
                        <Link to={`/admin/stats/members/${encodeURIComponent(m.personKey)}`}
                          className="flex items-center justify-between gap-2 text-sm rounded-xl px-3 py-2 transition hover:bg-black/5"
                          style={{ background: "var(--color-paper-100)", color: "var(--color-ink-900)" }}>
                          <span className="font-medium underline-offset-2 underline decoration-dotted">{m.name}</span>
                          <span className="flex items-center gap-1 tabular-nums" style={{ color: dir === "up" ? "var(--color-success-dk)" : "var(--color-brand)", fontWeight: 600 }}>
                            {m.now}点（{m.diff > 0 ? "+" : ""}{m.diff}）
                            <ChevronRight size={14} style={{ color: "var(--color-ink-400)" }} aria-hidden="true" />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {(movers.up.length > 5 || movers.down.length > 5) && (
            <div className="lg:col-span-2 text-center">
              <button type="button" onClick={() => setShowAllMovers((v) => !v)} className="text-sm px-4 py-2 rounded-xl"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)", border: "1px solid var(--color-paper-300)" }}>
                {showAllMovers ? "上位5人だけにする" : "全員を表示する"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
