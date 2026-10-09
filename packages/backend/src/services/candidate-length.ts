// =============================================================
// 候補日時の長さ（所要時間）の扱い
// 候補日時は「開始日時」だけを選び、所要時間はすべての候補に共通の長さにする。
// 画面からは開始日時と所要時間が送られてくるが、サーバー側でも終了時刻を「開始＋共通の所要時間」にそろえ、
// 8:00〜18:00のような極端に長い候補（空き時間帯を入れてしまった等）が作られないようにする。
// =============================================================

/** 所要時間の指定がない古い画面からの送信で許す最大の長さ。これを超える候補は60分にする */
export const MAX_CANDIDATE_MINUTES = 240;
export const DEFAULT_CANDIDATE_MINUTES = 60;

/** 共通の所要時間（分）が正しい指定か */
export function validDuration(minutes: unknown): minutes is number {
  return typeof minutes === "number" && Number.isFinite(minutes) && minutes >= 5 && minutes <= 480;
}

/**
 * 候補の終了時刻（秒）を決める。
 * ・共通の所要時間が指定されていれば、開始＋所要時間
 * ・指定がなければ、送られてきた終了時刻（長すぎる場合は60分）
 */
export function candidateEndSeconds(startsAt: number, endsAt: number | null | undefined, durationMinutes?: number | null): number | null {
  if (validDuration(durationMinutes)) return startsAt + Math.round(durationMinutes) * 60;
  if (endsAt === null || endsAt === undefined) return null;
  if (endsAt <= startsAt) return null;
  return endsAt - startsAt > MAX_CANDIDATE_MINUTES * 60 ? startsAt + DEFAULT_CANDIDATE_MINUTES * 60 : endsAt;
}
