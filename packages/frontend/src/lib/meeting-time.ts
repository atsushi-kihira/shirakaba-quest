// ミーティングの日時入力まわりの共通ヘルパー（1to1・通常ミーティング・定例会で共通）

/** 日時設定の既定の開始時刻 */
export const DEFAULT_START_TIME = "09:00";

function toMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function fromMinutes(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** 開始時刻に分数を足した終了時刻（"HH:MM"）。日をまたぐ場合は 23:59 で止める。 */
export function addMinutesToTime(start: string, minutes: number): string {
  const s = toMinutes(start);
  if (s === null) return "";
  return fromMinutes(Math.min(s + minutes, 23 * 60 + 59));
}

/** 既定の開始時刻（9:00）から始まる行の終了時刻 */
export function defaultEndTime(durationMinutes: number): string {
  return addMinutesToTime(DEFAULT_START_TIME, durationMinutes);
}

/**
 * 開始時刻を変更したときに、元の所要時間（終了−開始）を保ったまま終了時刻を追従させる。
 * 例: 9:00-10:00 の開始を 11:00 に変えると、終了は 12:00 になる。
 * 元の開始・終了のどちらかが未入力・不正な場合や、新しい開始が空の場合は、終了時刻をそのまま返す。
 */
export function shiftEndWithStart(oldStart: string, oldEnd: string, newStart: string): string {
  const os = toMinutes(oldStart);
  const oe = toMinutes(oldEnd);
  const ns = toMinutes(newStart);
  if (os === null || oe === null || ns === null || oe <= os) return oldEnd;
  return addMinutesToTime(newStart, oe - os);
}
