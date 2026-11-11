// =============================================================
// 定例会の「開催のルール」の入力（繰り返しパターンで作るときだけ使う）
//   ・祝日と重なる日は開催しない
//   ・開催しない日を指定する（年末年始、会場が使えない日など）
// 開催する回を作るときに、ここで指定した日は外される。
// =============================================================
import { useState } from "react";
import { Plus, X } from "lucide-react";

const MAX_EXCLUDED = 100;

function fmtDay(key: string): string {
  const d = new Date(`${key}T12:00:00+09:00`);
  const w = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", weekday: "short" }).format(d);
  return `${key.replaceAll("-", "/")}（${w}）`;
}

export function SeriesRulesPicker({ skipHolidays, onSkipHolidays, excludedDates, onExcludedDates }: {
  skipHolidays: boolean;
  onSkipHolidays: (v: boolean) => void;
  excludedDates: string[];
  onExcludedDates: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState("");

  function add() {
    if (!draft) { setMsg("日付を選んでください"); return; }
    if (excludedDates.includes(draft)) { setMsg("その日は、すでに追加されています"); return; }
    if (excludedDates.length >= MAX_EXCLUDED) { setMsg(`開催しない日は${MAX_EXCLUDED}日までです`); return; }
    setMsg("");
    onExcludedDates([...excludedDates, draft].sort());
    setDraft("");
  }

  return (
    <div>
      <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
        🗓️ 開催のルール（任意）
      </label>
      <label
        className="flex items-start gap-3 px-3 py-2.5 rounded-2xl cursor-pointer transition mb-1.5"
        style={{
          background: skipHolidays ? "rgba(212,160,59,0.12)" : "var(--color-paper-200)",
          border: skipHolidays ? "1.5px solid rgba(212,160,59,0.4)" : "1.5px solid transparent",
        }}
      >
        <input type="checkbox" className="mt-1" checked={skipHolidays} onChange={(e) => onSkipHolidays(e.target.checked)} />
        <span className="text-base">🎌</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>祝日と重なる日は開催しない</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
            祝日（振替休日を含む）にあたる日の回は、作られません
          </p>
        </div>
      </label>

      <div className="px-3 py-2.5 rounded-2xl" style={{ background: "var(--color-paper-200)" }}>
        <p className="text-sm font-medium mb-0.5" style={{ color: "var(--color-ink-800)" }}>🚫 開催しない日を指定する</p>
        <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>
          年末年始など、お休みにする日を追加します。その日の回は、作られません
        </p>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setMsg(""); }}
            className="flex-1 min-w-0 px-3 py-2.5 rounded-xl text-sm outline-none border"
            style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
          />
          <button
            type="button"
            onClick={add}
            className="shrink-0 flex items-center gap-1 px-3 py-2.5 rounded-xl text-sm font-medium text-white"
            style={{ background: "var(--color-accent)" }}
          >
            <Plus size={14} />追加
          </button>
        </div>
        {msg && <p className="text-xs mt-1.5" style={{ color: "var(--color-brand)" }}>{msg}</p>}
        {excludedDates.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {excludedDates.map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-xs"
                style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)", color: "var(--color-ink-700)" }}
              >
                {fmtDay(d)}
                <button
                  type="button"
                  aria-label={`${fmtDay(d)}を外す`}
                  onClick={() => onExcludedDates(excludedDates.filter((x) => x !== d))}
                  className="p-0.5 rounded-full"
                  style={{ color: "var(--color-ink-400)" }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 各回のタイトルに「第N回」をつけるかの選択 */
export function NumberedTitlesToggle({ value, onChange, title }: {
  value: boolean;
  onChange: (v: boolean) => void;
  /** 入力中のタイトル（例の表示に使う） */
  title: string;
}) {
  const base = title.trim() || "定例会";
  return (
    <label
      className="flex items-start gap-3 px-3 py-2.5 rounded-2xl cursor-pointer transition"
      style={{
        background: value ? "rgba(212,160,59,0.12)" : "var(--color-paper-200)",
        border: value ? "1.5px solid rgba(212,160,59,0.4)" : "1.5px solid transparent",
      }}
    >
      <input type="checkbox" className="mt-1" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-base">🔢</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>各回のタイトルに「第N回」の連番をつける</p>
        <p className="text-xs mt-0.5 break-all" style={{ color: "var(--color-ink-500)" }}>
          {value ? `例：${base}（第3回・2026/11/17）` : `例：${base}（2026/11/17）　※連番はつけず、日付だけになります`}
        </p>
      </div>
    </label>
  );
}
