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

/** 毎月の「第N曜日」の1つ分（weekOfMonth: 1〜5 または -1=最終週、dayOfWeek: 0=日 .. 6=土） */
export type MonthlySlot = { weekOfMonth: number; dayOfWeek: number };
/** 1つの毎月パターンに設定できる「第N曜日」の最大数（1つ目＋追加分） */
export const MAX_MONTHLY_SLOTS = 3;

export type RecurrencePattern = {
  recurrenceType: RecurrenceType;
  dayOfWeek: number; // 0=日 .. 6=土（monthly / weekly / biweekly のみ使用）
  weekOfMonth: number | null; // monthly: 1〜5 または -1(最終週) ／ monthly_day: 日付(1〜31)
  startTimeLocal: string; // "19:00"
  endTimeLocal: string;   // "20:00"
  /** monthly のみ：同じ月の2つ目以降の「第N曜日」（例：毎月 第1火曜日と第3水曜日 の、第3水曜日）。最大2件 */
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
      return isValidSlot(o) ? [{ weekOfMonth: o.weekOfMonth as number, dayOfWeek: o.dayOfWeek as number }] : [];
    }).slice(0, MAX_MONTHLY_SLOTS - 1);
  } catch { return []; }
}

export function isValidSlot(s: { weekOfMonth?: unknown; dayOfWeek?: unknown }): boolean {
  return Number.isInteger(s.weekOfMonth) && ((s.weekOfMonth as number) === -1 || ((s.weekOfMonth as number) >= 1 && (s.weekOfMonth as number) <= 5))
    && Number.isInteger(s.dayOfWeek) && (s.dayOfWeek as number) >= 0 && (s.dayOfWeek as number) <= 6;
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
      // その月の開催日。毎月の「第N曜日」を複数指定しているときは、すべての日を日付順に並べる（同じ日になったものは1つにまとめる）
      const days = new Set<number>();
      const first = dayOfMonthFor(pattern, year, month);
      if (first !== null) days.add(first);
      if (pattern.recurrenceType === "monthly") {
        for (const slot of (pattern.extraSlots ?? []).slice(0, MAX_MONTHLY_SLOTS - 1)) {
          const d = nthWeekdayOfMonth(year, month, slot.dayOfWeek, slot.weekOfMonth);
          if (d !== null) days.add(d);
        }
      }
      let reachedEnd = false;
      for (const day of [...days].sort((a, b) => a - b)) {
        if (results.length >= maxCount) break;
        const startsAt = jstDateTimeToUnix(year, month, day, pattern.startTimeLocal);
        if (startsAt < fromTs) continue;
        if (endDate !== null && startsAt > endDate) { reachedEnd = true; break; }
        results.push({ startsAt, endsAt: jstDateTimeToUnix(year, month, day, pattern.endTimeLocal) });
      }
      if (reachedEnd) break;
      month++;
      if (month > 12) { month = 1; year++; }
    }
    return results;
  }

  // weekly / biweekly
  const stepDays = pattern.recurrenceType === "biweekly" ? 14 : 7;
  const fromParts = jstPartsFromUnix(fromTs);
  const diffToFirst = (pattern.dayOfWeek - fromParts.dayOfWeek + 7) % 7;
  let cursor = new Date(Date.UTC(fromParts.year, fromParts.month - 1, fromParts.day + diffToFirst));

  while (results.length < maxCount) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    const day = cursor.getUTCDate();
    const startsAt = jstDateTimeToUnix(year, month, day, pattern.startTimeLocal);
    if (startsAt >= fromTs) {
      if (endDate !== null && startsAt > endDate) break;
      const endsAt = jstDateTimeToUnix(year, month, day, pattern.endTimeLocal);
      results.push({ startsAt, endsAt });
    }
    cursor = new Date(cursor.getTime() + stepDays * 86400_000);
  }
  return results;
}
