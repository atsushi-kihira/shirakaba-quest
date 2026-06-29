// 利用可能スロットの計算ロジック
// 仕様 §9.5 に準拠

import type { BusyBlock } from "./googleClient.ts";

export type AvailabilityRule = {
  dayOfWeek: number;       // 0=Sun … 6=Sat
  startTimeLocal: string;  // "09:00"
  endTimeLocal: string;    // "17:00"
  timezone: string;
};

export type AvailabilityOverride = {
  dateLocal: string;       // "2026-07-14"
  isBlocked: boolean;
  startTimeLocal: string | null;
  endTimeLocal: string | null;
};

export type Slot = { startUtc: string; endUtc: string };

// ローカル時刻文字列 "09:00" を、指定ローカル日 dateLocal の UTC ms に変換
function localTimeToUtcMs(dateLocal: string, timeStr: string, timezone: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  // ローカル日時をUTC扱いで構築してオフセットを計算
  const [year, month, day] = dateLocal.split("-").map(Number);
  const guessUtcMs = Date.UTC(year, month - 1, day, h, m, 0);
  // guessUtcMs がその timezone で何時になるか調べてオフセットを取得
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(guessUtcMs));
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value);
  const localMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  const offsetMs = localMs - guessUtcMs;  // local - utc = offsetMs
  // utc = local - offsetMs
  return Date.UTC(year, month - 1, day, h, m) - offsetMs;
}

// UTC ms をそのタイムゾーンでのローカル日付文字列 "YYYY-MM-DD" に変換
function utcMsToLocalDateStr(utcMs: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// UTC ms をそのタイムゾーンでの曜日 (0=Sun … 6=Sat) に変換
function utcMsToLocalDayOfWeek(utcMs: number, timezone: string): number {
  const dt = new Date(utcMs);
  const localWeekday = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(dt);
  const map: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return map[localWeekday] ?? 0;
}

export type CalculateSlotsArgs = {
  rules: AvailabilityRule[];
  overrides: AvailabilityOverride[];
  busy: BusyBlock[];
  durationMinutes: number;
  slotIntervalMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  fromUtc: Date;
  toUtc: Date;
  timezone: string;
  dailyMax?: number;
  existingBookingsPerDay: Map<string, number>;
};

export function calculateSlots(args: CalculateSlotsArgs): Slot[] {
  const {
    rules, overrides, busy,
    durationMinutes, slotIntervalMinutes,
    bufferBeforeMinutes, bufferAfterMinutes, minNoticeMinutes,
    fromUtc, toUtc, timezone, dailyMax, existingBookingsPerDay,
  } = args;

  const nowMs = Date.now();
  const minNoticeMs = minNoticeMinutes * 60 * 1000;
  const durationMs = durationMinutes * 60 * 1000;
  const slotIntervalMs = slotIntervalMinutes * 60 * 1000;
  const bufferBeforeMs = bufferBeforeMinutes * 60 * 1000;
  const bufferAfterMs = bufferAfterMinutes * 60 * 1000;

  const busyPairs = busy.map((b) => ({
    start: new Date(b.start).getTime(),
    end: new Date(b.end).getTime(),
  }));

  const overridesByDate = new Map<string, AvailabilityOverride[]>();
  for (const ov of overrides) {
    const arr = overridesByDate.get(ov.dateLocal) ?? [];
    arr.push(ov);
    overridesByDate.set(ov.dateLocal, arr);
  }

  const rulesByDow = new Map<number, AvailabilityRule[]>();
  for (const rule of rules) {
    const arr = rulesByDow.get(rule.dayOfWeek) ?? [];
    arr.push(rule);
    rulesByDow.set(rule.dayOfWeek, arr);
  }

  const slots: Slot[] = [];

  // 日付を UTC 00:00 刻みで巡回（最大 maxAdvanceDays 日）
  const startOfDay = new Date(Date.UTC(
    fromUtc.getUTCFullYear(), fromUtc.getUTCMonth(), fromUtc.getUTCDate()
  ));

  for (let dayMs = startOfDay.getTime(); dayMs < toUtc.getTime(); dayMs += 86400_000) {
    const localDateStr = utcMsToLocalDateStr(dayMs, timezone);
    const localDow = utcMsToLocalDayOfWeek(dayMs, timezone);

    const dateOverrides = overridesByDate.get(localDateStr) ?? [];
    const isBlocked = dateOverrides.some((o) => o.isBlocked);
    if (isBlocked) continue;

    let windows: { startMs: number; endMs: number }[] = [];

    // ベースとなる曜日ルールからウィンドウ生成
    for (const rule of rulesByDow.get(localDow) ?? []) {
      const startMs = localTimeToUtcMs(localDateStr, rule.startTimeLocal, timezone);
      const endMs = localTimeToUtcMs(localDateStr, rule.endTimeLocal, timezone);
      if (endMs > startMs) windows.push({ startMs, endMs });
    }

    // 時刻指定の override（追加ウィンドウ）
    for (const ov of dateOverrides) {
      if (!ov.isBlocked && ov.startTimeLocal && ov.endTimeLocal) {
        const startMs = localTimeToUtcMs(localDateStr, ov.startTimeLocal, timezone);
        const endMs = localTimeToUtcMs(localDateStr, ov.endTimeLocal, timezone);
        if (endMs > startMs) windows.push({ startMs, endMs });
      }
    }

    if (windows.length === 0) continue;

    let dailyCount = existingBookingsPerDay.get(localDateStr) ?? 0;

    for (const window of windows) {
      let slotStart = window.startMs;

      while (slotStart + durationMs <= window.endMs) {
        const slotEnd = slotStart + durationMs;

        // fromUtc/toUtc 範囲外は除外
        if (slotStart < fromUtc.getTime() || slotEnd > toUtc.getTime()) {
          slotStart += slotIntervalMs;
          continue;
        }

        // minNotice フィルタ
        if (slotStart < nowMs + minNoticeMs) {
          slotStart += slotIntervalMs;
          continue;
        }

        // dailyMax チェック
        if (dailyMax !== undefined && dailyCount >= dailyMax) break;

        // busy 区間との衝突チェック（buffer 込み）
        const effStart = slotStart - bufferBeforeMs;
        const effEnd = slotEnd + bufferAfterMs;
        const conflicts = busyPairs.some(
          (b) => effStart < b.end && effEnd > b.start
        );

        if (!conflicts) {
          slots.push({
            startUtc: new Date(slotStart).toISOString(),
            endUtc: new Date(slotEnd).toISOString(),
          });
          dailyCount++;
        }

        slotStart += slotIntervalMs;
      }
    }
  }

  return slots;
}
