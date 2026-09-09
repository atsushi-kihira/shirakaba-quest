// =============================================================
// 定例会（繰り返しミーティング）の開催日時計算
// タイムゾーンは常に Asia/Tokyo（UTC+9、夏時間なし）固定で計算する。
// =============================================================

const JST_OFFSET_SECONDS = 9 * 60 * 60;

export type RecurrencePattern = {
  recurrenceType: "weekly" | "biweekly" | "monthly";
  dayOfWeek: number; // 0=日 .. 6=土
  weekOfMonth: number | null; // 1〜5、または -1(最終週)。monthlyのみ使用
  startTimeLocal: string; // "19:00"
  endTimeLocal: string;   // "20:00"
};

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

  if (pattern.recurrenceType === "monthly") {
    let { year, month } = jstPartsFromUnix(fromTs);
    let guardMonths = 0;
    while (results.length < maxCount && guardMonths < MAX_OCCURRENCES * 2) {
      guardMonths++;
      const day = nthWeekdayOfMonth(year, month, pattern.dayOfWeek, pattern.weekOfMonth ?? 1);
      if (day !== null) {
        const startsAt = jstDateTimeToUnix(year, month, day, pattern.startTimeLocal);
        if (startsAt >= fromTs) {
          const endsAt = jstDateTimeToUnix(year, month, day, pattern.endTimeLocal);
          if (endDate !== null && startsAt > endDate) break;
          results.push({ startsAt, endsAt });
        }
      }
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
