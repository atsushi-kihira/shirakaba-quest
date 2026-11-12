// =============================================================
// ホームのカレンダー：週表示（時間軸つき）
//   ミーティング日程調整のときの「自分のカレンダー」と同じように、縦が時間、横が曜日の表で表示する。
//   ・アプリの予定（1to1・ミーティング・定例会）は、種類ごとの色の枠（タップで詳細へ）
//   ・重ねたGoogleカレンダーの予定は、斜線の枠（終日の予定は、表の上に並べる）
//   ・同じ時間に重なる予定は、横に並べて表示する
// =============================================================
import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { fmtTime } from "@/lib/date";
import { addDays, dayStartSec, parseKey, weekdayOf, type DayKey } from "@/lib/calendar-grid";
import { layoutLanes, segmentInDay } from "@/lib/calendar-layout";
import type { CalendarEvent } from "@shared/types";
import { KIND_COLOR, KIND_INFO, WEEKDAY_LABELS, isMuted, type GoogleEvent } from "./_home-calendar-shared";

const CELL_HEIGHT_PX = 44; // 1時間あたりの高さ
const TIME_COL_PX = 36;
const DEFAULT_FIRST_HOUR = 7;
const DEFAULT_LAST_HOUR = 23; // 23:00まで（表の下端）

type Item =
  | { type: "app"; key: string; startMin: number; endMin: number; ev: CalendarEvent }
  | { type: "google"; key: string; startMin: number; endMin: number; ev: GoogleEvent };

type Props = {
  days: DayKey[];
  tz: string;
  today: DayKey;
  selected: DayKey;
  onPick: (key: DayKey) => void;
  appByDay: Map<DayKey, CalendarEvent[]>;
  /** 重ねるGoogleカレンダーの予定（重ねないときは null） */
  google: GoogleEvent[] | null;
  holidayOf: (key: DayKey) => string | null;
  dayColor: (key: DayKey) => string;
};

export function WeekTimeGrid({ days, tz, today, selected, onPick, appByDay, google, holidayOf, dayColor }: Props) {
  // 日ごとに、時間のある予定を「その日の分（0〜1440）」にして並べる
  const perDay = useMemo(() => {
    return days.map((key) => {
      const dayStart = dayStartSec(key, tz);
      const dayEnd = dayStartSec(addDays(key, 1), tz);
      const items: Item[] = [];
      for (const ev of appByDay.get(key) ?? []) {
        const seg = segmentInDay(ev.startsAt, ev.endsAt, dayStart, dayEnd);
        if (seg) items.push({ type: "app", key: ev.key, ...seg, ev });
      }
      const allDay: GoogleEvent[] = [];
      for (const g of google ?? []) {
        if (g.allDay) {
          if (g.startDate && g.endDate && g.startDate <= key && key < g.endDate) allDay.push(g);
          continue;
        }
        const seg = segmentInDay(g.startsAt, g.endsAt, dayStart, dayEnd);
        if (seg) items.push({ type: "google", key: `g-${g.id}-${key}`, ...seg, ev: g });
      }
      return { key, items: layoutLanes(items), allDay };
    });
  }, [days, tz, appByDay, google]);

  // 表の上端・下端の時刻：ふだんは 7:00〜23:00。その外にも予定があるときは、広げて全部見えるようにする
  const { firstHour, lastHour } = useMemo(() => {
    let first = DEFAULT_FIRST_HOUR;
    let last = DEFAULT_LAST_HOUR;
    for (const d of perDay) {
      for (const it of d.items) {
        first = Math.min(first, Math.floor(it.startMin / 60));
        last = Math.max(last, Math.ceil(it.endMin / 60));
      }
    }
    return { firstHour: Math.max(0, first), lastHour: Math.min(24, last) };
  }, [perDay]);

  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);
  const gridHeight = hours.length * CELL_HEIGHT_PX;
  const minToPx = (min: number) => ((min - firstHour * 60) / 60) * CELL_HEIGHT_PX;

  const hasAllDay = perDay.some((d) => d.allDay.length > 0);

  // いまの時刻（その人のタイムゾーンで、今日の0時からの分）
  const nowMin = Math.round((Math.floor(Date.now() / 1000) - dayStartSec(today, tz)) / 60);

  // 開いたとき・週を変えたときに、予定の始まる時刻（今週に今日があれば、いまの時刻）のあたりが見えるようにスクロールする
  const scrollRef = useRef<HTMLDivElement>(null);
  const weekKey = days[0];
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let targetMin = 8 * 60;
    const starts = perDay.flatMap((d) => d.items.map((it) => it.startMin));
    if (days.includes(today)) {
      targetMin = Math.max(firstHour * 60, nowMin - 60);
    } else if (starts.length > 0) {
      targetMin = Math.min(...starts) - 30;
    }
    el.scrollTop = Math.max(0, minToPx(targetMin));
    // 週を変えたときだけ動かす（予定の読み込みで、見ている位置が動かないように）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekKey]);

  return (
    <div className="overflow-x-auto select-none">
      <div className="min-w-[480px]">
        {/* ヘッダー行（曜日・日付・祝日名） */}
        <div className="flex" style={{ marginLeft: `${TIME_COL_PX}px` }}>
          {days.map((key) => {
            const { d } = parseKey(key);
            const holiday = holidayOf(key);
            const isToday = key === today;
            const isSel = key === selected;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onPick(key)}
                aria-pressed={isSel}
                aria-label={`${parseKey(key).m}月${d}日${holiday ? `（${holiday}）` : ""}を選ぶ`}
                className="flex-1 min-w-0 text-center py-1 rounded-t-xl"
                style={{ borderLeft: "1px solid var(--color-paper-300)", background: isSel ? "rgba(181,56,75,0.10)" : "transparent" }}
              >
                <div className="text-[11px]" style={{ color: dayColor(key) }}>{WEEKDAY_LABELS[weekdayOf(key)]}</div>
                <div
                  className="text-sm font-semibold mt-0.5 w-7 h-7 rounded-full flex items-center justify-center mx-auto"
                  style={isToday ? { background: "var(--color-accent)", color: "white" } : { color: dayColor(key) }}
                >
                  {d}
                </div>
                <div className="text-[9px] leading-tight truncate px-0.5 h-3" style={{ color: "var(--color-brand)" }} title={holiday ?? undefined}>
                  {holiday ?? ""}
                </div>
              </button>
            );
          })}
        </div>

        {/* 終日の予定（Googleカレンダー） */}
        {hasAllDay && (
          <div className="flex mb-1" style={{ marginLeft: `${TIME_COL_PX}px` }}>
            {perDay.map((d) => (
              <div key={d.key} className="flex-1 min-w-0 px-0.5 space-y-px" style={{ borderLeft: "1px solid var(--color-paper-300)" }}>
                {d.allDay.slice(0, 2).map((g) => (
                  <div key={g.id} title={g.title} className="rounded px-1 text-[9px] leading-tight truncate"
                    style={{ background: googleTint(0.16), border: `1px solid ${googleTint(0.4)}`, color: "var(--color-ink-600)" }}>
                    {g.title}
                  </div>
                ))}
                {d.allDay.length > 2 && <div className="text-[9px] px-1" style={{ color: "var(--color-ink-500)" }}>他{d.allDay.length - 2}件</div>}
              </div>
            ))}
          </div>
        )}

        {/* 時間軸＋予定（縦に長いので、枠の中でスクロールする） */}
        <div ref={scrollRef} className="overflow-y-auto rounded-b-xl" style={{ maxHeight: "26rem" }}>
          <div className="flex relative" style={{ height: `${gridHeight}px` }}>
            <div className="shrink-0" style={{ width: `${TIME_COL_PX}px` }}>
              {hours.map((h) => (
                <div key={h} className="text-right pr-1 text-[10px] leading-none tabular-nums"
                  style={{ height: `${CELL_HEIGHT_PX}px`, paddingTop: "2px", color: "var(--color-ink-400)" }}>
                  {h}:00
                </div>
              ))}
            </div>

            {perDay.map((d) => {
              const holiday = holidayOf(d.key);
              const dow = weekdayOf(d.key);
              const isSel = d.key === selected;
              return (
                <div
                  key={d.key}
                  className="flex-1 min-w-0 relative cursor-pointer"
                  onClick={() => onPick(d.key)}
                  style={{
                    borderLeft: "1px solid var(--color-paper-300)",
                    background: isSel ? "rgba(181,56,75,0.07)" : holiday || dow === 0 ? "rgba(181,56,75,0.03)" : dow === 6 ? "rgba(63,111,166,0.03)" : "transparent",
                  }}
                >
                  {hours.map((h) => (
                    <div key={h} className="absolute w-full pointer-events-none"
                      style={{ top: `${(h - firstHour) * CELL_HEIGHT_PX}px`, height: `${CELL_HEIGHT_PX}px`, borderTop: "1px solid var(--color-paper-200)" }} />
                  ))}

                  {/* いまの時刻 */}
                  {d.key === today && nowMin >= firstHour * 60 && nowMin <= lastHour * 60 && (
                    <div className="absolute w-full pointer-events-none" style={{ top: `${minToPx(nowMin)}px`, borderTop: "2px solid var(--color-brand)", zIndex: 6 }} />
                  )}

                  {d.items.map((it) => {
                    const top = minToPx(it.startMin);
                    const height = Math.max(((it.endMin - it.startMin) / 60) * CELL_HEIGHT_PX, 16);
                    const widthPct = 100 / it.lanes;
                    const pos = { top: `${top}px`, height: `${height}px`, left: `calc(${it.lane * widthPct}% + 1px)`, width: `calc(${widthPct}% - 2px)` };
                    if (it.type === "google") {
                      return (
                        <div key={it.key} title={`${it.ev.title}（Googleカレンダー）`} className="absolute rounded overflow-hidden pointer-events-none"
                          style={{
                            ...pos,
                            background: `repeating-linear-gradient(45deg, ${googleTint(0.10)}, ${googleTint(0.10)} 4px, ${googleTint(0.18)} 4px, ${googleTint(0.18)} 8px)`,
                            border: `1px solid ${googleTint(0.4)}`,
                          }}>
                          <span className="block px-0.5 text-[9px] leading-tight truncate" style={{ color: "var(--color-ink-700)" }}>{it.ev.title}</span>
                        </div>
                      );
                    }
                    const ev = it.ev;
                    return (
                      <Link
                        key={it.key}
                        to={ev.linkPath}
                        title={`${ev.title}（${fmtTime(ev.startsAt, tz)}〜${fmtTime(ev.endsAt, tz)}）`}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute rounded overflow-hidden px-0.5 text-white"
                        style={{ ...pos, background: ev.titleColor ?? KIND_COLOR[ev.kind], opacity: isMuted(ev) ? 0.45 : 1, zIndex: 5 }}
                      >
                        {/* 幅がせまいとき（予定が重なっているとき）は、タイトルを折り返して、読める範囲を増やす */}
                        <span className={`block text-[10px] leading-tight ${it.lanes > 1 ? "break-all" : "truncate"}`}>{ev.typeEmoji ?? KIND_INFO[ev.kind].icon} {ev.title}</span>
                        {height >= 34 && it.lanes === 1 && (
                          <span className="block text-[9px] leading-tight tabular-nums opacity-90 truncate">
                            {fmtTime(ev.startsAt, tz)}〜{fmtTime(ev.endsAt, tz)}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Googleカレンダーの予定の色（土曜の青を、うすくして使う） */
function googleTint(alpha: number): string {
  return `color-mix(in srgb, var(--color-saturday) ${Math.round(alpha * 100)}%, transparent)`;
}
