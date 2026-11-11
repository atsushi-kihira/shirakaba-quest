// =============================================================
// ホーム画面の「ミーティング/イベントカレンダー」
//   ・自分が主催している／招待されている、日程が確定した予定（1to1・ミーティング・定例会）を表示する
//   ・月表示／週表示を切り替えられる。土曜は青、日曜・祝日は赤で表示する
//   ・日付を選ぶと、その日の予定がカレンダーの下に一覧で出る（タップで詳細へ）
//   ・辞退・欠席・無回答の予定も表示する（「辞退」「欠席」「未回答」のバッジで区別する）
// 直近の予定を知らせる「もうすぐの予定」などのリマインドは、これまで通り別の場所に出る。
// =============================================================
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { fmtTime, tsToDateInput } from "@/lib/date";
import { getJpHoliday } from "@/lib/jp-holidays";
import {
  addDays, addMonthsFirst, dayStartSec, monthDays, parseKey, todayKey, weekDays, weekdayOf,
  type DayKey,
} from "@/lib/calendar-grid";
import type { CalendarEvent, CalendarEventKind, CalendarEventMyStatus } from "@shared/types";

type ViewMode = "month" | "week";

const VIEW_STORAGE_KEY = "home_calendar_view";
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

/** 予定の種類ごとのアイコンと名前 */
const KIND_INFO: Record<CalendarEventKind, { icon: string; label: string }> = {
  oneonone: { icon: "🤝", label: "1to1" },
  meeting: { icon: "📅", label: "ミーティング" },
  series: { icon: "🔁", label: "定例会" },
};

function loadView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === "week" ? "week" : "month";
  } catch {
    return "month";
  }
}

function holidayOf(key: DayKey): string | null {
  const { y, m, d } = parseKey(key);
  return getJpHoliday(y, m, d);
}

/** 日付の文字色：日曜・祝日＝赤系、土曜＝青系、平日＝ふつう */
function dayColor(key: DayKey, dimmed = false): string {
  const dow = weekdayOf(key);
  let color = "var(--color-ink-800)";
  if (dow === 0 || holidayOf(key)) color = "var(--color-brand)";
  else if (dow === 6) color = "var(--color-saturday)";
  return dimmed ? `color-mix(in srgb, ${color} 45%, transparent)` : color;
}

/** 自分の出欠を表すバッジ（参加予定は目立たせず、辞退・欠席・未回答を分かりやすく） */
function statusBadge(ev: CalendarEvent): { text: string; bg: string; color: string } | null {
  if (ev.kind === "oneonone") return null;
  const map: Record<CalendarEventMyStatus, { text: string; bg: string; color: string } | null> = {
    attending: { text: "✅ 参加予定", bg: "rgba(90,140,92,0.14)", color: "var(--color-success-dk)" },
    absent: { text: "欠席", bg: "var(--color-paper-200)", color: "var(--color-ink-600)" },
    declined: { text: "辞退", bg: "var(--color-paper-200)", color: "var(--color-ink-600)" },
    none: ev.isHost ? null : { text: "未回答", bg: "rgba(212,160,59,0.18)", color: "var(--color-accent-dk)" },
  };
  return map[ev.myStatus];
}

function isMuted(ev: CalendarEvent): boolean {
  return ev.myStatus === "absent" || ev.myStatus === "declined";
}

export function HomeCalendar({ tz }: { tz: string }) {
  const today = todayKey(tz);
  const [view, setView] = useState<ViewMode>(loadView);
  const [anchor, setAnchor] = useState<DayKey>(today);
  const [selected, setSelected] = useState<DayKey>(today);

  useEffect(() => {
    try { localStorage.setItem(VIEW_STORAGE_KEY, view); } catch { /* 保存できなくても、そのまま使える */ }
  }, [view]);

  const days = useMemo(() => (view === "month" ? monthDays(anchor) : weekDays(anchor)), [view, anchor]);
  const rangeFrom = dayStartSec(days[0], tz);
  const rangeTo = dayStartSec(addDays(days[days.length - 1], 1), tz) - 1;

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["calendar", "events", rangeFrom, rangeTo],
    queryFn: () => api.get<{ data: { events: CalendarEvent[] } }>(`/calendar/events?from=${rangeFrom}&to=${rangeTo}`),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const eventsByDay = useMemo(() => {
    const map = new Map<DayKey, CalendarEvent[]>();
    for (const ev of data?.data.events ?? []) {
      const k = tsToDateInput(ev.startsAt, tz);
      const list = map.get(k) ?? [];
      list.push(ev);
      map.set(k, list);
    }
    return map;
  }, [data, tz]);

  const { y: anchorY, m: anchorM } = parseKey(anchor);
  const weekStart = parseKey(days[0]);
  const weekEnd = parseKey(days[days.length - 1]);
  const title = view === "month"
    ? `${anchorY}年${anchorM}月`
    : `${weekStart.y}年${weekStart.m}月${weekStart.d}日〜${weekStart.m === weekEnd.m ? "" : `${weekEnd.m}月`}${weekEnd.d}日`;

  function move(direction: -1 | 1) {
    const next = view === "month" ? addMonthsFirst(anchor, direction) : addDays(anchor, direction * 7);
    setAnchor(next);
    // 移動先に今日があれば今日を、なければ先頭の日を選ぶ（選んだ日が画面の外に出ないように）
    if (view === "month") setSelected(parseKey(next).m === parseKey(today).m && parseKey(next).y === parseKey(today).y ? today : next);
    else setSelected(weekDays(next).includes(today) ? today : weekDays(next)[0]);
  }

  function goToday() {
    setAnchor(today);
    setSelected(today);
  }

  function pick(key: DayKey) {
    setSelected(key);
    if (view === "month" && parseKey(key).m !== anchorM) setAnchor(key);
  }

  function changeView(next: ViewMode) {
    setView(next);
    setAnchor(selected);
  }

  const selectedEvents = eventsByDay.get(selected) ?? [];
  const selectedHoliday = holidayOf(selected);
  const selectedParts = parseKey(selected);

  return (
    <section aria-label="ミーティング・イベントカレンダー">
      <div className="flex items-center justify-between mb-2 gap-2">
        <h2 className="text-sm font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
          🗓️ ミーティング/イベントカレンダー
        </h2>
        <div className="flex rounded-full p-0.5 shrink-0" style={{ background: "var(--color-paper-200)" }} role="group" aria-label="表示の切り替え">
          {(["month", "week"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => changeView(v)}
              aria-pressed={view === v}
              className="px-3 py-1 rounded-full text-xs font-medium transition"
              style={view === v
                ? { background: "var(--color-brand)", color: "white" }
                : { color: "var(--color-ink-600)" }}
            >
              {v === "month" ? "月" : "週"}
            </button>
          ))}
        </div>
      </div>

      <div className="card-paper rounded-3xl p-3 sm:p-4">
        {/* 月・週の移動 */}
        <div className="flex items-center justify-between mb-2">
          <button type="button" onClick={() => move(-1)} aria-label={view === "month" ? "前の月" : "前の週"}
            className="p-2 rounded-full active:opacity-70" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            <ChevronLeft size={16} />
          </button>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold" style={{ color: "var(--color-ink-800)" }}>{title}</p>
            {isFetching && <Loader2 size={12} className="animate-spin" style={{ color: "var(--color-ink-400)" }} />}
            <button type="button" onClick={goToday}
              className="text-[11px] px-2 py-0.5 rounded-full"
              style={{ border: "1px solid var(--color-paper-300)", color: "var(--color-ink-600)" }}>
              今日
            </button>
          </div>
          <button type="button" onClick={() => move(1)} aria-label={view === "month" ? "次の月" : "次の週"}
            className="p-2 rounded-full active:opacity-70" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            <ChevronRight size={16} />
          </button>
        </div>

        {isError && (
          <div className="text-center py-6">
            <p className="text-sm mb-2" style={{ color: "var(--color-ink-600)" }}>予定を読み込めませんでした。通信の状態を確認して、もう一度お試しください。</p>
            <button type="button" onClick={() => refetch()} className="px-4 py-2 rounded-xl text-xs font-medium text-white" style={{ background: "var(--color-brand)" }}>
              もう一度読み込む
            </button>
          </div>
        )}

        {!isError && isLoading && (
          <div className="flex items-center justify-center gap-2 py-10 text-xs" style={{ color: "var(--color-ink-500)" }}>
            <Loader2 size={16} className="animate-spin" /> 予定を読み込んでいます…
          </div>
        )}

        {!isError && !isLoading && view === "month" && (
          <>
            <div className="grid grid-cols-7 mb-1">
              {WEEKDAY_LABELS.map((w, i) => (
                <div key={w} className="text-center text-[11px] font-medium py-1"
                  style={{ color: i === 0 ? "var(--color-brand)" : i === 6 ? "var(--color-saturday)" : "var(--color-ink-500)" }}>
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px" role="grid">
              {days.map((key) => {
                const { d } = parseKey(key);
                const inMonth = parseKey(key).m === anchorM;
                const holiday = holidayOf(key);
                const evs = eventsByDay.get(key) ?? [];
                const isSel = key === selected;
                const isTodayCell = key === today;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => pick(key)}
                    title={holiday ?? undefined}
                    aria-label={`${parseKey(key).m}月${d}日${holiday ? `（${holiday}）` : ""}、予定${evs.length}件`}
                    aria-pressed={isSel}
                    className="flex flex-col items-center rounded-xl py-1 min-h-[3.4rem] sm:min-h-[4.2rem] transition"
                    style={{
                      background: isSel ? "rgba(181,56,75,0.10)" : holiday || weekdayOf(key) === 0 ? "rgba(181,56,75,0.03)" : "transparent",
                      outline: isSel ? "2px solid var(--color-brand)" : "none",
                      outlineOffset: "-2px",
                    }}
                  >
                    <span
                      className="text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full"
                      style={isTodayCell
                        ? { background: "var(--color-accent)", color: "white" }
                        : { color: dayColor(key, !inMonth) }}
                    >
                      {d}
                    </span>
                    {holiday && inMonth && (
                      <span className="hidden sm:block text-[9px] leading-tight px-0.5 truncate max-w-full" style={{ color: "var(--color-brand)" }}>{holiday}</span>
                    )}
                    <span className="flex flex-wrap justify-center gap-x-0.5 mt-0.5 text-[11px] leading-none">
                      {evs.slice(0, 3).map((ev) => (
                        <span key={ev.key} style={{ opacity: isMuted(ev) ? 0.35 : inMonth ? 1 : 0.55 }}>{KIND_INFO[ev.kind].icon}</span>
                      ))}
                      {evs.length > 3 && <span className="text-[10px]" style={{ color: "var(--color-ink-500)" }}>+{evs.length - 3}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {!isError && !isLoading && view === "week" && (
          <div className="space-y-1" role="list">
            {days.map((key) => {
              const { m, d } = parseKey(key);
              const holiday = holidayOf(key);
              const evs = eventsByDay.get(key) ?? [];
              const isSel = key === selected;
              const isTodayRow = key === today;
              return (
                <button
                  key={key}
                  type="button"
                  role="listitem"
                  onClick={() => pick(key)}
                  aria-pressed={isSel}
                  className="w-full flex items-start gap-3 rounded-2xl px-2.5 py-2 text-left transition"
                  style={{
                    background: isSel ? "rgba(181,56,75,0.10)" : holiday || weekdayOf(key) === 0 ? "rgba(181,56,75,0.03)" : "transparent",
                    outline: isSel ? "2px solid var(--color-brand)" : "none",
                    outlineOffset: "-2px",
                  }}
                >
                  <span className="shrink-0 w-12 text-center">
                    <span className="block text-[11px] font-medium" style={{ color: dayColor(key) }}>{WEEKDAY_LABELS[weekdayOf(key)]}</span>
                    <span
                      className="inline-flex w-7 h-7 items-center justify-center rounded-full text-sm font-semibold"
                      style={isTodayRow ? { background: "var(--color-accent)", color: "white" } : { color: dayColor(key) }}
                    >
                      {d}
                    </span>
                    <span className="sr-only">{m}月</span>
                  </span>
                  <span className="flex-1 min-w-0 pt-0.5">
                    {holiday && <span className="block text-[10px] mb-0.5" style={{ color: "var(--color-brand)" }}>🎌 {holiday}</span>}
                    {evs.length === 0 ? (
                      <span className="text-[11px]" style={{ color: "var(--color-ink-400)" }}>予定なし</span>
                    ) : (
                      <span className="block space-y-0.5">
                        {evs.map((ev) => (
                          <span key={ev.key} className="flex items-center gap-1.5 text-xs min-w-0" style={{ opacity: isMuted(ev) ? 0.5 : 1, color: "var(--color-ink-800)" }}>
                            <span>{KIND_INFO[ev.kind].icon}</span>
                            <span className="shrink-0 tabular-nums" style={{ color: "var(--color-ink-500)" }}>{fmtTime(ev.startsAt, tz)}</span>
                            <span className="truncate">{ev.title}</span>
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* 凡例 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 pt-2 text-[11px]" style={{ borderTop: "1px dashed var(--color-paper-300)", color: "var(--color-ink-500)" }}>
          {(Object.keys(KIND_INFO) as CalendarEventKind[]).map((k) => (
            <span key={k}>{KIND_INFO[k].icon} {KIND_INFO[k].label}</span>
          ))}
          <span style={{ color: "var(--color-brand)" }}>● 日曜・祝日</span>
          <span style={{ color: "var(--color-saturday)" }}>● 土曜</span>
        </div>
      </div>

      {/* 選んだ日の予定 */}
      <div className="mt-3">
        <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-ink-700)" }}>
          📌 {selectedParts.m}月{selectedParts.d}日（{WEEKDAY_LABELS[weekdayOf(selected)]}）の予定
          {selectedHoliday && <span className="ml-1.5 font-normal" style={{ color: "var(--color-brand)" }}>🎌 {selectedHoliday}</span>}
        </p>
        {selectedEvents.length === 0 ? (
          <div className="card-paper rounded-2xl px-4 py-4 text-center text-xs" style={{ color: "var(--color-ink-500)" }}>
            この日の予定はありません
          </div>
        ) : (
          <div className="space-y-2">
            {selectedEvents.map((ev) => {
              const badge = statusBadge(ev);
              return (
                <Link
                  key={ev.key}
                  to={ev.linkPath}
                  className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80"
                  style={{ opacity: isMuted(ev) ? 0.7 : 1 }}
                >
                  <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: "var(--color-paper-200)" }}>
                    {KIND_INFO[ev.kind].icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{ev.title}</p>
                    <p className="text-xs tabular-nums" style={{ color: "var(--color-ink-500)" }}>
                      {fmtTime(ev.startsAt, tz)}〜{fmtTime(ev.endsAt, tz)}
                      <span className="ml-1.5">{KIND_INFO[ev.kind].label}{ev.kind === "oneonone" && ev.isExternalGuest ? "（ビジター）" : ""}</span>
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {ev.isHost && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(181,56,75,0.10)", color: "var(--color-brand)" }}>主催</span>
                      )}
                      {badge && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: badge.bg, color: badge.color }}>{badge.text}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={16} style={{ color: "var(--color-ink-400)" }} />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
