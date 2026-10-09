// =============================================================
// 所要時間の選択（1to1・ミーティング・定例会など、すべての所要時間の設定で共通）
// 選択肢は「30分」「45分」「60分」「90分」「2時間」「任意の時間」。
// 任意の時間は時・分を自由に入力できる（5分〜12時間）。
// =============================================================
import { useState } from "react";

export const DURATION_PRESETS = [30, 45, 60, 90, 120] as const;
export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 12 * 60;

const PRESET_LABEL: Record<number, string> = { 30: "30分", 45: "45分", 60: "60分", 90: "90分", 120: "2時間" };

export function formatDuration(minutes: number): string {
  if (PRESET_LABEL[minutes]) return PRESET_LABEL[minutes];
  if (minutes < 60) return `${minutes}分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

function clamp(total: number): number {
  return Math.max(MIN_DURATION_MINUTES, Math.min(MAX_DURATION_MINUTES, total));
}

export function DurationSelect({ value, onChange, label = "所要時間（すべての候補日時で共通）" }: {
  value: number;
  onChange: (minutes: number) => void;
  label?: string;
}) {
  const isPreset = (DURATION_PRESETS as readonly number[]).includes(value);
  const [customOpen, setCustomOpen] = useState(!isPreset);
  const showCustom = customOpen || !isPreset;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;

  const chip = (active: boolean) => ({
    background: active ? "var(--color-brand)" : "var(--color-paper-200)",
    color: active ? "white" : "var(--color-ink-600)",
  });

  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-ink-600)" }}>{label}</label>
      <div className="flex gap-1.5 flex-wrap">
        {DURATION_PRESETS.map((d) => (
          <button key={d} type="button" onClick={() => { setCustomOpen(false); onChange(d); }}
            className="px-3 py-1.5 rounded-full text-xs font-medium transition" style={chip(!showCustom && value === d)}>
            {PRESET_LABEL[d]}
          </button>
        ))}
        <button type="button" onClick={() => setCustomOpen(true)}
          className="px-3 py-1.5 rounded-full text-xs font-medium transition" style={chip(showCustom)}>
          任意の時間
        </button>
      </div>
      {showCustom && (
        <div className="mt-2 flex items-center gap-1.5 text-sm" style={{ color: "var(--color-ink-700)" }}>
          <input type="number" min={0} max={12} value={hours} aria-label="時間"
            onChange={(e) => onChange(clamp((Number(e.target.value) || 0) * 60 + minutes))}
            className="w-16 px-2 py-1.5 rounded-xl text-sm outline-none border text-center"
            style={{ background: "#fff", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
          <span>時間</span>
          <input type="number" min={0} max={59} value={minutes} aria-label="分"
            onChange={(e) => onChange(clamp(hours * 60 + Math.min(59, Math.max(0, Number(e.target.value) || 0))))}
            className="w-16 px-2 py-1.5 rounded-xl text-sm outline-none border text-center"
            style={{ background: "#fff", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
          <span>分</span>
          <span className="text-[11px]" style={{ color: "var(--color-ink-400)" }}>（5分〜12時間）</span>
        </div>
      )}
    </div>
  );
}
