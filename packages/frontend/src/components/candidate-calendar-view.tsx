// =============================================================
// 候補日時を「自分のカレンダー」と重ねて表示し、そのまま選べる週間グリッド
// 招待された側が、提示された候補（1to1・通常ミーティング・定例会）から都合の良い日を選ぶときに使う。
//
// ・自分のGoogleカレンダーの予定は斜線の薄い色、候補は上に重ねて表示する（予定と重なる候補には ⚠）
// ・候補をクリック／タップすると onSlotClick が呼ばれる（選択・回答の切り替えは呼び出し側で行う）
// ・候補のある週をチップで選べ、最初は直近の候補がある週を表示する
// ・未ログイン／Google未連携でも、候補だけは表示する（連携のご案内を添える）
// =============================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useTimezone } from "@/hooks/use-timezone";

type MyEvent = { id: string; summary: string; startUtc: string; endUtc: string; allDay: boolean };
type CalendarEventsResponse = { data: { connected: boolean; events: MyEvent[] } };

export type CalendarSlotState = "selected" | "yes" | "maybe" | "no";
export type CalendarSlot = {
  /** 呼び出し側が選択・回答の対象を特定するID（同じIDの枠が複数あってもよい。例：定例会の同じパターンの各回） */
  id: string;
  startAt: number; // unix秒
  endAt: number;
  /** 枠に表示する短い名前（例：「候補1」） */
  label: string;
  /** 状態（選択中・回答済みなど）。未指定は「未選択／未回答」 */
  state?: CalendarSlotState;
};

const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const CELL_HEIGHT_PX = 44;
const DAY_MS = 86400_000;
const MAX_WEEK_CHIPS = 6; // 候補のある週のチップは直近の分だけ（それ以降は ◀ ▶ で移動）

const STATE_STYLE: Record<CalendarSlotState | "none", { bg: string; border: string; color: string }> = {
  selected: { bg: "var(--color-brand)", border: "var(--color-brand)", color: "#fff" },
  yes: { bg: "rgba(90,140,92,0.85)", border: "var(--color-success)", color: "#fff" },
  maybe: { bg: "rgba(212,160,59,0.85)", border: "#D4A03B", color: "#fff" },
  no: { bg: "rgba(160,150,140,0.55)", border: "var(--color-ink-400)", color: "#fff" },
  none: { bg: "rgba(255,255,255,0.92)", border: "var(--color-brand)", color: "var(--color-brand)" },
};

type Ymd = { y: number; m: number; d: number };

function partsOf(ms: number, tz: string): { ymd: Ymd; minutes: number; dow: number } {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(new Date(ms));
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return {
    ymd: { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")) },
    minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")),
    dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
  };
}
const keyOf = (v: Ymd): string => `${v.y}-${String(v.m).padStart(2, "0")}-${String(v.d).padStart(2, "0")}`;
/** 暦上の日付（時刻・タイムゾーンなし）として扱うためのUTC 0時 */
const dayMs = (v: Ymd): number => Date.UTC(v.y, v.m - 1, v.d);
const ymdFromDayMs = (ms: number): Ymd => { const d = new Date(ms); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; };
const weekStartOf = (ms: number, tz: string): number => { const { ymd, dow } = partsOf(ms, tz); return dayMs(ymd) - dow * DAY_MS; };
const pad2 = (n: number): string => String(n).padStart(2, "0");
const hhmm = (minutes: number): string => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;

export function CandidateCalendarView({ slots, onSlotClick, legend, canCheckCalendar = true }: {
  slots: CalendarSlot[];
  onSlotClick?: (slotId: string) => void;
  /** 凡例の補足（例：「タップで ○△× を切り替え」） */
  legend?: string;
  /** false のとき、自分のカレンダーは読み込まない（本人以外が見ている場合など） */
  canCheckCalendar?: boolean;
}) {
  const tz = useTimezone();
  const loggedIn = !!useAuthStore((s) => s.token) && !!useAuthStore((s) => s.user);
  const sorted = useMemo(() => [...slots].sort((a, b) => a.startAt - b.startAt), [slots]);

  // 候補のある週（古い順）。最初は、いま以降で最も近い候補がある週を表示する
  const candidateWeeks = useMemo(() => [...new Set(sorted.map((s) => weekStartOf(s.startAt * 1000, tz)))].sort((a, b) => a - b), [sorted, tz]);
  const initialWeek = useMemo(() => {
    const now = Date.now();
    const upcoming = sorted.find((s) => s.endAt * 1000 >= now) ?? sorted[0];
    return upcoming ? weekStartOf(upcoming.startAt * 1000, tz) : weekStartOf(now, tz);
  }, [sorted, tz]);
  const [weekStart, setWeekStart] = useState<number | null>(null);
  const week = weekStart ?? initialWeek;
  const days = Array.from({ length: 7 }, (_, i) => ymdFromDayMs(week + i * DAY_MS));
  const fromStr = keyOf(days[0]);
  const toStr = keyOf(days[6]);

  const enabled = loggedIn && canCheckCalendar;
  const { data, isLoading } = useQuery({
    queryKey: ["scheduler", "my-calendar-events", fromStr],
    queryFn: () => api.get<CalendarEventsResponse>(`/scheduler/me/calendar-events?from=${fromStr}&to=${toStr}`),
    enabled,
    retry: false,
  });
  const connected = data?.data.connected;
  const events = useMemo(() => (connected ? data!.data.events : []), [connected, data]);
  const timedEvents = events.filter((e) => !e.allDay);

  // 表示する時間帯：基本は 7:00〜23:00。範囲外の候補・予定があれば広げる
  const weekSlots = sorted.filter((s) => keyOf(partsOf(s.startAt * 1000, tz).ymd) >= fromStr && keyOf(partsOf(s.startAt * 1000, tz).ymd) <= toStr);
  const { startHour, endHour } = useMemo(() => {
    let lo = 7 * 60, hi = 23 * 60;
    for (const s of weekSlots) {
      lo = Math.min(lo, partsOf(s.startAt * 1000, tz).minutes);
      hi = Math.max(hi, partsOf(s.endAt * 1000, tz).minutes || 24 * 60);
    }
    return { startHour: Math.floor(lo / 60), endHour: Math.min(24, Math.ceil(hi / 60)) };
  }, [weekSlots, tz]);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const gridHeight = hours.length * CELL_HEIGHT_PX;
  const toPx = (minutes: number): number => ((minutes - startHour * 60) / 60) * CELL_HEIGHT_PX;

  const todayKey = keyOf(partsOf(Date.now(), tz).ymd);

  /** 各枠が、自分の予定と重なっているか */
  function conflictsWith(s: CalendarSlot): boolean {
    const a = s.startAt * 1000, b = s.endAt * 1000;
    return timedEvents.some((e) => new Date(e.startUtc).getTime() < b && new Date(e.endUtc).getTime() > a);
  }

  function weekChipLabel(w: number): string {
    const d = ymdFromDayMs(w);
    return `${d.m}/${d.d}〜`;
  }

  return (
    <div className="select-none rounded-2xl p-2.5" style={{ background: "white", border: "1px solid var(--color-paper-300)" }}>
      {!loggedIn ? (
        <p className="mb-2 text-[11px]" style={{ color: "var(--color-ink-500)" }}>
          📅 ログインすると、あなたの予定も重ねて表示されます。
          <Link to={`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`} className="ml-1 font-medium underline" style={{ color: "var(--color-brand)" }}>
            ログインする →
          </Link>
        </p>
      ) : connected === false ? (
        <p className="mb-2 text-[11px]" style={{ color: "var(--color-ink-500)" }}>
          📅 Googleカレンダーと連携すると、あなたの予定も重ねて表示されます。
          <Link to="/scheduler/settings" className="ml-1 font-medium underline" style={{ color: "var(--color-brand)" }}>連携する →</Link>
        </p>
      ) : null}

      {candidateWeeks.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <span className="text-[11px]" style={{ color: "var(--color-ink-500)" }}>候補のある週：</span>
          {candidateWeeks.slice(0, MAX_WEEK_CHIPS).map((w) => (
            <button key={w} type="button" onClick={() => setWeekStart(w)}
              className="text-[11px] font-medium px-2 py-0.5 rounded-full"
              style={{
                background: w === week ? "var(--color-brand)" : "var(--color-paper-200)",
                color: w === week ? "white" : "var(--color-ink-600)",
              }}>
              {weekChipLabel(w)}
            </button>
          ))}
          {candidateWeeks.length > MAX_WEEK_CHIPS && <span className="text-[11px]" style={{ color: "var(--color-ink-400)" }}>…（以降は ◀ ▶ で移動）</span>}
        </div>
      )}

      <div className="flex items-center justify-between mb-1.5">
        <button type="button" onClick={() => setWeekStart(week - 7 * DAY_MS)} className="p-1.5 rounded-lg" style={{ color: "var(--color-ink-500)" }} aria-label="前の週">
          <ChevronLeft size={16} />
        </button>
        <span className="text-xs font-medium flex items-center gap-1.5" style={{ color: "var(--color-ink-700)" }}>
          {fromStr.replace(/-/g, "/")} 〜 {toStr.replace(/-/g, "/")}
          {enabled && isLoading && <Loader2 size={12} className="animate-spin" style={{ color: "var(--color-ink-400)" }} />}
        </span>
        <button type="button" onClick={() => setWeekStart(week + 7 * DAY_MS)} className="p-1.5 rounded-lg" style={{ color: "var(--color-ink-500)" }} aria-label="次の週">
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[420px]">
          {/* 曜日・日付 */}
          <div className="flex" style={{ marginLeft: "36px" }}>
            {days.map((d, i) => {
              const k = keyOf(d);
              const isToday = k === todayKey;
              const allDay = events.filter((e) => e.allDay && e.startUtc.slice(0, 10) <= k && k < e.endUtc.slice(0, 10));
              return (
                <div key={k} className="flex-1 text-center py-1" style={{ borderLeft: "1px solid var(--color-paper-300)", minWidth: 0 }}>
                  <div className="text-xs" style={{ color: i === 0 ? "var(--color-brand)" : "var(--color-ink-400)" }}>{DOW_LABELS[i]}</div>
                  <div className="text-sm font-semibold mt-0.5 w-7 h-7 rounded-full flex items-center justify-center mx-auto"
                    style={{ background: isToday ? "var(--color-brand)" : "transparent", color: isToday ? "white" : "var(--color-ink-700)" }}>
                    {d.d}
                  </div>
                  {allDay.length > 0 && (
                    <div className="mx-0.5 mt-0.5 px-0.5 rounded text-[9px] leading-tight truncate" title={allDay.map((e) => e.summary).join("、")}
                      style={{ background: "rgba(181,56,75,0.12)", color: "var(--color-brand)" }}>
                      終日: {allDay[0].summary}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 時間軸＋グリッド */}
          <div className="flex relative" style={{ height: `${gridHeight}px` }}>
            <div className="flex-shrink-0" style={{ width: "36px" }}>
              {hours.map((h) => (
                <div key={h} className="text-right pr-1 text-xs leading-none" style={{ height: `${CELL_HEIGHT_PX}px`, paddingTop: "2px", color: "var(--color-ink-400)" }}>
                  {h}:00
                </div>
              ))}
            </div>

            {days.map((d) => {
              const k = keyOf(d);
              const dayEvents = timedEvents.filter((e) => keyOf(partsOf(new Date(e.startUtc).getTime(), tz).ymd) === k);
              const daySlots = weekSlots.filter((s) => keyOf(partsOf(s.startAt * 1000, tz).ymd) === k);
              return (
                <div key={k} className="flex-1 relative" style={{ borderLeft: "1px solid var(--color-paper-300)", minWidth: 0 }}>
                  {hours.map((h) => (
                    <div key={h} className="absolute w-full" style={{ top: `${(h - startHour) * CELL_HEIGHT_PX}px`, height: `${CELL_HEIGHT_PX}px`, borderTop: "1px solid var(--color-paper-200)" }} />
                  ))}

                  {/* 自分の予定（候補の下に薄く表示） */}
                  {dayEvents.map((ev) => {
                    const s = partsOf(new Date(ev.startUtc).getTime(), tz);
                    const e = partsOf(new Date(ev.endUtc).getTime(), tz);
                    const startMin = s.minutes;
                    const endMin = keyOf(e.ymd) === k ? e.minutes : endHour * 60;
                    const top = Math.max(0, toPx(startMin));
                    const height = Math.max(10, toPx(Math.max(endMin, startMin + 15)) - top);
                    return (
                      <div key={ev.id} title={`${ev.summary || "予定"}（${hhmm(startMin)}〜${hhmm(endMin)}）`}
                        className="absolute rounded overflow-hidden pointer-events-none"
                        style={{
                          top: `${top}px`, height: `${height}px`, left: "1px", right: "1px",
                          background: "repeating-linear-gradient(45deg, rgba(181,56,75,0.10), rgba(181,56,75,0.10) 4px, rgba(181,56,75,0.18) 4px, rgba(181,56,75,0.18) 8px)",
                          border: "1px solid rgba(181,56,75,0.25)",
                        }}>
                        <span className="block px-0.5 text-[9px] leading-tight truncate" style={{ color: "var(--color-brand)" }}>{ev.summary || "予定"}</span>
                      </div>
                    );
                  })}

                  {/* 候補 */}
                  {daySlots.map((slot) => {
                    const s = partsOf(slot.startAt * 1000, tz);
                    const startMin = s.minutes;
                    const endMin = startMin + Math.round((slot.endAt - slot.startAt) / 60);
                    const top = toPx(startMin);
                    const height = Math.max(18, toPx(endMin) - top);
                    const st = STATE_STYLE[slot.state ?? "none"];
                    const conflict = conflictsWith(slot);
                    return (
                      <button key={`${slot.id}-${slot.startAt}`} type="button" onClick={() => onSlotClick?.(slot.id)}
                        title={`${slot.label} ${hhmm(startMin)}〜${hhmm(endMin % (24 * 60))}${conflict ? "（あなたの予定と重なっています）" : ""}`}
                        className="absolute rounded text-left overflow-hidden px-1 flex flex-col justify-center"
                        style={{
                          top: `${top}px`, height: `${height}px`, left: "2px", right: "2px", zIndex: 5,
                          background: st.bg, border: `2px ${slot.state ? "solid" : "dashed"} ${st.border}`, color: st.color,
                        }}>
                        <span className="text-[10px] leading-tight font-semibold truncate">{conflict ? "⚠ " : ""}{slot.label}</span>
                        {height > 30 && <span className="text-[9px] leading-tight truncate">{hhmm(startMin)}〜{hhmm(endMin % (24 * 60))}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-x-3 gap-y-1 mt-2 text-[10px] flex-wrap" style={{ color: "var(--color-ink-500)" }}>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded" style={{ background: "white", border: "2px dashed var(--color-brand)" }} />候補
        </span>
        {enabled && connected && (
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded" style={{ background: "repeating-linear-gradient(45deg, rgba(181,56,75,0.10), rgba(181,56,75,0.10) 2px, rgba(181,56,75,0.18) 2px, rgba(181,56,75,0.18) 4px)" }} />
            あなたの予定
          </span>
        )}
        <span>⚠ = あなたの予定と重なっています</span>
        {legend && <span>{legend}</span>}
      </div>
    </div>
  );
}

/** 「自分のカレンダーと重ねて見る」ボタンと、開くと出る CandidateCalendarView のセット */
export function CandidateCalendarToggle(props: {
  slots: CalendarSlot[];
  onSlotClick?: (slotId: string) => void;
  legend?: string;
  canCheckCalendar?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="mb-2 text-xs font-medium px-3 py-1.5 rounded-full"
        style={{ background: open ? "var(--color-brand)" : "white", color: open ? "white" : "var(--color-ink-700)", border: "1px solid var(--color-paper-300)" }}>
        📅 {open ? "カレンダー表示を閉じる" : "自分のカレンダーと重ねて見る"}
      </button>
      {open && <CandidateCalendarView {...props} />}
    </div>
  );
}
