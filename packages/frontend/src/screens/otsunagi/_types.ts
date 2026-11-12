// =============================================================
// お繋ぎ（ご紹介）— 共通の型と、状況の表示
// =============================================================
export type OtsunagiStage =
  | "waiting_member" | "arranging" | "confirmed" | "done" | "booking_cancelled" | "declined" | "cancelled" | "expired";

export type OtsunagiPerson = { id: string; name: string; emoji: string; bgColor: string };

export type OtsunagiItem = {
  id: string;
  role: "introducer" | "member";
  stage: OtsunagiStage;
  guestName: string;
  guestCompany: string | null;
  message: string;
  introducer: OtsunagiPerson;
  member: OtsunagiPerson;
  method: "public_url" | "candidates" | null;
  createdAt: number;
  preparedAt: number | null;
  expiresAt: number;
  guestOpened: boolean;
  guestEmailRegistered: boolean;
  confirmed: { startAtUtc: string; endAtUtc: string } | null;
};

export type OtsunagiDetail = OtsunagiItem & {
  receptionUrl: string | null;
  bookingId: string | null;
  candidateSlots: { startAt: number; endAt: number }[];
  googleConnected: boolean | null;
  invitePath: string | null;
};

/** 状況の表示（紹介者から見た言葉 / お繋ぎ先のメンバーから見た言葉） */
export const STAGE_LABEL: Record<OtsunagiStage, { introducer: string; member: string; tone: "wait" | "go" | "ok" | "off" }> = {
  waiting_member:    { introducer: "メンバーが日程を準備中", member: "日程の決め方を選んでください", tone: "go" },
  arranging:         { introducer: "相手の日時の選択待ち", member: "相手の日時の選択待ち", tone: "wait" },
  confirmed:         { introducer: "日程が決まりました", member: "日程が決まりました", tone: "ok" },
  done:              { introducer: "実施済み", member: "実施済み", tone: "ok" },
  booking_cancelled: { introducer: "決まった日程が取り消されました", member: "日程が取り消されました。改めて準備してください", tone: "go" },
  declined:          { introducer: "見送りになりました", member: "見送りました", tone: "off" },
  cancelled:         { introducer: "取り消しました", member: "取り消されました", tone: "off" },
  expired:           { introducer: "期限切れ", member: "期限切れ", tone: "off" },
};

export const TONE_STYLE: Record<"wait" | "go" | "ok" | "off", { bg: string; color: string }> = {
  wait: { bg: "rgba(212,160,59,0.16)", color: "#8A6516" },
  go:   { bg: "rgba(181,56,75,0.12)", color: "var(--color-brand)" },
  ok:   { bg: "rgba(90,140,92,0.16)", color: "#3D6B3F" },
  off:  { bg: "var(--color-paper-200)", color: "var(--color-ink-500)" },
};

export function fmtRange(startUtc: string, endUtc: string): string {
  const d = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(startUtc));
  const e = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }).format(new Date(endUtc));
  return `${d}〜${e}`;
}

export function fmtDate(sec: number): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "short" }).format(new Date(sec * 1000));
}

/** 外部の人に、ふだんの連絡手段（LINEなど）で送る案内文 */
export function buildGuestMessage(opts: { guestName: string; introducerName: string; memberName: string; url: string }): string {
  return `${opts.guestName}さん\n\n先日お話しした、${opts.memberName}さんをご紹介します。\n下記のページから、1to1（オンラインの個別面談）の日程をご確認ください。メールアドレスを入力しておくと、日程の準備ができたときにお知らせが届きます。\n\n${opts.url}\n\nよろしくお願いします。\n${opts.introducerName}`;
}
