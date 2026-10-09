// =============================================================
// 所要時間の選択（1to1・ミーティング・定例会の候補日時で共通）
// 候補日時は「開始日時」だけを選び、所要時間はすべての候補に共通のこの長さになる。
// =============================================================
export const DURATION_CHOICES = [30, 45, 60, 90, 120] as const;

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}分`;
  if (minutes % 60 === 0) return `${minutes / 60}時間`;
  return `${Math.floor(minutes / 60)}時間${minutes % 60}分`;
}

export function DurationSelect({ value, onChange, label = "所要時間（すべての候補日時で共通）" }: {
  value: number;
  onChange: (minutes: number) => void;
  label?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-ink-600)" }}>{label}</label>
      <div className="flex gap-1.5 flex-wrap">
        {DURATION_CHOICES.map((d) => (
          <button key={d} type="button" onClick={() => onChange(d)}
            className="px-3 py-1.5 rounded-full text-xs font-medium transition"
            style={{
              background: value === d ? "var(--color-brand)" : "var(--color-paper-200)",
              color: value === d ? "white" : "var(--color-ink-600)",
            }}>
            {formatDuration(d)}
          </button>
        ))}
      </div>
    </div>
  );
}
