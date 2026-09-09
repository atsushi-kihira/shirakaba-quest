// 統合カレンダーグリッド（公開予約・メンバー間共用）
// mode='public_guest': 予約可能スロットのみ表示
// mode='member_to_member': 自分の予定 + 相手の busy + 双方空き（Phase 2）

import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2, AlertTriangle } from "lucide-react";

export type Slot = { startUtc: string; endUtc: string };
export type CalendarMode = "public_guest" | "member_to_member";
/** ログイン中のメンバーが自分の予定として重ねて表示する予定（タイトル付き・クリックで編集可） */
export type MyEvent = {
  id: string; calendarId: string; summary: string; startUtc: string; endUtc: string; allDay: boolean;
  location: string | null; description: string | null;
};

type Props = {
  mode: CalendarMode;
  availableSlots: Slot[];
  selectedSlot: Slot | null;
  durationMinutes: number;
  onSlotClick: (slot: Slot) => void;
  /** ログイン中のメンバーが自分の予定を重ねて表示する場合に渡す（タイトル付き。クリックで編集できる） */
  myEvents?: MyEvent[];
  onMyEventClick?: (event: MyEvent) => void;
  /** 自分の予定ブロックをドラッグで移動・伸縮したときに呼ばれる（PC専用。指定しない場合はドラッグ操作自体が無効） */
  onMyEventDragEnd?: (event: MyEvent, newStartUtc: string, newEndUtc: string) => void;
  /** 表示中の週の開始日（呼び出し元が管理し、データ取得範囲と同期させる） */
  weekStart: Date;
  onWeekChange: (weekStart: Date) => void;
  /** スロット取得中かどうか。true の間はグリッド本体だけをローディング表示に切り替え、
   *  ナビゲーション（前週/翌週/日付ジャンプ等）は表示し続ける */
  loading?: boolean;
  /** スロット取得に失敗した場合のメッセージ。指定するとグリッド本体をエラー表示に切り替える */
  errorMessage?: string | null;
  /** 自分の予定を表示するかどうか（呼び出し元が管理し、週の予定一覧など他の表示と連動させる） */
  showMyEvents?: boolean;
  onToggleShowMyEvents?: (show: boolean) => void;
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

// weekStart（JSTの日曜0時基準）から年・月・日を取り出す
function jstYMD(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function toDateInputValue(date: Date): string {
  const { year, month, day } = jstYMD(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
  myEvents,
  onMyEventClick,
  onMyEventDragEnd,
  weekStart,
  onWeekChange,
  loading,
  errorMessage,
  showMyEvents = false,
  onToggleShowMyEvents,
}: Props) {
  const visibleMyEvents = showMyEvents ? (myEvents ?? []) : [];
  // 自分の予定を重ねて表示すると各列が半分の幅になり、時刻表示（例: "10:30"）が
  // 1文字程度しか入らず読めなくなるため、狭い間はスロットの時刻テキストを省略する
  const isNarrow = visibleMyEvents.length > 0;

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

  // 自分の予定を dateKey → 予定[] にグルーピング（終日予定は時間軸のグリッドに24時間分の高さで
  // 表示すると他の予定を覆い隠してしまうため、別枠（日付ヘッダー下のバッジ）で表示する）
  const myEventsByDate = useMemo(() => {
    const map = new Map<string, MyEvent[]>();
    for (const ev of visibleMyEvents) {
      if (ev.allDay) continue;
      const { dateKey } = toJSTHourMin(ev.startUtc);
      const arr = map.get(dateKey) ?? [];
      arr.push(ev);
      map.set(dateKey, arr);
    }
    return map;
  }, [visibleMyEvents]);

  const allDayEventsByDate = useMemo(() => {
    const map = new Map<string, MyEvent[]>();
    for (const ev of visibleMyEvents) {
      if (!ev.allDay) continue;
      const { dateKey } = toJSTHourMin(ev.startUtc);
      const arr = map.get(dateKey) ?? [];
      arr.push(ev);
      map.set(dateKey, arr);
    }
    return map;
  }, [visibleMyEvents]);

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

  // 前月・翌月：現在の週の最初の日を基準に、月をまたいで移動した先の日付が属する週へジャンプする
  function shiftMonth(delta: number) {
    const { year, month, day } = jstYMD(weekStart);
    const target = new Date(Date.UTC(year, month - 1 + delta, day, 12));
    onWeekChange(startOfWeekJST(target));
  }

  function jumpToDate(value: string) {
    if (!value) return;
    const [y, m, d] = value.split("-").map(Number);
    const target = new Date(Date.UTC(y, m - 1, d, 12));
    onWeekChange(startOfWeekJST(target));
  }

  const isPast = weekStart.getTime() < startOfWeekJST(new Date()).getTime();

  // スロットの位置を計算（左半分に配置。右半分は自分の予定用）
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
    return {
      top: `${top}px`, height: `${Math.max(height - 2, 18)}px`, zIndex: selected ? 10 : 1,
      left: "2px", width: isNarrow ? "calc(50% - 3px)" : "calc(100% - 4px)",
    };
  }

  // ---- 自分の予定のドラッグ移動・伸縮（PC専用。onMyEventDragEnd が指定されている場合のみ有効） ----
  type DragMode = "move" | "resize-top" | "resize-bottom";
  const [dragPreview, setDragPreview] = useState<{ eventId: string; mode: DragMode; deltaMinutes: number } | null>(null);
  const justDraggedRef = useRef(false);
  const MIN_EVENT_MINUTES = 15;

  function previewRange(block: MyEvent): { startMs: number; endMs: number } {
    let startMs = new Date(block.startUtc).getTime();
    let endMs = new Date(block.endUtc).getTime();
    if (dragPreview?.eventId === block.id) {
      const deltaMs = dragPreview.deltaMinutes * 60_000;
      if (dragPreview.mode === "move") { startMs += deltaMs; endMs += deltaMs; }
      else if (dragPreview.mode === "resize-top") startMs = Math.min(endMs - MIN_EVENT_MINUTES * 60_000, startMs + deltaMs);
      else if (dragPreview.mode === "resize-bottom") endMs = Math.max(startMs + MIN_EVENT_MINUTES * 60_000, endMs + deltaMs);
    }
    return { startMs, endMs };
  }

  function handleDragStart(e: React.MouseEvent, ev: MyEvent, mode: DragMode) {
    if (!onMyEventDragEnd) return;
    e.preventDefault();
    e.stopPropagation();
    const origStartMs = new Date(ev.startUtc).getTime();
    const origEndMs = new Date(ev.endUtc).getTime();
    const startY = e.clientY;
    let draggedEnough = false;
    let deltaMinutes = 0;

    function onMove(me: MouseEvent) {
      const dyPx = me.clientY - startY;
      if (Math.abs(dyPx) > 3) draggedEnough = true;
      const rawMinutes = dyPx * (60 / cellHeightPx);
      deltaMinutes = Math.round(rawMinutes / 15) * 15;
      setDragPreview({ eventId: ev.id, mode, deltaMinutes });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDragPreview(null);
      if (!draggedEnough) return;
      justDraggedRef.current = true;
      const deltaMs = deltaMinutes * 60_000;
      let newStartMs = origStartMs, newEndMs = origEndMs;
      if (mode === "move") { newStartMs += deltaMs; newEndMs += deltaMs; }
      else if (mode === "resize-top") newStartMs = Math.min(origEndMs - MIN_EVENT_MINUTES * 60_000, origStartMs + deltaMs);
      else if (mode === "resize-bottom") newEndMs = Math.max(origStartMs + MIN_EVENT_MINUTES * 60_000, origEndMs + deltaMs);
      onMyEventDragEnd?.(ev, new Date(newStartMs).toISOString(), new Date(newEndMs).toISOString());
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function handleMyEventClick(ev: MyEvent) {
    if (justDraggedRef.current) { justDraggedRef.current = false; return; }
    onMyEventClick?.(ev);
  }

  // 自分の予定ブロックの位置を計算（右半分に配置。開始・終了時刻は任意。ドラッグ中はプレビュー位置を反映する）
  function blockStyle(block: MyEvent): React.CSSProperties {
    const { startMs, endMs } = previewRange(block);
    const start = toJSTHourMin(new Date(startMs).toISOString());
    const topMinutes = (start.hour - (visibleHours[0] ?? 9)) * 60 + start.min;
    const durationMin = Math.max(0, (endMs - startMs) / 60_000);
    const top = (topMinutes / totalMinutesVisible) * gridHeight;
    const height = (durationMin / totalMinutesVisible) * gridHeight;
    const isDragging = dragPreview?.eventId === block.id;
    return {
      top: `${top}px`, height: `${Math.max(height, 12)}px`,
      left: "calc(50% + 1px)", width: "calc(50% - 3px)",
      ...(isDragging && {
        opacity: 0.85, zIndex: 20,
        boxShadow: "0 3px 10px rgba(0,0,0,0.28)",
        cursor: dragPreview!.mode === "move" ? "grabbing" : "ns-resize",
      }),
    };
  }

  const isSelected = (slot: Slot) =>
    selectedSlot?.startUtc === slot.startUtc && selectedSlot?.endUtc === slot.endUtc;

  return (
    <div className="select-none">
      {/* ナビゲーション（読み込み中・エラー中も常に表示し、操作できるようにする） */}
      <div className="flex items-center justify-between mb-2 px-1 flex-wrap gap-y-2">
        <div className="flex items-center gap-2">
          <button
            onClick={prevWeek}
            disabled={isPast}
            className="p-1.5 rounded-lg disabled:opacity-30"
            style={{ background: "var(--color-paper-100)" }}
            aria-label="前週"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={nextWeek}
            className="p-1.5 rounded-lg"
            style={{ background: "var(--color-paper-100)" }}
            aria-label="翌週"
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

      <div className="flex items-center gap-2 mb-3 px-1">
        <button
          onClick={() => shiftMonth(-1)}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg"
          style={{ background: "var(--color-paper-100)", color: "var(--color-ink-600)" }}
        >
          <ChevronsLeft size={13} />
          前月
        </button>
        <input
          type="date"
          value={toDateInputValue(weekStart)}
          onChange={(e) => jumpToDate(e.target.value)}
          className="text-xs px-2 py-1 rounded-lg border flex-1 min-w-0"
          style={{ borderColor: "var(--color-paper-300)", background: "white", color: "var(--color-ink-700)" }}
          aria-label="日付を指定してジャンプ"
        />
        <button
          onClick={() => shiftMonth(1)}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg"
          style={{ background: "var(--color-paper-100)", color: "var(--color-ink-600)" }}
        >
          翌月
          <ChevronsRight size={13} />
        </button>
      </div>

      {/* グリッド本体：読み込み中・エラー時はここだけを差し替える */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="animate-spin" size={24} style={{ color: "var(--color-ink-400)" }} />
        </div>
      ) : errorMessage ? (
        <div className="text-center py-10">
          <AlertTriangle className="mx-auto mb-2" size={26} style={{ color: "var(--color-brand)" }} />
          <p className="text-sm" style={{ color: "var(--color-ink-600)" }}>{errorMessage}</p>
        </div>
      ) : (
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

          {/* 終日の予定（自分の予定）：時間軸のグリッドに24時間分の高さで表示すると他の予定を
              覆い隠してしまうため、日付ヘッダーの下に小さなバッジとして別枠表示する */}
          {visibleMyEvents.some((ev) => ev.allDay) && (
            <div className="flex" style={{ marginLeft: "36px" }}>
              {days.map(({ dateKey }) => {
                const dayAllDayEvents = allDayEventsByDate.get(dateKey) ?? [];
                return (
                  <div
                    key={dateKey}
                    className="flex-1 px-0.5 pb-1 space-y-0.5"
                    style={{ borderLeft: "1px solid var(--color-paper-300)" }}
                  >
                    {dayAllDayEvents.map((ev) => (
                      <button
                        key={ev.id}
                        type="button"
                        title={ev.summary}
                        onClick={() => onMyEventClick?.(ev)}
                        disabled={!onMyEventClick}
                        className="w-full rounded text-[9px] leading-tight text-left px-1 py-0.5 truncate"
                        style={{
                          background: "rgba(181,56,75,0.16)",
                          color: "var(--color-brand)",
                          cursor: onMyEventClick ? "pointer" : "default",
                        }}
                      >
                        {ev.summary}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

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
              const dayMyEvents = myEventsByDate.get(dateKey) ?? [];
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

                  {/* 予約可能スロット（重ならないよう左半分に配置） */}
                  {daySlots.map((slot) => {
                    const selected = isSelected(slot);
                    return (
                      <button
                        key={slot.startUtc}
                        onClick={() => onSlotClick(slot)}
                        title={selected ? `${formatTimeJST(slot.startUtc)}〜${formatTimeJST(slot.endUtc)}` : formatTimeJST(slot.startUtc)}
                        className="absolute rounded text-xs font-medium transition-all overflow-hidden"
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
                        {/* 自分の予定と重ねて表示領域が狭い時は、時刻が1文字しか入らず読めないため非表示にする */}
                        {!isNarrow && (
                          <span className="block px-1 truncate">
                            {selected
                              ? `${formatTimeJST(slot.startUtc)}〜${formatTimeJST(slot.endUtc)}`
                              : formatTimeJST(slot.startUtc)}
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {/* 自分の予定（タイトル付き・クリックで編集。重ならないよう右半分に配置。
                      PCではドラッグで移動・上下端のつまみで伸縮できる） */}
                  {dayMyEvents.map((ev) => (
                    <button
                      key={ev.id}
                      title={ev.summary}
                      onClick={() => handleMyEventClick(ev)}
                      onMouseDown={(e) => handleDragStart(e, ev, "move")}
                      disabled={!onMyEventClick && !onMyEventDragEnd}
                      className="absolute rounded text-left overflow-hidden"
                      style={{
                        ...blockStyle(ev),
                        background: "repeating-linear-gradient(45deg, rgba(181,56,75,0.14), rgba(181,56,75,0.14) 4px, rgba(181,56,75,0.22) 4px, rgba(181,56,75,0.22) 8px)",
                        border: "1px solid rgba(181,56,75,0.35)",
                        cursor: onMyEventDragEnd ? "grab" : onMyEventClick ? "pointer" : "default",
                      }}
                    >
                      {onMyEventDragEnd && (
                        <>
                          <div
                            onMouseDown={(e) => handleDragStart(e, ev, "resize-top")}
                            className="absolute top-0 left-0 w-full"
                            style={{ height: "5px", cursor: "ns-resize" }}
                          />
                          <div
                            onMouseDown={(e) => handleDragStart(e, ev, "resize-bottom")}
                            className="absolute bottom-0 left-0 w-full"
                            style={{ height: "5px", cursor: "ns-resize" }}
                          />
                        </>
                      )}
                      <span
                        className="block px-1 text-[9px] leading-[1.15]"
                        style={{
                          color: "var(--color-brand)",
                          display: "-webkit-box",
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          wordBreak: "break-all",
                          pointerEvents: "none",
                        }}
                      >
                        {ev.summary}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      )}

      {/* 凡例 */}
      <div className="flex items-center gap-4 mt-3 px-1 text-xs flex-wrap" style={{ color: "var(--color-ink-400)" }}>
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
        {myEvents && myEvents.length > 0 && (
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showMyEvents}
              onChange={(e) => onToggleShowMyEvents?.(e.target.checked)}
              className="w-3.5 h-3.5"
            />
            <div
              className="w-4 h-4 rounded"
              style={{
                background: "repeating-linear-gradient(45deg, rgba(181,56,75,0.14), rgba(181,56,75,0.14) 4px, rgba(181,56,75,0.22) 4px, rgba(181,56,75,0.22) 8px)",
                border: "1px solid rgba(181,56,75,0.35)",
              }}
            />
            <span>あなたの予定を表示（タップで編集）</span>
          </label>
        )}
      </div>
    </div>
  );
}
