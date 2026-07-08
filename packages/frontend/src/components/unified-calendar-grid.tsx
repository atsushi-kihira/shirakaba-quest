// 統合カレンダーグリッド（公開予約・メンバー間共用）
// mode='public_guest': 予約可能スロットのみ表示
// mode='member_to_member': 自分の予定 + 相手の busy + 双方空き（Phase 2）

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type Slot = { startUtc: string; endUtc: string };
export type CalendarMode = "public_guest" | "member_to_member";

type Props = {
  mode: CalendarMode;
  availableSlots: Slot[];
  selectedSlot: Slot | null;
  durationMinutes: number;
  onSlotClick: (slot: Slot) => void;
  /** ログイン中のメンバーが自分の予定を参考表示する場合に渡す（busy ブロック） */
  myBusyBlocks?: Slot[];
  /** 表示中の週の開始日（呼び出し元が管理し、データ取得範囲と同期させる） */
  weekStart: Date;
  onWeekChange: (weekStart: Date) => void;
};

const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function formatTimeJST(isoStr: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(isoStr));
}

function startOfWeekJST(date: Date): Date {
  const d = new Date(date);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)!.value);
  const year = get("year"), month = get("month") - 1, day = get("day");
  const weekday = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(
    parts.find((p) => p.type === "weekday")!.value
  );
  const utcMidnight = Date.UTC(year, month, day - weekday);
  return new Date(utcMidnight);
}

// UTC ms を JST の小時間（0-23）と分（0-59）に変換
function toJSTHourMin(isoStr: string): { hour: number; min: number; dateKey: string } {
  const d = new Date(isoStr);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    hour: parseInt(get("hour")),
    min: parseInt(get("minute")),
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

export default function UnifiedCalendarGrid({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  mode: _mode,
  availableSlots,
  selectedSlot,
  durationMinutes,
  onSlotClick,
  myBusyBlocks,
  weekStart,
  onWeekChange,
}: Props) {
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart.getTime() + i * 86400_000);
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Tokyo",
        year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(d);
      const get = (t: string) => parts.find((p) => p.type === t)!.value;
      return { dateKey: `${get("year")}-${get("month")}-${get("day")}`, date: d };
    });
  }, [weekStart]);

  // スロットを dateKey → スロット[] にグルーピング
  const slotsByDate = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const slot of availableSlots) {
      const { dateKey } = toJSTHourMin(slot.startUtc);
      const arr = map.get(dateKey) ?? [];
      arr.push(slot);
      map.set(dateKey, arr);
    }
    return map;
  }, [availableSlots]);

  // 自分の busy ブロックを dateKey → ブロック[] にグルーピング
  const myBusyByDate = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const block of myBusyBlocks ?? []) {
      const { dateKey } = toJSTHourMin(block.startUtc);
      const arr = map.get(dateKey) ?? [];
      arr.push(block);
      map.set(dateKey, arr);
    }
    return map;
  }, [myBusyBlocks]);

  // 表示する時間帯を算出（スロットがある時間帯のみ）
  const visibleHours = useMemo(() => {
    const hoursWithSlots = new Set<number>();
    for (const slot of availableSlots) {
      const { hour } = toJSTHourMin(slot.startUtc);
      for (let h = hour; h <= Math.min(23, hour + Math.ceil(durationMinutes / 60)); h++) {
        hoursWithSlots.add(h);
      }
    }
    if (hoursWithSlots.size === 0) return Array.from({ length: 10 }, (_, i) => i + 9);
    const sorted = Array.from(hoursWithSlots).sort((a, b) => a - b);
    const min = Math.max(0, sorted[0] - 1);
    const max = Math.min(23, sorted[sorted.length - 1] + 1);
    return Array.from({ length: max - min + 1 }, (_, i) => i + min);
  }, [availableSlots, durationMinutes]);

  const cellHeightPx = 48;
  const totalMinutesVisible = visibleHours.length * 60;
  const gridHeight = visibleHours.length * cellHeightPx;

  // スロット同士の最短間隔（分）を算出し、表示ボックスの高さがそれを超えて
  // 隣のスロットと重ならないようにする（例: 60分枠を30分間隔で並べる場合）
  const minIntervalMinutes = useMemo(() => {
    const startsByDate = new Map<string, number[]>();
    for (const slot of availableSlots) {
      const { hour, min: startMin, dateKey } = toJSTHourMin(slot.startUtc);
      const arr = startsByDate.get(dateKey) ?? [];
      arr.push(hour * 60 + startMin);
      startsByDate.set(dateKey, arr);
    }
    let minGap = Infinity;
    for (const starts of startsByDate.values()) {
      const sorted = [...starts].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i] - sorted[i - 1];
        if (gap > 0 && gap < minGap) minGap = gap;
      }
    }
    return Number.isFinite(minGap) ? minGap : durationMinutes;
  }, [availableSlots, durationMinutes]);

  const prevWeek = () => onWeekChange(new Date(weekStart.getTime() - 7 * 86400_000));
  const nextWeek = () => onWeekChange(new Date(weekStart.getTime() + 7 * 86400_000));
  const todayWeek = () => onWeekChange(startOfWeekJST(new Date()));

  const isPast = weekStart.getTime() < startOfWeekJST(new Date()).getTime();

  // スロットの位置を計算
  // 開始間隔が枠の長さより短い場合（例: 60分枠を30分間隔で並べる）は
  // 未選択時はボックスの高さを間隔以下に抑え、隣のスロットと重ならないようにする。
  // 選択中のスロットだけは実際の所要時間（durationMinutes）どおりの高さで表示し、
  // 見た目と実際に確保される時間が食い違わないようにする。
  function slotStyle(slot: Slot, selected: boolean): React.CSSProperties {
    const { hour, min } = toJSTHourMin(slot.startUtc);
    const topMinutes = (hour - (visibleHours[0] ?? 9)) * 60 + min;
    const top = (topMinutes / totalMinutesVisible) * gridHeight;
    const displayMinutes = selected ? durationMinutes : Math.min(durationMinutes, minIntervalMinutes);
    const height = (displayMinutes / totalMinutesVisible) * gridHeight;
    return { top: `${top}px`, height: `${Math.max(height - 2, 18)}px`, zIndex: selected ? 10 : 1 };
  }

  // busy ブロックの位置を計算（開始・終了時刻が任意）
  function blockStyle(block: Slot): React.CSSProperties {
    const start = toJSTHourMin(block.startUtc);
    const topMinutes = (start.hour - (visibleHours[0] ?? 9)) * 60 + start.min;
    const durationMin = Math.max(0, (new Date(block.endUtc).getTime() - new Date(block.startUtc).getTime()) / 60_000);
    const top = (topMinutes / totalMinutesVisible) * gridHeight;
    const height = (durationMin / totalMinutesVisible) * gridHeight;
    return { top: `${top}px`, height: `${Math.max(height, 12)}px` };
  }

  const isSelected = (slot: Slot) =>
    selectedSlot?.startUtc === slot.startUtc && selectedSlot?.endUtc === slot.endUtc;

  return (
    <div className="select-none">
      {/* ナビゲーション */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <button
            onClick={prevWeek}
            disabled={isPast}
            className="p-1.5 rounded-lg disabled:opacity-30"
            style={{ background: "var(--color-paper-100)" }}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={nextWeek}
            className="p-1.5 rounded-lg"
            style={{ background: "var(--color-paper-100)" }}
          >
            <ChevronRight size={16} />
          </button>
          <span className="text-sm font-medium" style={{ color: "var(--color-ink-700)" }}>
            {new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long" }).format(days[0]?.date)}
          </span>
        </div>
        <button
          onClick={todayWeek}
          className="text-xs px-3 py-1 rounded-full border"
          style={{ borderColor: "var(--color-paper-300)", color: "var(--color-ink-500)" }}
        >
          今週
        </button>
      </div>

      {/* カレンダーグリッド */}
      <div className="overflow-x-auto">
        <div className="min-w-[420px]">
          {/* ヘッダー行（曜日）*/}
          <div className="flex" style={{ marginLeft: "36px" }}>
            {days.map(({ dateKey, date }) => {
              const isToday = dateKey === toJSTHourMin(new Date().toISOString()).dateKey;
              return (
                <div
                  key={dateKey}
                  className="flex-1 text-center py-1.5"
                  style={{ borderLeft: "1px solid var(--color-paper-300)" }}
                >
                  <div
                    className="text-xs"
                    style={{ color: "var(--color-ink-400)" }}
                  >
                    {DOW_LABELS[date.getUTCDay()]}
                  </div>
                  <div
                    className={`text-sm font-semibold mt-0.5 w-7 h-7 rounded-full flex items-center justify-center mx-auto ${isToday ? "text-white" : ""}`}
                    style={{
                      background: isToday ? "var(--color-brand)" : "transparent",
                      color: isToday ? "white" : "var(--color-ink-700)",
                    }}
                  >
                    {date.getUTCDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 時間軸 + グリッド */}
          <div className="flex relative" style={{ height: `${gridHeight}px` }}>
            {/* 時刻ラベル列 */}
            <div className="flex-shrink-0" style={{ width: "36px" }}>
              {visibleHours.map((h) => (
                <div
                  key={h}
                  className="text-right pr-1 text-xs leading-none"
                  style={{
                    height: `${cellHeightPx}px`,
                    paddingTop: "2px",
                    color: "var(--color-ink-400)",
                  }}
                >
                  {h}:00
                </div>
              ))}
            </div>

            {/* 日別カラム */}
            {days.map(({ dateKey }) => {
              const daySlots = slotsByDate.get(dateKey) ?? [];
              const dayBusyBlocks = myBusyByDate.get(dateKey) ?? [];
              return (
                <div
                  key={dateKey}
                  className="flex-1 relative"
                  style={{ borderLeft: "1px solid var(--color-paper-300)" }}
                >
                  {/* 時間グリッド線 */}
                  {visibleHours.map((h) => (
                    <div
                      key={h}
                      className="absolute w-full"
                      style={{
                        top: `${(h - (visibleHours[0] ?? 9)) * cellHeightPx}px`,
                        height: `${cellHeightPx}px`,
                        borderTop: "1px solid var(--color-paper-200)",
                      }}
                    />
                  ))}

                  {/* 自分の予定（参考表示） */}
                  {dayBusyBlocks.map((block, i) => (
                    <div
                      key={`busy-${i}`}
                      className="absolute left-0.5 right-0.5 rounded pointer-events-none"
                      style={{
                        ...blockStyle(block),
                        background: "repeating-linear-gradient(45deg, rgba(181,56,75,0.12), rgba(181,56,75,0.12) 4px, rgba(181,56,75,0.2) 4px, rgba(181,56,75,0.2) 8px)",
                        border: "1px solid rgba(181,56,75,0.3)",
                      }}
                    />
                  ))}

                  {/* 予約可能スロット */}
                  {daySlots.map((slot) => {
                    const selected = isSelected(slot);
                    return (
                      <button
                        key={slot.startUtc}
                        onClick={() => onSlotClick(slot)}
                        className="absolute left-0.5 right-0.5 rounded text-xs font-medium transition-all overflow-hidden"
                        style={{
                          ...slotStyle(slot, selected),
                          background: selected
                            ? "var(--color-success)"
                            : "rgba(90,140,92,0.15)",
                          border: selected
                            ? "2px solid var(--color-success)"
                            : "2px dashed var(--color-success)",
                          color: selected ? "white" : "var(--color-success)",
                        }}
                      >
                        <span className="block px-1 truncate">
                          {selected
                            ? `${formatTimeJST(slot.startUtc)}〜${formatTimeJST(slot.endUtc)}`
                            : formatTimeJST(slot.startUtc)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 凡例 */}
      <div className="flex items-center gap-4 mt-3 px-1 text-xs" style={{ color: "var(--color-ink-400)" }}>
        <div className="flex items-center gap-1.5">
          <div
            className="w-4 h-4 rounded"
            style={{ border: "2px dashed var(--color-success)", background: "rgba(90,140,92,0.15)" }}
          />
          <span>予約可能</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded" style={{ background: "var(--color-success)" }} />
          <span>選択中</span>
        </div>
        {myBusyBlocks && myBusyBlocks.length > 0 && (
          <div className="flex items-center gap-1.5">
            <div
              className="w-4 h-4 rounded"
              style={{
                background: "repeating-linear-gradient(45deg, rgba(181,56,75,0.12), rgba(181,56,75,0.12) 4px, rgba(181,56,75,0.2) 4px, rgba(181,56,75,0.2) 8px)",
                border: "1px solid rgba(181,56,75,0.3)",
              }}
            />
            <span>あなたの予定</span>
          </div>
        )}
      </div>
    </div>
  );
}
