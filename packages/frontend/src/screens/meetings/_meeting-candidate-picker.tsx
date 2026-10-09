// =============================================================
// ミーティング作成画面：候補日を「自分のカレンダー」を見ながら選ぶための週間グリッド
// 1to1のカレンダー表示と同じ横幅・時間軸で表示し、30分単位で「開始時刻」だけをクリックして選ぶ。
// 所要時間は呼び出し元で指定した共通の長さで、クリックした時刻からその長さぶんの枠が候補になる。
// 自分の既存の予定は薄い色で重ねて表示し、目安として使える（重ねて選ぶこと自体は制限しない）。
// =============================================================
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { api } from "@/lib/api";

type MyEvent = { id: string; calendarId: string; summary: string; startUtc: string; endUtc: string; allDay: boolean };
type CalendarEventsResponse = { data: { connected: boolean; events: MyEvent[]; calendars: { id: string; summary: string }[] } };
type PickerCandidate = { date: string; time: string; endTime: string };
export type SuggestedSlot = { startUtc: string; endUtc: string; reason?: string };

const HOURS = Array.from({ length: 16 }, (_, i) => 7 + i); // 7:00-23:00
const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const CELL_HEIGHT_PX = 48; // 1時間あたりの高さ（1to1のカレンダー表示と統一）

function startOfWeekSunday(): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const year = parseInt(get("year")), month = parseInt(get("month")) - 1, day = parseInt(get("day"));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return new Date(Date.UTC(year, month, day - weekday));
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400_000);
}
function toYMD(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function toJSTHourMin(isoStr: string): { hour: number; min: number; dateKey: string } {
  const d = new Date(isoStr);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { hour: parseInt(get("hour")), min: parseInt(get("minute")), dateKey: `${get("year")}-${get("month")}-${get("day")}` };
}
function minutesToTimeStr(min: number): string {
  const clamped = Math.max(HOURS[0] * 60, Math.min(HOURS[HOURS.length - 1] * 60 + 60, min));
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`;
}
function timeStrToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function MeetingCandidatePicker({
  candidates,
  onAdd,
  onRemove,
  maxReached,
  suggestedSlots,
  duration,
}: {
  /** すべての候補に共通の所要時間（分）。クリックした開始時刻からこの長さの枠が候補になる */
  duration: number;
  candidates: PickerCandidate[];
  onAdd: (date: string, startTime: string, endTime: string) => void;
  onRemove: (index: number) => void;
  maxReached: boolean;
  /** AI検索などで見つかった候補日時。カレンダー上にハイライト表示し、クリックで候補に追加できる */
  suggestedSlots?: SuggestedSlot[];
}) {
  const [weekStart, setWeekStart] = useState<Date>(startOfWeekSunday());
  const fromStr = toYMD(weekStart);
  const toStr = toYMD(addDays(weekStart, 6));

  // AIの検索結果が届いたら、最初の候補が含まれる週へ自動でジャンプする
  // （検索条件の週と現在表示中の週がずれていると、結果が画面外で見えないままになるため）
  useEffect(() => {
    if (!suggestedSlots || suggestedSlots.length === 0) return;
    const firstDateKey = toJSTHourMin(suggestedSlots[0].startUtc).dateKey;
    const [y, m, d] = firstDateKey.split("-").map(Number);
    const firstDate = new Date(Date.UTC(y, m - 1, d));
    const currentWeekEnd = addDays(weekStart, 6);
    if (firstDate.getTime() < weekStart.getTime() || firstDate.getTime() > currentWeekEnd.getTime()) {
      const dow = firstDate.getUTCDay();
      setWeekStart(addDays(firstDate, -dow));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedSlots]);

  const { data, isLoading } = useQuery({
    queryKey: ["scheduler", "my-calendar-events", fromStr],
    queryFn: () => api.get<CalendarEventsResponse>(`/scheduler/me/calendar-events?from=${fromStr}&to=${toStr}`),
  });

  const events = data?.data.events ?? [];
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const gridHeight = HOURS.length * CELL_HEIGHT_PX;

  function pxToMinutes(px: number): number {
    const raw = (px / CELL_HEIGHT_PX) * 60 + HOURS[0] * 60;
    return Math.max(HOURS[0] * 60, Math.min(HOURS[HOURS.length - 1] * 60 + 60, Math.round(raw / 30) * 30));
  }

  function eventsByDate(dayStr: string): MyEvent[] {
    return events.filter((e) => !e.allDay && toJSTHourMin(e.startUtc).dateKey === dayStr);
  }
  function candidatesByDate(dayStr: string): (PickerCandidate & { index: number })[] {
    return candidates
      .map((c, index) => ({ ...c, index }))
      .filter((c) => c.date === dayStr);
  }
  // すでに候補に追加済みのものは提案として重ねて表示しない
  function suggestedByDate(dayStr: string): SuggestedSlot[] {
    return (suggestedSlots ?? []).filter((s) => {
      const start = toJSTHourMin(s.startUtc);
      if (start.dateKey !== dayStr) return false;
      const time = minutesToTimeStr(start.hour * 60 + start.min);
      return !candidates.some((c) => c.date === dayStr && c.time === time);
    });
  }

  function blockTopHeight(startMin: number, endMin: number): { top: number; height: number } {
    const top = ((startMin - HOURS[0] * 60) / 60) * CELL_HEIGHT_PX;
    const height = ((endMin - startMin) / 60) * CELL_HEIGHT_PX;
    return { top, height: Math.max(height, 10) };
  }

  // クリックした位置（30分単位に丸めた時刻）を開始時刻として、共通の所要時間ぶんの候補を追加する
  function handleColumnMouseDown(e: React.MouseEvent<HTMLDivElement>, dayStr: string) {
    if (maxReached) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const startMin = pxToMinutes(e.clientY - rect.top);
    const endMin = Math.min(HOURS[HOURS.length - 1] * 60 + 60, startMin + duration);
    onAdd(dayStr, minutesToTimeStr(startMin), minutesToTimeStr(endMin));
  }

  if (data && !data.data.connected) {
    return (
      <div className="p-3 rounded-2xl text-xs" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
        Googleカレンダーと連携すると、自分の予定を見ながら候補日を選べます。
        <Link to="/scheduler/settings" className="ml-1 font-medium underline" style={{ color: "var(--color-brand)" }}>連携する →</Link>
      </div>
    );
  }

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))} className="p-1.5 rounded-lg" style={{ color: "var(--color-ink-500)" }}>
          <ChevronLeft size={16} />
        </button>
        <span className="text-xs font-medium" style={{ color: "var(--color-ink-700)" }}>
          {fromStr.replace(/-/g, "/")} 〜 {toStr.replace(/-/g, "/")}
        </span>
        <button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))} className="p-1.5 rounded-lg" style={{ color: "var(--color-ink-500)" }}>
          <ChevronRight size={16} />
        </button>
      </div>

      <p className="mb-2 text-[11px]" style={{ color: "var(--color-ink-400)" }}>
        開始したい時刻をクリックしてください（{duration}分の枠が候補になります）
      </p>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 size={18} className="animate-spin" style={{ color: "var(--color-brand)" }} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[420px]">
            {/* ヘッダー行（曜日） */}
            <div className="flex" style={{ marginLeft: "36px" }}>
              {days.map((d) => {
                const dayStr = toYMD(d);
                const isToday = dayStr === toYMD(new Date());
                return (
                  <div key={dayStr} className="flex-1 text-center py-1.5" style={{ borderLeft: "1px solid var(--color-paper-300)" }}>
                    <div className="text-xs" style={{ color: "var(--color-ink-400)" }}>{DOW_LABELS[d.getUTCDay()]}</div>
                    <div
                      className={`text-sm font-semibold mt-0.5 w-7 h-7 rounded-full flex items-center justify-center mx-auto ${isToday ? "text-white" : ""}`}
                      style={{ background: isToday ? "var(--color-brand)" : "transparent", color: isToday ? "white" : "var(--color-ink-700)" }}
                    >
                      {d.getUTCDate()}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 時間軸 + グリッド */}
            <div className="flex relative" style={{ height: `${gridHeight}px` }}>
              <div className="flex-shrink-0" style={{ width: "36px" }}>
                {HOURS.map((h) => (
                  <div key={h} className="text-right pr-1 text-xs leading-none"
                    style={{ height: `${CELL_HEIGHT_PX}px`, paddingTop: "2px", color: "var(--color-ink-400)" }}>
                    {h}:00
                  </div>
                ))}
              </div>

              {days.map((d) => {
                const dayStr = toYMD(d);
                const dayEvents = eventsByDate(dayStr);
                const dayCandidates = candidatesByDate(dayStr);
                const daySuggested = suggestedByDate(dayStr);
                return (
                  <div
                    key={dayStr}
                    className="flex-1 relative"
                    style={{ borderLeft: "1px solid var(--color-paper-300)", cursor: maxReached ? "default" : "crosshair" }}
                    onMouseDown={(e) => handleColumnMouseDown(e, dayStr)}
                  >
                    {HOURS.map((h) => (
                      <div key={h} className="absolute w-full" style={{
                        top: `${(h - HOURS[0]) * CELL_HEIGHT_PX}px`, height: `${CELL_HEIGHT_PX}px`, borderTop: "1px solid var(--color-paper-200)",
                      }} />
                    ))}

                    {/* 自分の既存の予定（目安として表示、選択の邪魔にはしない） */}
                    {dayEvents.map((ev) => {
                      const { hour, min } = toJSTHourMin(ev.startUtc);
                      const endInfo = toJSTHourMin(ev.endUtc);
                      const startMin = hour * 60 + min;
                      const endMin = endInfo.dateKey === dayStr ? endInfo.hour * 60 + endInfo.min : HOURS[HOURS.length - 1] * 60 + 60;
                      const { top, height } = blockTopHeight(startMin, endMin);
                      return (
                        <div key={ev.id} title={ev.summary} className="absolute rounded overflow-hidden pointer-events-none"
                          style={{
                            top: `${top}px`, height: `${height}px`, left: "2px", right: "2px",
                            background: "repeating-linear-gradient(45deg, rgba(181,56,75,0.10), rgba(181,56,75,0.10) 4px, rgba(181,56,75,0.16) 4px, rgba(181,56,75,0.16) 8px)",
                            border: "1px solid rgba(181,56,75,0.25)",
                          }}>
                          <span className="block px-1 text-[9px] leading-tight truncate" style={{ color: "var(--color-brand)" }}>{ev.summary}</span>
                        </div>
                      );
                    })}

                    {/* 選択済みの候補日 */}
                    {dayCandidates.map((c) => {
                      const startMin = timeStrToMinutes(c.time);
                      const endMin = c.endTime ? timeStrToMinutes(c.endTime) : startMin + 60;
                      const { top, height } = blockTopHeight(startMin, endMin);
                      return (
                        <button
                          key={c.index}
                          type="button"
                          title="クリックで候補から外す"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => onRemove(c.index)}
                          className="absolute rounded text-left overflow-hidden flex items-center justify-between gap-0.5 px-1"
                          style={{ top: `${top}px`, height: `${height}px`, left: "2px", right: "2px", background: "var(--color-brand)", zIndex: 5 }}
                        >
                          <span className="text-[9px] leading-tight text-white truncate">{c.time}〜{c.endTime}</span>
                          <X size={10} className="shrink-0" style={{ color: "white" }} />
                        </button>
                      );
                    })}

                    {/* AIが見つけた候補（クリックで候補に追加） */}
                    {daySuggested.map((s) => {
                      const start = toJSTHourMin(s.startUtc);
                      const end = toJSTHourMin(s.endUtc);
                      const startMin = start.hour * 60 + start.min;
                      const endMin = end.dateKey === dayStr ? end.hour * 60 + end.min : HOURS[HOURS.length - 1] * 60 + 60;
                      const { top, height } = blockTopHeight(startMin, endMin);
                      const startTime = minutesToTimeStr(startMin);
                      const endTime = minutesToTimeStr(Math.min(HOURS[HOURS.length - 1] * 60 + 60, startMin + duration));
                      return (
                        <button
                          key={`sugg-${s.startUtc}`}
                          type="button"
                          title={s.reason ? `AIのおすすめ：${s.reason}` : "クリックで候補に追加"}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => onAdd(dayStr, startTime, endTime)}
                          className="absolute rounded text-left overflow-hidden flex flex-col justify-center px-1"
                          style={{
                            top: `${top}px`, height: `${height}px`, left: "2px", right: "2px", zIndex: 4,
                            background: "rgba(90,140,92,0.18)", border: "2px dashed var(--color-success)",
                          }}
                        >
                          <span className="text-[9px] leading-tight font-medium truncate" style={{ color: "var(--color-success)" }}>
                            ✨ {startTime}〜{endTime}
                          </span>
                          {s.reason && height > 28 && (
                            <span className="text-[8px] leading-tight truncate" style={{ color: "var(--color-success)" }}>{s.reason}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 mt-2 text-[10px] flex-wrap" style={{ color: "var(--color-ink-400)" }}>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded" style={{ background: "var(--color-brand)" }} />候補に追加済み（クリックで解除）</span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded" style={{ background: "repeating-linear-gradient(45deg, rgba(181,56,75,0.10), rgba(181,56,75,0.10) 2px, rgba(181,56,75,0.16) 2px, rgba(181,56,75,0.16) 4px)" }} />
          自分の予定あり
        </span>
        {suggestedSlots && suggestedSlots.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded" style={{ background: "rgba(90,140,92,0.18)", border: "2px dashed var(--color-success)" }} />
            AIのおすすめ（クリックで候補に追加）
          </span>
        )}
        <span>空いている時間帯をクリック（選択中の長さで追加）またはドラッグ（自由な開始・終了で追加）</span>
        {maxReached && <span style={{ color: "var(--color-brand)" }}>候補日の上限に達しました</span>}
      </div>
    </div>
  );
}
