// =============================================================
// 管理画面「統計レポート」— 月ごとの推移グラフ（折れ線・棒・積み上げ棒。外部のグラフ部品は使わず、SVGで描く）
// =============================================================
import type { ReactNode } from "react";

export type ChartSeries = {
  name: string;
  /** CSSの色（例: "var(--color-brand)"） */
  color: string;
  values: (number | null)[];
  dashed?: boolean;
};

export type ChartBand = { from: number; to: number; color: string };

type TrendChartProps = {
  labels: string[];
  kind: "line" | "bar" | "stack";
  series: ChartSeries[];
  /** 目安の線（破線）。棒グラフの上に重ねる */
  overlays?: ChartSeries[];
  yMin?: number;
  yMax?: number;
  /** 背景の色帯（スコアの 緑・黄・赤・グレー の範囲など） */
  bands?: ChartBand[];
  fmt?: (n: number) => string;
  height?: number;
  /** 棒（積み上げの1色ぶん）を押したとき（系列の番号, 月の番号）。指定すると、棒が押せるようになる */
  onBarClick?: (seriesIndex: number, pointIndex: number) => void;
  /** 凡例の色を押したとき（系列の番号） */
  onLegendClick?: (seriesIndex: number) => void;
  /** 選ばれている棒（系列の番号, 月の番号）。ほかの棒を薄くして、目立たせる */
  selected?: { seriesIndex: number; pointIndex: number } | null;
};

const W = 640;
const M = { l: 46, r: 16, t: 18, b: 30 };

/** 目盛りのきりのいい間隔（1・2・5 × 10の何乗） */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

export function TrendChart({ labels, kind, series, overlays = [], yMin = 0, yMax, bands = [], fmt = (n) => String(n), height = 240, onBarClick, onLegendClick, selected }: TrendChartProps) {
  const n = labels.length;
  const innerW = W - M.l - M.r;
  const innerH = height - M.t - M.b;

  // 縦軸の範囲
  const stackTotals = labels.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const dataMax = Math.max(
    0,
    ...(kind === "stack" ? stackTotals : series.flatMap((s) => s.values.filter((v): v is number => v != null))),
    ...overlays.flatMap((s) => s.values.filter((v): v is number => v != null)),
  );
  const step = niceStep((Math.max(yMax ?? dataMax, yMin + 1) - yMin) / 4);
  const top = yMax ?? Math.max(yMin + step, Math.ceil((dataMax * 1.1) / step) * step);
  const yOf = (v: number) => M.t + innerH - ((Math.min(Math.max(v, yMin), top) - yMin) / (top - yMin)) * innerH;
  const slot = n > 0 ? innerW / n : innerW;
  const xOf = (i: number) => M.l + slot * (i + 0.5);

  const ticks: number[] = [];
  for (let v = yMin; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);

  const showValues = n <= 12;
  const barW = Math.min(44, slot * 0.6);

  const linePath = (vals: (number | null)[]): string => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };

  const text = (extra: React.SVGProps<SVGTextElement>, children: ReactNode) => (
    <text {...extra} style={{ fill: "var(--color-ink-500)", fontSize: 11, ...extra.style }}>{children}</text>
  );

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" className="w-full h-auto" style={{ maxHeight: height * 1.6 }}>
        {bands.map((b, i) => (
          <rect key={i} x={M.l} width={innerW} y={yOf(b.to)} height={Math.max(0, yOf(b.from) - yOf(b.to))} style={{ fill: b.color, opacity: 0.35 }} />
        ))}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={yOf(v)} y2={yOf(v)} style={{ stroke: "var(--color-paper-300)", strokeWidth: v === yMin ? 1.2 : 0.6 }} />
            {text({ x: M.l - 6, y: yOf(v) + 4, textAnchor: "end" }, fmt(v))}
          </g>
        ))}
        {labels.map((l, i) => (
          <g key={`${l}-${i}`}>{text({ x: xOf(i), y: height - 10, textAnchor: "middle" }, l)}</g>
        ))}

        {/* 棒 */}
        {kind !== "line" && labels.map((l, i) => {
          let acc = 0;
          return (
            <g key={`bar-${l}-${i}`}>
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                if (kind === "bar") {
                  const w = barW / series.length;
                  const x = xOf(i) - barW / 2 + w * si;
                  return v > 0 ? (
                    <rect key={s.name} x={x} width={Math.max(2, w - 1)} y={yOf(v)} height={yOf(yMin) - yOf(v)} rx={2} style={{ fill: s.color }}>
                      <title>{`${l} ${s.name}：${fmt(v)}`}</title>
                    </rect>
                  ) : null;
                }
                const y1 = yOf(acc + v);
                const y0 = yOf(acc);
                acc += v;
                if (v <= 0) return null;
                const isSel = selected?.seriesIndex === si && selected.pointIndex === i;
                const dim = selected != null && !isSel;
                return (
                  <rect key={s.name} x={xOf(i) - barW / 2} width={barW} y={y1} height={Math.max(0, y0 - y1)}
                    style={{ fill: s.color, opacity: dim ? 0.4 : 1, stroke: isSel ? "var(--color-ink-900)" : "none", strokeWidth: isSel ? 2 : 0, cursor: onBarClick ? "pointer" : undefined }}
                    {...(onBarClick ? {
                      role: "button", tabIndex: 0, "aria-label": `${l}の${s.name}の人（${fmt(v)}人）を一覧で見る`,
                      onClick: () => onBarClick(si, i),
                      onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onBarClick(si, i); } },
                    } : {})}>
                    <title>{`${l} ${s.name}：${fmt(v)}${onBarClick ? "（押すと、該当する人の一覧を表示）" : ""}`}</title>
                  </rect>
                );
              })}
              {showValues && (kind === "stack" ? stackTotals[i] > 0 : series.some((s) => (s.values[i] ?? 0) > 0)) &&
                text(
                  { x: xOf(i), y: yOf(kind === "stack" ? stackTotals[i] : Math.max(...series.map((s) => s.values[i] ?? 0))) - 5, textAnchor: "middle", style: { fill: "var(--color-ink-700)", fontWeight: 600 } },
                  fmt(kind === "stack" ? stackTotals[i] : Math.max(...series.map((s) => s.values[i] ?? 0))),
                )}
            </g>
          );
        })}

        {/* 折れ線 */}
        {kind === "line" && series.map((s) => (
          <g key={s.name}>
            <path d={linePath(s.values)} fill="none" style={{ stroke: s.color, strokeWidth: 2.5, strokeLinejoin: "round" }} strokeDasharray={s.dashed ? "6 4" : undefined} />
            {s.values.map((v, i) => v == null ? null : (
              <g key={i}>
                <circle cx={xOf(i)} cy={yOf(v)} r={4} style={{ fill: s.color, stroke: "var(--color-paper-50)", strokeWidth: 1.5 }}>
                  <title>{`${labels[i]} ${s.name}：${fmt(v)}`}</title>
                </circle>
                {showValues && series.length <= 2 && text({ x: xOf(i), y: yOf(v) - 9, textAnchor: "middle", style: { fill: "var(--color-ink-700)", fontWeight: 600 } }, fmt(v))}
              </g>
            ))}
          </g>
        ))}

        {/* 目安の破線 */}
        {overlays.map((s) => (
          <path key={s.name} d={linePath(s.values)} fill="none" strokeDasharray="6 4" style={{ stroke: s.color, strokeWidth: 2 }} />
        ))}
      </svg>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs" style={{ color: "var(--color-ink-600)" }}>
        {series.map((s, si) => onLegendClick ? (
          <button key={s.name} type="button" onClick={() => onLegendClick(si)}
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg hover:bg-black/5 transition"
            style={{ border: "1px solid var(--color-paper-300)" }} title={`${s.name}の人の一覧を表示`}>
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: s.color }} />{s.name}
          </button>
        ) : (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: s.color }} />{s.name}
          </span>
        ))}
        {overlays.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: s.color }} />{s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** グラフを入れるカード（タイトル・説明・いまの値と前回との差） */
export function ChartCard({ title, hint, current, delta, deltaUnit = "", children }: {
  title: string;
  hint?: string;
  current?: string;
  delta?: number | null;
  deltaUnit?: string;
  children: ReactNode;
}) {
  return (
    <div className="card-paper p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>{title}</h3>
          {hint && <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>{hint}</p>}
        </div>
        {current != null && (
          <div className="text-right shrink-0">
            <div className="text-lg font-bold leading-tight" style={{ color: "var(--color-ink-900)" }}>{current}</div>
            {delta != null && (
              <div className="text-xs font-medium" style={{ color: delta > 0 ? "var(--color-success-dk)" : delta < 0 ? "var(--color-brand)" : "var(--color-ink-500)" }}>
                {delta > 0 ? "▲ +" : delta < 0 ? "▼ " : "± "}{Math.abs(delta)}{deltaUnit}（前回比）
              </div>
            )}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
