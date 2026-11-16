// =============================================================
// 1to1の「日時を選び直す」ができるかの判定
// =============================================================

export type ReselectableSession = {
  myRole: "requester" | "responder";
  status: "pending" | "accepted" | "completed" | "rejected" | "cancelled";
  arrangementMethod?: "public_url" | "candidates";
  scheduledFor?: number | null;
  requesterSchedulerUrl?: string | null;
  requesterCompletedAt: number | null;
  responderCompletedAt: number | null;
};

/** 日時を選び直せる1to1か（相手から申し込まれた側が、日時決定後・完了前に、選び直せる方式のものだけ） */
export function canReselectSchedule(s: ReselectableSession): boolean {
  if (s.myRole !== "responder") return false;
  if (s.status !== "pending" && s.status !== "accepted") return false;
  if (!s.scheduledFor) return false;
  if (s.requesterCompletedAt || s.responderCompletedAt) return false;
  // 候補日から選ぶ方式、または相手の予約ページから選ぶ方式のときだけ。
  // それ以外（別途調整済みの日時を手入力したもの）は、「編集」で直接直せる
  return s.arrangementMethod === "candidates" || !!s.requesterSchedulerUrl;
}
