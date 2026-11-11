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
import { KIND_INFO, WEEKDAY_LABELS, isMuted, type GoogleEvent } from "./_home-calendar-shared";
import { WeekTimeGrid } from "./_home-calendar-week";

type ViewMode = "month" | "week";

const VIEW_STORAGE_KEY = "home_calendar_view";

const GOOGLE_STORAGE_KEY = "home_calendar_google";
const HIDDEN_KINDS_STORAGE_KEY = "home_calendar_hidden_kinds";

/** 表示をオフにしている予定の種類（記録のない種類は、新しく増えた種類も含めて、最初からオン） */
function loadHiddenKinds(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_KINDS_STORAGE_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function loadGoogle(): boolean {
  try {
    return localStorage.getItem(GOOGLE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Googleカレンダーから返ってくる予定（必要な項目だけ） */
type RawGoogleEvent = { id: string; summary: string; startUtc: string; endUtc: string; allDay: boolean };

/** 2つの日付（含む・含まない）のあいだの日付の一覧（日数が極端に多い予定でも、14日までにする） */
function dayKeysBetween(startKey: DayKey, endExclusive: DayKey): DayKey[] {
  const out: DayKey[] = [];
  for (let k = startKey; k < endExclusive && out.length < 14; k = addDays(k, 1)) out.push(k);
  return out.length > 0 ? out : [startKey];
}

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

  // 予定の種類ごとの表示のオン・オフ（凡例のチェック）。最初は、すべてオン
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(loadHiddenKinds);
  useEffect(() => {
    try { localStorage.setItem(HIDDEN_KINDS_STORAGE_KEY, JSON.stringify([...hiddenKinds])); } catch { /* 保存できなくても、そのまま使える */ }
  }, [hiddenKinds]);
  function toggleKind(kind: string, on: boolean) {
    setHiddenKinds((prev) => {
      const next = new Set(prev);
      if (on) next.delete(kind); else next.add(kind);
      return next;
    });
  }

  const visibleEvents = useMemo(
    () => (data?.data.events ?? []).filter((ev) => !hiddenKinds.has(ev.kind)),
    [data, hiddenKinds],
  );

  const eventsByDay = useMemo(() => {
    const map = new Map<DayKey, CalendarEvent[]>();
    for (const ev of visibleEvents) {
      const k = tsToDateInput(ev.startsAt, tz);
      const list = map.get(k) ?? [];
      list.push(ev);
      map.set(k, list);
    }
    return map;
  }, [visibleEvents, tz]);

  // ---- 自分のGoogleカレンダーを重ねる ----
  const [showGoogle, setShowGoogle] = useState(loadGoogle);
  useEffect(() => {
    try { localStorage.setItem(GOOGLE_STORAGE_KEY, showGoogle ? "1" : "0"); } catch { /* 保存できなくても、そのまま使える */ }
  }, [showGoogle]);
  const { data: googleStatus } = useQuery({
    queryKey: ["scheduler", "google-status"],
    queryFn: () => api.get<{ data: { connected: boolean } }>("/scheduler/oauth/google/status"),
    staleTime: 5 * 60_000,
  });
  const googleConnected = googleStatus?.data.connected ?? false;
  const googleOn = showGoogle && googleConnected;
  // 日本時間の日の境目に合わせて、前後1日ぶん多めに取る
  const googleFrom = addDays(days[0], -1);
  const googleTo = addDays(days[days.length - 1], 1);
  const { data: googleData, isError: googleError, isFetching: googleFetching } = useQuery({
    queryKey: ["calendar", "google", googleFrom, googleTo],
    queryFn: () => api.get<{ data: { connected: boolean; events: RawGoogleEvent[] } }>(`/scheduler/me/calendar-events?from=${googleFrom}&to=${googleTo}`),
    enabled: googleOn,
    staleTime: 120_000,
    placeholderData: (prev) => prev,
  });

  const googleEvents = useMemo<GoogleEvent[]>(() => {
    if (!googleOn) return [];
    // 白樺クエストが、Googleカレンダーに書き込んだ予定（同じ日時）は、アプリの予定と二重にならないように、重ねて表示しない
    const appSpans = new Set(visibleEvents.map((e) => `${e.startsAt}-${e.endsAt}`));
    const out: GoogleEvent[] = [];
    for (const g of googleData?.data.events ?? []) {
      if (g.allDay) {
        out.push({ id: g.id, title: g.summary, allDay: true, startsAt: 0, endsAt: 0, startDate: g.startUtc.slice(0, 10), endDate: g.endUtc.slice(0, 10) });
        continue;
      }
      const s = Math.floor(Date.parse(g.startUtc) / 1000);
      const e = Math.floor(Date.parse(g.endUtc) / 1000);
      if (appSpans.has(`${s}-${e}`)) continue;
      out.push({ id: g.id, title: g.summary, allDay: false, startsAt: s, endsAt: e, startDate: null, endDate: null });
    }
    return out;
  }, [googleOn, googleData, visibleEvents]);

  const googleByDay = useMemo(() => {
    const map = new Map<DayKey, GoogleEvent[]>();
    const add = (k: DayKey, g: GoogleEvent) => { const l = map.get(k) ?? []; l.push(g); map.set(k, l); };
    for (const g of googleEvents) {
      if (g.allDay && g.startDate && g.endDate) {
        for (const k of dayKeysBetween(g.startDate, g.endDate)) add(k, g);
      } else {
        const startKey = tsToDateInput(g.startsAt, tz);
        const endKey = tsToDateInput(Math.max(g.startsAt, g.endsAt - 1), tz);
        for (const k of dayKeysBetween(startKey, addDays(endKey, 1))) add(k, g);
      }
    }
    // 終日を先に、そのあとは時刻順
    for (const l of map.values()) l.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startsAt - b.startsAt);
    return map;
  }, [googleEvents, tz]);

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
  const selectedGoogle = googleOn ? googleByDay.get(selected) ?? [] : [];
  // 選んだ日の一覧は、アプリの予定とGoogleカレンダーの予定を、時刻の順に並べる（終日の予定は先頭）
  type Row = { sort: number; app?: CalendarEvent; google?: GoogleEvent };
  const rows: Row[] = [
    ...selectedEvents.map((ev): Row => ({ sort: ev.startsAt, app: ev })),
    ...selectedGoogle.map((g): Row => ({ sort: g.allDay ? -1 : g.startsAt, google: g })),
  ].sort((a, b) => a.sort - b.sort);
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

        {googleOn && googleError && (
          <p className="text-[11px] mb-2 px-1" style={{ color: "var(--color-brand)" }}>
            Googleカレンダーの予定を読み込めませんでした。少し時間をおいて、もう一度お試しください。
          </p>
        )}

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
                    className="flex flex-col items-center rounded-xl py-1 min-h-[4.4rem] sm:min-h-[5.6rem] transition"
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
                    {/* 予定は、アイコンとタイトルの一部を、小さい文字で表示する（スマホは2件、広い画面は3件まで）。Googleカレンダーの予定は、そのあとに続ける */}
                    {(() => {
                      const gEvs = googleOn ? googleByDay.get(key) ?? [] : [];
                      const total = evs.length + gEvs.length;
                      return (
                        <span className="flex flex-col gap-px mt-0.5 w-full min-w-0 px-0.5">
                          {evs.slice(0, 3).map((ev, i) => (
                            <span
                              key={ev.key}
                              className={`${i === 2 ? "hidden sm:flex" : "flex"} items-center gap-px min-w-0 text-[9px] leading-tight text-left`}
                              style={{ opacity: isMuted(ev) ? 0.4 : inMonth ? 1 : 0.55, color: ev.titleColor ?? "var(--color-ink-700)", fontWeight: ev.titleColor ? 700 : undefined }}
                            >
                              <span className="shrink-0 text-[10px] leading-none">{KIND_INFO[ev.kind].icon}</span>
                              <span className="truncate">{ev.title}</span>
                            </span>
                          ))}
                          {gEvs.slice(0, Math.max(0, 3 - evs.length)).map((g, i) => (
                            <span
                              key={`g-${g.id}`}
                              className={`${evs.length + i >= 2 ? "hidden sm:flex" : "flex"} items-center gap-0.5 min-w-0 text-[9px] leading-tight text-left`}
                              style={{ opacity: inMonth ? 1 : 0.55, color: "var(--color-ink-500)" }}
                            >
                              <span className="shrink-0 inline-block w-1.5 h-1.5 rounded-sm" style={{ background: "var(--color-saturday)", opacity: 0.55 }} />
                              <span className="truncate">{g.title}</span>
                            </span>
                          ))}
                          {total > 2 && (
                            <span className="text-[9px] leading-tight sm:hidden" style={{ color: "var(--color-ink-500)" }}>他{total - 2}件</span>
                          )}
                          {total > 3 && (
                            <span className="text-[9px] leading-tight hidden sm:block" style={{ color: "var(--color-ink-500)" }}>他{total - 3}件</span>
                          )}
                        </span>
                      );
                    })()}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {!isError && !isLoading && view === "week" && (
          <WeekTimeGrid
            days={days}
            tz={tz}
            today={today}
            selected={selected}
            onPick={pick}
            appByDay={eventsByDay}
            google={googleOn ? googleEvents : null}
            holidayOf={holidayOf}
            dayColor={(k) => dayColor(k)}
          />
        )}

        {/* 凡例（チェックで、予定の種類ごとに、表示のオン・オフを切り替える）。予定の種類が増えたときも、ここに並ぶ */}
        <div className="mt-3 pt-2 text-[11px]" style={{ borderTop: "1px dashed var(--color-paper-300)", color: "var(--color-ink-600)" }}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {(Object.keys(KIND_INFO) as CalendarEventKind[]).map((k) => (
              <label key={k} className="inline-flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={!hiddenKinds.has(k)} onChange={(e) => toggleKind(k, e.target.checked)} />
                <span>{KIND_INFO[k].icon} {KIND_INFO[k].label}</span>
              </label>
            ))}
            {googleConnected ? (
              <label className="inline-flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={showGoogle} onChange={(e) => setShowGoogle(e.target.checked)} />
                <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "repeating-linear-gradient(45deg, color-mix(in srgb, var(--color-saturday) 10%, transparent), color-mix(in srgb, var(--color-saturday) 10%, transparent) 2px, color-mix(in srgb, var(--color-saturday) 20%, transparent) 2px, color-mix(in srgb, var(--color-saturday) 20%, transparent) 4px)", border: "1px solid color-mix(in srgb, var(--color-saturday) 40%, transparent)" }} />
                <span>自分のGoogleカレンダー</span>
                {googleOn && googleFetching && <Loader2 size={11} className="animate-spin" style={{ color: "var(--color-ink-400)" }} />}
              </label>
            ) : googleStatus ? (
              <span className="inline-flex items-center gap-1" style={{ color: "var(--color-ink-500)" }}>
                <input type="checkbox" disabled />
                自分のGoogleカレンダー
                <Link to="/scheduler/settings" className="font-medium underline" style={{ color: "var(--color-brand)" }}>連携する →</Link>
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 mt-1.5" style={{ color: "var(--color-ink-500)" }}>
            <span style={{ color: "var(--color-brand)" }}>● 日曜・祝日</span>
            <span style={{ color: "var(--color-saturday)" }}>● 土曜</span>
          </div>
        </div>
      </div>

      {/* 選んだ日の予定 */}
      <div className="mt-3">
        <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-ink-700)" }}>
          📌 {selectedParts.m}月{selectedParts.d}日（{WEEKDAY_LABELS[weekdayOf(selected)]}）の予定
          {selectedHoliday && <span className="ml-1.5 font-normal" style={{ color: "var(--color-brand)" }}>🎌 {selectedHoliday}</span>}
        </p>
        {rows.length === 0 ? (
          <div className="card-paper rounded-2xl px-4 py-4 text-center text-xs" style={{ color: "var(--color-ink-500)" }}>
            この日の予定はありません
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => {
              if (row.google) {
                const g = row.google;
                return (
                  <div
                    key={`g-${g.id}`}
                    className="rounded-2xl px-4 py-2.5 flex items-center gap-3"
                    style={{ background: "color-mix(in srgb, var(--color-saturday) 8%, transparent)", border: "1px dashed color-mix(in srgb, var(--color-saturday) 35%, transparent)" }}
                  >
                    <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-base" style={{ background: "var(--color-paper-200)" }}>🗓️</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: "var(--color-ink-700)" }}>{g.title}</p>
                      <p className="text-xs tabular-nums" style={{ color: "var(--color-ink-500)" }}>
                        {g.allDay ? "終日" : `${fmtTime(g.startsAt, tz)}〜${fmtTime(g.endsAt, tz)}`}
                        <span className="ml-1.5">Googleカレンダー</span>
                      </p>
                    </div>
                  </div>
                );
              }
              const ev = row.app!;
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
                    <p className="text-sm font-medium truncate" style={{ color: ev.titleColor ?? "var(--color-ink-800)", fontWeight: ev.titleColor ? 700 : undefined }}>{ev.title}</p>
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
