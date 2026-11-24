// 回答表の並び順（回答した順 / 五十音順）を切り替えるボタン
import type { RespondentOrder } from "@/lib/respondent-order";

const OPTIONS: { value: RespondentOrder; label: string }[] = [
  { value: "answered", label: "回答した順" },
  { value: "kana", label: "五十音順" },
];

type Props = {
  order: RespondentOrder;
  onChange: (order: RespondentOrder) => void;
};

export function RespondentOrderToggle({ order, onChange }: Props) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-full" role="group" aria-label="回答表の並び順"
      style={{ background: "var(--color-paper-200)" }}>
      {OPTIONS.map((o) => {
        const active = order === o.value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={active}
            className="text-[11px] font-medium px-2.5 py-1 rounded-full transition"
            style={{
              background: active ? "var(--color-paper-50)" : "transparent",
              color: active ? "var(--color-ink-800)" : "var(--color-ink-500)",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : undefined,
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
