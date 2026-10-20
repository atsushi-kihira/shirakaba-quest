// =============================================================
// 管理画面 — 集計期間の切り替え（日／週／月（／累計））と、前後の期間への移動
// 利用状況の画面で、アクセス数・機能別の利用件数・メンバー別の内訳が共通で使う
// =============================================================
import { ChevronLeft, ChevronRight } from "lucide-react";

export type PeriodUnit = "day" | "week" | "month";
export type PeriodChoice = PeriodUnit | "all";

const UNIT_LABELS: Record<PeriodChoice, { label: string; prev: string; next: string; current: string }> = {
  day: { label: "日", prev: "前日", next: "翌日", current: "今日" },
  week: { label: "週", prev: "前週", next: "翌週", current: "今週" },
  month: { label: "月", prev: "前月", next: "翌月", current: "今月" },
  all: { label: "累計", prev: "", next: "", current: "" },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ymdToMs = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const msToYmd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** 指定のタイムゾーンでの今日の日付（YYYY-MM-DD） */
export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** 基準日を、日・週・月の単位で前後にずらす（月は1日に寄せる） */
export function shiftDate(ymd: string, unit: PeriodUnit, dir: 1 | -1): string {
  const ms = ymdToMs(ymd);
  if (unit === "day") return msToYmd(ms + dir * DAY_MS);
  if (unit === "week") return msToYmd(ms + dir * 7 * DAY_MS);
  const d = new Date(ms);
  return msToYmd(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1));
}

/** 「2026年10月20日」「2026年10月19日 〜 10月25日」「2026年10月」のような表示 */
export function rangeTitle(unit: PeriodChoice, rangeStart: string | null, rangeEnd: string | null): string {
  if (unit === "all" || !rangeStart || !rangeEnd) return "これまでの累計";
  const [sy, sm, sd] = rangeStart.split("-").map(Number);
  const [ey, em, ed] = rangeEnd.split("-").map(Number);
  if (unit === "day") return `${sy}年${sm}月${sd}日`;
  if (unit === "month") return `${sy}年${sm}月`;
  return `${sy}年${sm}月${sd}日 〜 ${ey !== sy ? `${ey}年` : ""}${em}月${ed}日`;
}

type PeriodSwitcherProps = {
  units: PeriodChoice[];
  unit: PeriodChoice;
  /** 表示中の期間の最初・最後の日（まだ読み込めていなければ null） */
  rangeStart: string | null;
  rangeEnd: string | null;
  today: string;
  onUnitChange: (unit: PeriodChoice) => void;
  onShift: (dir: 1 | -1) => void;
  onToday: () => void;
};

export function PeriodSwitcher({ units, unit, rangeStart, rangeEnd, today, onUnitChange, onShift, onToday }: PeriodSwitcherProps) {
  const labels = UNIT_LABELS[unit];
  // 今の期間より先（まだ来ていない期間）には進めない
  const atCurrent = !rangeEnd || rangeEnd >= today;
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 flex-wrap">
        {units.map((u) => (
          <button key={u}
            onClick={() => onUnitChange(u)}
            className="px-3.5 py-1.5 rounded-full text-xs font-medium transition"
            style={{
              background: unit === u ? "var(--color-brand)" : "var(--color-paper-200)",
              color: unit === u ? "white" : "var(--color-ink-600)",
            }}>
            {UNIT_LABELS[u].label}
          </button>
        ))}
      </div>
      {unit === "all" ? (
        <p className="text-sm font-semibold text-center" style={{ color: "var(--color-ink-900)" }}>これまでの累計</p>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => onShift(-1)}
            className="flex items-center gap-0.5 px-2.5 py-1.5 rounded-xl text-xs font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
            <ChevronLeft size={14} />{labels.prev}
          </button>
          <div className="text-center">
            <p className="text-sm font-semibold" style={{ color: "var(--color-ink-900)" }}>{rangeTitle(unit, rangeStart, rangeEnd)}</p>
            {!atCurrent && (
              <button onClick={onToday} className="text-xs underline" style={{ color: "var(--color-brand)" }}>
                {labels.current}に戻る
              </button>
            )}
          </div>
          <button onClick={() => onShift(1)}
            disabled={atCurrent}
            className="flex items-center gap-0.5 px-2.5 py-1.5 rounded-xl text-xs font-medium disabled:opacity-35"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
            {labels.next}<ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
