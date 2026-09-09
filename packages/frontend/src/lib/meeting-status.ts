// =============================================================
// 通常ミーティングの「実効ステータス」判定
// バッジの件数と一覧の表示ラベルの両方で、この判定を共通利用することで
// 「バッジの数字と一覧の表示が食い違う」ことを防ぐ
// =============================================================

export type MeetingForStatus = {
  isHost: boolean;
  status: string; // "open" | "confirmed" | "cancelled"
  hasResponded: boolean;
  deadline?: number | null;
  confirmedDate: { startsAt: number; endsAt: number | null } | null;
};

export type EffectiveStatus =
  | "cancelled"                  // キャンセル
  | "past"                       // 実施済み（確定済み・実施日超過）
  | "attending"                  // 参加予定（確定済み・回答済み・実施日未到来）
  | "response_closed"            // 回答受付終了（募集中・回答期限超過）
  | "responded_pending_confirm"  // 回答済み・確定待ち（募集中・回答済み）
  | "new"                        // 新着・未回答（未読のお知らせあり）
  | "seen_unresponded";          // 既読・未回答

/** 招待された側（自分が主催者でない）の実効ステータスを判定する */
export function getMeetingEffectiveStatus(
  m: MeetingForStatus,
  hasUnreadNotification: boolean,
  nowSec: number
): EffectiveStatus {
  if (m.status === "cancelled") return "cancelled";

  if (m.status === "confirmed") {
    const startsAt = m.confirmedDate?.startsAt ?? null;
    if (startsAt !== null && startsAt < nowSec) return "past";
    if (m.hasResponded) return "attending";
    return hasUnreadNotification ? "new" : "seen_unresponded";
  }

  // status === "open"
  if (m.deadline != null && m.deadline < nowSec) return "response_closed";
  if (m.hasResponded) return "responded_pending_confirm";
  return hasUnreadNotification ? "new" : "seen_unresponded";
}

/** バッジ（件数）にカウントすべき状態か */
export function isActionableStatus(s: EffectiveStatus): boolean {
  return s === "new" || s === "seen_unresponded";
}

export const STATUS_META: Record<EffectiveStatus, { label: string; bg: string; color: string }> = {
  cancelled:                 { label: "キャンセル",           bg: "var(--color-paper-300)",        color: "var(--color-ink-400)" },
  past:                      { label: "実施済み",             bg: "var(--color-paper-200)",        color: "var(--color-ink-400)" },
  attending:                 { label: "参加予定",             bg: "rgba(90,140,92,0.12)",          color: "var(--color-success)" },
  response_closed:           { label: "回答受付終了",         bg: "var(--color-paper-200)",        color: "var(--color-ink-400)" },
  responded_pending_confirm:{ label: "回答済み・確定待ち",   bg: "var(--color-paper-200)",        color: "var(--color-ink-500)" },
  new:                       { label: "新着・回答をお願いします", bg: "rgba(181,56,75,0.1)",       color: "var(--color-brand)" },
  seen_unresponded:          { label: "回答をお願いします",   bg: "rgba(212,160,59,0.15)",         color: "var(--color-accent)" },
};
