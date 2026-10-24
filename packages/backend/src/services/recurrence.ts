// =============================================================
// 定例会（繰り返しミーティング）の開催日時計算
// タイムゾーンは常に Asia/Tokyo（UTC+9、夏時間なし）固定で計算する。
// =============================================================

import { isJapanHoliday } from "./japan-holidays.ts";

const JST_OFFSET_SECONDS = 9 * 60 * 60;

// 毎月の指定方法
//  monthly             : 第N 曜日（weekOfMonth = 1〜5 / -1=最終週、dayOfWeek = 曜日）
//  monthly_day         : 固定日（weekOfMonth に日付 1〜31 を入れる。その月にない日は月末日にする。dayOfWeekは未使用）
//  monthly_end         : 月末（土日祝を含む暦上の最終日）
//  monthly_end_weekday : 月末（土日祝にあたる場合は、直前の平日）
export type RecurrenceType = "weekly" | "biweekly" | "monthly" | "monthly_day" | "monthly_end" | "monthly_end_weekday";
export const RECURRENCE_TYPES: RecurrenceType[] = ["weekly", "biweekly", "monthly", "monthly_day", "monthly_end", "monthly_end_weekday"];

/**
 * 1つのパターンの中の「日」の1つ分。毎月は「第N曜日」（weekOfMonth: 1〜5 または -1=最終週、dayOfWeek: 0=日 .. 6=土）、
 * 毎週・隔週は「X曜日」（weekOfMonth は使わない）。日ごとに開始・終了時刻を決められる。
 */
export type MonthlySlot = {
  weekOfMonth?: number;
  dayOfWeek: number;
  /** この日の開始・終了時刻（"19:00"）。省略したときは、パターンの時刻（1つ目の日の時刻）と同じ */
  startTimeLocal?: string;
  endTimeLocal?: string;
};
/** 1つのパターンに設定できる「日」の最大数（1つ目＋追加分）。毎月の第N曜日・毎週・隔週で共通 */
export const MAX_MONTHLY_SLOTS = 3;
/** 同じ週・同じ月に複数の日を設定できる繰り返しの種類 */
export const MULTI_SLOT_TYPES: RecurrenceType[] = ["weekly", "biweekly", "monthly"];

export type RecurrencePattern = {
  recurrenceType: RecurrenceType;
  dayOfWeek: number; // 0=日 .. 6=土（monthly / weekly / biweekly のみ使用）
  weekOfMonth: number | null; // monthly: 1〜5 または -1(最終週) ／ monthly_day: 日付(1〜31)
  startTimeLocal: string; // "19:00"
  endTimeLocal: string;   // "20:00"
  /** 毎週・隔週・毎月（第N曜日）のみ：2つ目以降の日（例：毎月 第1火曜日と第3水曜日 の、第3水曜日／毎週 火曜日と木曜日 の、木曜日）。最大2件 */
  extraSlots?: MonthlySlot[];
};

/** DBに持っている追加分（JSON文字列）を、正しい形のものだけ取り出す */
export function parseExtraSlots(raw: string | null | undefined): MonthlySlot[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.flatMap((s: unknown) => {
      const o = s as { weekOfMonth?: unknown; dayOfWeek?: unknown };
      const t = s as { startTimeLocal?: unknown; endTimeLocal?: unknown };
      if (!isValidSlot(o, o.weekOfMonth !== undefined)) return [];
      const slot: MonthlySlot = { dayOfWeek: o.dayOfWeek as number };
      if (o.weekOfMonth !== undefined) slot.weekOfMonth = o.weekOfMonth as number;
      if (typeof t.startTimeLocal === "string" && TIME_RE.test(t.startTimeLocal) && typeof t.endTimeLocal === "string" && TIME_RE.test(t.endTimeLocal)) {
        slot.startTimeLocal = t.startTimeLocal;
        slot.endTimeLocal = t.endTimeLocal;
      }
      return [slot];
    }).slice(0, MAX_MONTHLY_SLOTS - 1);
  } catch { return []; }
}

const TIME_RE = /^\d{2}:\d{2}$/;

/**
 * 「日」1つ分の指定が正しいか。曜日、毎月（第N曜日）のときは第◯週（needsWeek=true）、時刻を指定している場合は時刻の形式と、終了が開始より後であること。
 */
export function isValidSlot(s: { weekOfMonth?: unknown; dayOfWeek?: unknown; startTimeLocal?: unknown; endTimeLocal?: unknown }, needsWeek = true): boolean {
  if (s.startTimeLocal !== undefined || s.endTimeLocal !== undefined) {
    if (typeof s.startTimeLocal !== "string" || typeof s.endTimeLocal !== "string" || !TIME_RE.test(s.startTimeLocal) || !TIME_RE.test(s.endTimeLocal) || s.startTimeLocal >= s.endTimeLocal) return false;
  }
  const weekOk = !needsWeek || (Number.isInteger(s.weekOfMonth) && ((s.weekOfMonth as number) === -1 || ((s.weekOfMonth as number) >= 1 && (s.weekOfMonth as number) <= 5)));
  return weekOk && Number.isInteger(s.dayOfWeek) && (s.dayOfWeek as number) >= 0 && (s.dayOfWeek as number) <= 6;
}

type JstParts = { year: number; month: number; day: number; dayOfWeek: number };

function jstPartsFromUnix(ts: number): JstParts {
  const d = new Date((ts + JST_OFFSET_SECONDS) * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    dayOfWeek: d.getUTCDay(),
  };
}

function jstDateTimeToUnix(year: number, month: number, day: number, timeLocal: string): number {
  const [hh, mm] = timeLocal.split(":").map((v) => Number.parseInt(v, 10));
  const utcMs = Date.UTC(year, month - 1, day, hh, mm, 0) - JST_OFFSET_SECONDS * 1000;
  return Math.floor(utcMs / 1000);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 指定した年月における「第N曜日」（N=-1なら最終週）の日付を返す。存在しない場合はnull（例：5週目がない月） */
function nthWeekdayOfMonth(year: number, month: number, dayOfWeek: number, weekOfMonth: number): number | null {
  if (weekOfMonth === -1) {
    const last = daysInMonth(year, month);
    const lastDow = jstPartsFromUnix(jstDateTimeToUnix(year, month, last, "00:00")).dayOfWeek;
    const diff = (lastDow - dayOfWeek + 7) % 7;
    return last - diff;
  }
  const firstDow = jstPartsFromUnix(jstDateTimeToUnix(year, month, 1, "00:00")).dayOfWeek;
  const diff = (dayOfWeek - firstDow + 7) % 7;
  const day = 1 + diff + (weekOfMonth - 1) * 7;
  return day <= daysInMonth(year, month) ? day : null;
}

/** 月ごとの開催日（その月の何日か）。該当日がない月は null */
function dayOfMonthFor(pattern: RecurrencePattern, year: number, month: number): number | null {
  const last = daysInMonth(year, month);
  switch (pattern.recurrenceType) {
    case "monthly_day":
      return Math.min(Math.max(pattern.weekOfMonth ?? 1, 1), last);
    case "monthly_end":
      return last;
    case "monthly_end_weekday": {
      let day = last;
      while (day > 1) {
        const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
        if (dow !== 0 && dow !== 6 && !isJapanHoliday(year, month, day)) break;
        day--;
      }
      return day;
    }
    default:
      return nthWeekdayOfMonth(year, month, pattern.dayOfWeek, pattern.weekOfMonth ?? 1);
  }
}

const MAX_OCCURRENCES = 200; // 暴走防止（週次5年分弱に相当）

/**
 * 確定したパターンと終了条件から、開催日時（開始・終了unix秒）の一覧を生成する。
 * fromTs以降（その日を含む）で最初に条件に合う日から開始する。
 */
export function computeOccurrences(
  pattern: RecurrencePattern,
  fromTs: number,
  endCondition: { type: "date"; endDate: number } | { type: "count"; count: number }
): Array<{ startsAt: number; endsAt: number }> {
  const results: Array<{ startsAt: number; endsAt: number }> = [];
  const maxCount = endCondition.type === "count" ? Math.min(endCondition.count, MAX_OCCURRENCES) : MAX_OCCURRENCES;
  const endDate = endCondition.type === "date" ? endCondition.endDate : null;

  if (pattern.recurrenceType.startsWith("monthly")) {
    let { year, month } = jstPartsFromUnix(fromTs);
    let guardMonths = 0;
    while (results.length < maxCount && guardMonths < MAX_OCCURRENCES * 2) {
      guardMonths++;
      // その月の開催日（日付と、その日の時刻）。毎月の「第N曜日」を複数指定しているときは、すべての日を日付順に並べる
      // （日ごとに時刻を変えられる。同じ日の同じ開始時刻になったものは1つにまとめる）
      const slots: { day: number; start: string; end: string }[] = [];
      const first = dayOfMonthFor(pattern, year, month);
      if (first !== null) slots.push({ day: first, start: pattern.startTimeLocal, end: pattern.endTimeLocal });
      if (pattern.recurrenceType === "monthly") {
        for (const slot of (pattern.extraSlots ?? []).slice(0, MAX_MONTHLY_SLOTS - 1)) {
          const d = slot.weekOfMonth === undefined ? null : nthWeekdayOfMonth(year, month, slot.dayOfWeek, slot.weekOfMonth);
          if (d === null) continue;
          const start = slot.startTimeLocal ?? pattern.startTimeLocal;
          if (slots.some((x) => x.day === d && x.start === start)) continue;
          slots.push({ day: d, start, end: slot.endTimeLocal ?? pattern.endTimeLocal });
        }
      }
      slots.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
      let reachedEnd = false;
      for (const slot of slots) {
        if (results.length >= maxCount) break;
        const startsAt = jstDateTimeToUnix(year, month, slot.day, slot.start);
        if (startsAt < fromTs) continue;
        if (endDate !== null && startsAt > endDate) { reachedEnd = true; break; }
        results.push({ startsAt, endsAt: jstDateTimeToUnix(year, month, slot.day, slot.end) });
      }
      if (reachedEnd) break;
      month++;
      if (month > 12) { month = 1; year++; }
    }
    return results;
  }

  // weekly / biweekly
  // 週は月曜はじまり。毎週・隔週に複数の曜日（それぞれ時刻つき）を指定できる。
  //   毎週：fromTs を含む週から、毎週すべての曜日。
  //   隔週：1つ目の曜日が最初に来る週を起点に、2週おきに、すべての曜日（起点の週の、fromTs より前の日は含めない）。
  const stepWeeks = pattern.recurrenceType === "biweekly" ? 2 : 1;
  const slots = [
    { dow: pattern.dayOfWeek, start: pattern.startTimeLocal, end: pattern.endTimeLocal },
    ...(pattern.extraSlots ?? []).slice(0, MAX_MONTHLY_SLOTS - 1).map((x) => ({
      dow: x.dayOfWeek, start: x.startTimeLocal ?? pattern.startTimeLocal, end: x.endTimeLocal ?? pattern.endTimeLocal,
    })),
  ];
  const mondayIndex = (dow: number) => (dow + 6) % 7; // 月=0 .. 日=6
  slots.sort((a, b) => mondayIndex(a.dow) - mondayIndex(b.dow) || a.start.localeCompare(b.start));
  const DAY_MS = 86400_000;
  const fromParts = jstPartsFromUnix(fromTs);
  const fromDateMs = Date.UTC(fromParts.year, fromParts.month - 1, fromParts.day);
  let anchorMs = fromDateMs;
  if (stepWeeks === 2) {
    // 1つ目の曜日が、fromTs 以降で最初に来る日（従来の隔週と同じ）を含む週を起点にする
    anchorMs = fromDateMs + ((pattern.dayOfWeek - fromParts.dayOfWeek + 7) % 7) * DAY_MS;
    anchorMs -= mondayIndex(pattern.dayOfWeek) * DAY_MS;
  } else {
    anchorMs -= mondayIndex(fromParts.dayOfWeek) * DAY_MS;
  }
  let guard = 0;
  for (let w = 0; results.length < maxCount && guard < MAX_OCCURRENCES * 2; w += stepWeeks, guard++) {
    for (const slot of slots) {
      if (results.length >= maxCount) break;
      const d = new Date(anchorMs + (w * 7 + mondayIndex(slot.dow)) * DAY_MS);
      const startsAt = jstDateTimeToUnix(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), slot.start);
      if (startsAt < fromTs) continue;
      if (endDate !== null && startsAt > endDate) return results;
      results.push({ startsAt, endsAt: jstDateTimeToUnix(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), slot.end) });
    }
  }
  return results;
}
