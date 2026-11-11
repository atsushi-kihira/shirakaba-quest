// =============================================================
// カレンダー表示用の日付ユーティリティ
// 日付は "YYYY-MM-DD" の文字列（システム／個人のタイムゾーンでの暦の日付）で扱う。
// 日付の計算は UTC で行い、タイムゾーンのずれの影響を受けないようにする。
// =============================================================

export type DayKey = string; // "2026-11-10"

export function parseKey(key: DayKey): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

export function makeKey(y: number, m: number, d: number): DayKey {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function utcDate(key: DayKey): Date {
  const { y, m, d } = parseKey(key);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtcDate(dt: Date): DayKey {
  return makeKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(key: DayKey, n: number): DayKey {
  const dt = utcDate(key);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUtcDate(dt);
}

/** 月を n か月ずらした月の1日 */
export function addMonthsFirst(key: DayKey, n: number): DayKey {
  const { y, m } = parseKey(key);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  return fromUtcDate(dt);
}

/** 曜日（0=日 … 6=土） */
export function weekdayOf(key: DayKey): number {
  return utcDate(key).getUTCDay();
}

/** 指定のタイムゾーンでの「今日」 */
export function todayKey(tz: string): DayKey {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p; // en-CA は YYYY-MM-DD
}

/** その日を含む週（日曜始まり）の7日 */
export function weekDays(key: DayKey): DayKey[] {
  const start = addDays(key, -weekdayOf(key));
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** その月のカレンダー（日曜始まり）。前後の月の日で埋めて、週の単位（5〜6週）にそろえる */
export function monthDays(key: DayKey): DayKey[] {
  const { y, m } = parseKey(key);
  const first = makeKey(y, m, 1);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = makeKey(y, m, lastDay);
  const start = addDays(first, -weekdayOf(first));
  const end = addDays(last, 6 - weekdayOf(last));
  const days: DayKey[] = [];
  for (let k = start; k <= end; k = addDays(k, 1)) days.push(k);
  return days;
}

/** あるタイムゾーンでのUTCとの差（ミリ秒） */
function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** そのタイムゾーンでの、その日の0時のUnix秒 */
export function dayStartSec(key: DayKey, tz: string): number {
  const { y, m, d } = parseKey(key);
  const localAsUtc = Date.UTC(y, m - 1, d);
  let guess = localAsUtc - tzOffsetMs(localAsUtc, tz);
  guess = localAsUtc - tzOffsetMs(guess, tz); // 夏時間の境目では、もう一度補正する
  return Math.floor(guess / 1000);
}
