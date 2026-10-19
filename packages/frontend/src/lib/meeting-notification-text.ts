// =============================================================
// ミーティング通知の種類ごとのアイコンと既定の文言（通知画面・対応が必要なことの一覧で共通利用）
// =============================================================
export function meetingNotifIcon(type: string): string {
  if (type === "conference_url_set") return "📹";
  if (type === "confirmed") return "✅";
  if (type === "invited") return "📨";
  if (type === "candidates_added") return "🗓️";
  if (type === "candidate_removed") return "🗑️";
  if (type === "candidate_updated") return "🗓️";
  if (type === "declined") return "🙇";
  if (type === "reminder") return "⏰";
  if (type === "unavailable_contact") return "💬";
  return "📝";
}

export function meetingNotifDefaultMessage(type: string): string {
  if (type === "conference_url_set") return "会議URLが届きました";
  if (type === "confirmed") return "ミーティングの日程が確定しました";
  if (type === "invited") return "ミーティングに招待されました";
  if (type === "candidates_added") return "新しい候補日が追加されました";
  if (type === "candidate_removed") return "候補日が削除されました";
  if (type === "candidate_updated") return "候補日が変更されました";
  if (type === "declined") return "辞退の連絡がありました";
  if (type === "reminder") return "まだご回答いただいていません";
  if (type === "unavailable_contact") return "都合が悪い旨のご連絡がありました";
  return "ミーティングに詳細が追加されました";
}
