// =============================================================
// タイムゾーン対応 日付フォーマットユーティリティ
// =============================================================

const DEFAULT_TZ = "Asia/Tokyo";

function parts(ts: number, tz: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: tz, ...opts }).formatToParts(
    new Date(ts * 1000)
  );
}

function get(arr: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return arr.find((p) => p.type === type)?.value ?? "";
}

/** "3/15(金)" */
export function fmtDateShort(ts: number, tz = DEFAULT_TZ): string {
  const p = parts(ts, tz, { month: "numeric", day: "numeric", weekday: "narrow" });
  return `${get(p, "month")}/${get(p, "day")}(${get(p, "weekday")})`;
}

/** "3月15日(金)" */
export function fmtDateJP(ts: number, tz = DEFAULT_TZ): string {
  const p = parts(ts, tz, { month: "numeric", day: "numeric", weekday: "narrow" });
  return `${get(p, "month")}月${get(p, "day")}日(${get(p, "weekday")})`;
}

/** "2024/3/15" */
export function fmtDateISO(ts: number, tz = DEFAULT_TZ): string {
  const p = parts(ts, tz, { year: "numeric", month: "numeric", day: "numeric" });
  return `${get(p, "year")}/${get(p, "month")}/${get(p, "day")}`;
}

/** "2024/3/15(金)" */
export function fmtDateFull(ts: number, tz = DEFAULT_TZ): string {
  const p = parts(ts, tz, { year: "numeric", month: "numeric", day: "numeric", weekday: "narrow" });
  return `${get(p, "year")}/${get(p, "month")}/${get(p, "day")}(${get(p, "weekday")})`;
}

/** "09:30" */
export function fmtTime(ts: number, tz = DEFAULT_TZ): string {
  const p = parts(ts, tz, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${get(p, "hour")}:${get(p, "minute")}`;
}

/** "3/15(金) 09:30" */
export function fmtDateTime(ts: number, tz = DEFAULT_TZ): string {
  const p = parts(ts, tz, {
    month: "numeric", day: "numeric", weekday: "narrow",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  return `${get(p, "month")}/${get(p, "day")}(${get(p, "weekday")}) ${get(p, "hour")}:${get(p, "minute")}`;
}

/** "2024/3/15(金) 09:30" */
export function fmtDateTimeFull(ts: number, tz = DEFAULT_TZ): string {
  const p = parts(ts, tz, {
    year: "numeric", month: "numeric", day: "numeric", weekday: "narrow",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  return `${get(p, "year")}/${get(p, "month")}/${get(p, "day")}(${get(p, "weekday")}) ${get(p, "hour")}:${get(p, "minute")}`;
}

/** 今日かどうか（タイムゾーン考慮） */
export function isToday(ts: number, tz = DEFAULT_TZ): boolean {
  const nowStr = new Intl.DateTimeFormat("ja-JP", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" }).format(Date.now());
  const tsStr  = new Intl.DateTimeFormat("ja-JP", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" }).format(new Date(ts * 1000));
  return nowStr === tsStr;
}

/** Unix秒 → "YYYY-MM-DD" (date input value 用) */
export function tsToDateInput(ts: number, tz = DEFAULT_TZ): string {
  const p = parts(ts, tz, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${get(p, "year")}-${get(p, "month")}-${get(p, "day")}`;
}
