// スケジューラー専用メールテンプレート（予約確認・キャンセル通知）
import { sendMail } from "./mailer.ts";

function formatDateJST(utcStr: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "long", day: "numeric",
    weekday: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(utcStr));
}

function formatTimeJST(utcStr: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(utcStr));
}

function formatDateRangeJST(startUtc: string, endUtc: string): string {
  return `${formatDateJST(startUtc)}〜${formatTimeJST(endUtc)}`;
}

function buildConferenceSection(
  conferenceType: string,
  conferenceUrl: string | null
): { text: string; html: string } {
  if (conferenceType === "google_meet" && conferenceUrl) {
    return {
      text: `📹 Google Meet: ${conferenceUrl}`,
      html: `<p>📹 <strong>Google Meet:</strong> <a href="${conferenceUrl}">${conferenceUrl}</a></p>`,
    };
  }
  if (conferenceType === "zoom" && conferenceUrl) {
    return {
      text: `📹 Zoom: ${conferenceUrl}`,
      html: `<p>📹 <strong>Zoom:</strong> <a href="${conferenceUrl}">${conferenceUrl}</a></p>`,
    };
  }
  return {
    text: "📹 会議 URL は主催者から別途ご連絡します。",
    html: "<p>📹 会議 URL は主催者から別途ご連絡します。</p>",
  };
}

const FOOTER_TEXT = "\n\n---\n白樺クエスト / Bizolve Consulting, Inc. © 2026";
const FOOTER_HTML = `<p style="color:#94A3B8;font-size:11px;margin-top:24px;">白樺クエスト / Bizolve Consulting, Inc. © 2026</p>`;

/** ゲスト向け予約確認メール */
export async function sendBookingConfirmationGuest(opts: {
  to: string;
  guestName: string;
  hostName: string;
  displayTitle: string;
  startAtUtc: string;
  endAtUtc: string;
  conferenceType: string;
  conferenceUrl: string | null;
  cancellationToken: string;
  frontendUrl: string;
  apiKey: string;
  fromEmail?: string;
  isDev: boolean;
}): Promise<void> {
  const {
    to, guestName, hostName, displayTitle,
    startAtUtc, endAtUtc, conferenceType, conferenceUrl,
    cancellationToken, frontendUrl, apiKey, fromEmail, isDev,
  } = opts;

  if (isDev) {
    console.log(`[DEV] 予約確認メール(ゲスト) → ${to}`);
    return;
  }

  const dateStr = formatDateJST(startAtUtc);
  const dateRangeStr = formatDateRangeJST(startAtUtc, endAtUtc);
  const conf = buildConferenceSection(conferenceType, conferenceUrl);
  const manageUrl = `${frontendUrl}/book/confirmation/${cancellationToken}`;
  const subject = `【予約確定】${dateRangeStr} ${hostName}さんとのミーティング`;

  await sendMail({
    to, apiKey, fromEmail,
    subject,
    text: [
      `${guestName}さん`,
      "",
      `${hostName}さんとの「${displayTitle}」の予約が確定しました。`,
      "",
      `📅 日時：${dateRangeStr}（日本時間）`,
      conf.text,
      "",
      `予約の管理（キャンセル等）: ${manageUrl}`,
      FOOTER_TEXT,
    ].join("\n"),
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <h2 style="color:#B5384B;font-size:20px;margin-bottom:8px;">🗓️ 予約が確定しました</h2>
        <p style="color:#4A3E36;line-height:1.7;">${guestName}さん<br><br>
          <strong>${hostName}</strong>さんとの<br>
          「<strong>${displayTitle}</strong>」の予約が確定しました。
        </p>
        <div style="background:#FAF5E8;border:2px solid #5A8C5C;border-radius:16px;padding:20px;margin:16px 0;">
          <p style="color:#5A8C5C;font-size:20px;font-weight:bold;margin:0 0 8px;">✅ 予約確定</p>
          <p style="font-size:18px;font-weight:bold;color:#1A1410;margin:0 0 12px;">📅 ${dateRangeStr}</p>
          ${conf.html}
        </div>
        <p style="color:#6B5E50;font-size:13px;margin-top:16px;">
          <a href="${manageUrl}" style="color:#B5384B;">予約を管理する（キャンセル等）</a>
        </p>
        ${FOOTER_HTML}
      </div>
    `,
  });
}

/** ホスト向け予約通知メール */
export async function sendBookingNotificationHost(opts: {
  to: string;
  hostName: string;
  guestName: string;
  guestEmail: string;
  guestMessage: string | null;
  displayTitle: string;
  startAtUtc: string;
  endAtUtc: string;
  conferenceType: string;
  conferenceUrl: string | null;
  frontendUrl: string;
  bookingId: string;
  apiKey: string;
  fromEmail?: string;
  isDev: boolean;
}): Promise<void> {
  const {
    to, hostName, guestName, guestEmail, guestMessage, displayTitle,
    startAtUtc, endAtUtc, conferenceType, conferenceUrl,
    frontendUrl, bookingId, apiKey, fromEmail, isDev,
  } = opts;

  if (isDev) {
    console.log(`[DEV] 予約通知メール(ホスト) → ${to}`);
    return;
  }

  const dateRangeStr = formatDateRangeJST(startAtUtc, endAtUtc);
  const conf = buildConferenceSection(conferenceType, conferenceUrl);
  const detailUrl = `${frontendUrl}/scheduler/bookings/${bookingId}`;
  const subject = `【予約通知】${dateRangeStr} ${guestName}さんが予約しました`;

  await sendMail({
    to, apiKey, fromEmail,
    subject,
    text: [
      `${hostName}さん`,
      "",
      `${guestName}さん（${guestEmail}）から「${displayTitle}」の予約が入りました。`,
      "",
      `📅 日時：${dateRangeStr}（日本時間）`,
      conf.text,
      ...(guestMessage ? [`\n💬 メッセージ：${guestMessage}`] : []),
      "",
      `予約詳細: ${detailUrl}`,
      FOOTER_TEXT,
    ].join("\n"),
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <h2 style="color:#B5384B;font-size:20px;margin-bottom:8px;">🗓️ 新しい予約が入りました</h2>
        <p style="color:#4A3E36;line-height:1.7;">${hostName}さん<br><br>
          <strong>${guestName}</strong>さん（${guestEmail}）から<br>
          「<strong>${displayTitle}</strong>」の予約が入りました。
        </p>
        <div style="background:#FAF5E8;border:2px solid #D4A03B;border-radius:16px;padding:20px;margin:16px 0;">
          <p style="font-size:18px;font-weight:bold;color:#1A1410;margin:0 0 12px;">📅 ${dateRangeStr}</p>
          ${conf.html}
          ${guestMessage ? `<p style="color:#4A3E36;margin:12px 0 0;">💬 ${guestMessage}</p>` : ""}
        </div>
        <p style="text-align:center;margin-top:16px;">
          <a href="${detailUrl}" style="display:inline-block;background:#B5384B;color:white;text-decoration:none;padding:12px 24px;border-radius:12px;font-weight:bold;">
            予約詳細を確認する
          </a>
        </p>
        ${FOOTER_HTML}
      </div>
    `,
  });
}

/** キャンセル通知メール（ゲスト・ホスト共通） */
export async function sendCancellationMail(opts: {
  to: string;
  recipientName: string;
  otherPartyName: string;
  displayTitle: string;
  startAtUtc: string;
  cancellationReason: string | null;
  apiKey: string;
  fromEmail?: string;
  isDev: boolean;
}): Promise<void> {
  const {
    to, recipientName, otherPartyName, displayTitle,
    startAtUtc, cancellationReason, apiKey, fromEmail, isDev,
  } = opts;

  if (isDev) {
    console.log(`[DEV] キャンセル通知メール → ${to}`);
    return;
  }

  const dateStr = formatDateJST(startAtUtc);
  const subject = `【キャンセル】${dateStr} のミーティングがキャンセルされました`;

  await sendMail({
    to, apiKey, fromEmail,
    subject,
    text: [
      `${recipientName}さん`,
      "",
      `${otherPartyName}さんとの「${displayTitle}」（${dateStr}）がキャンセルされました。`,
      ...(cancellationReason ? [`\n理由：${cancellationReason}`] : []),
      FOOTER_TEXT,
    ].join("\n"),
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <h2 style="color:#B5384B;font-size:20px;margin-bottom:8px;">❌ ミーティングがキャンセルされました</h2>
        <p style="color:#4A3E36;line-height:1.7;">${recipientName}さん<br><br>
          <strong>${otherPartyName}</strong>さんとの
          「<strong>${displayTitle}</strong>」がキャンセルされました。
        </p>
        <div style="background:#FAF5E8;border:2px solid #B5384B;border-radius:16px;padding:20px;margin:16px 0;">
          <p style="font-size:16px;color:#4A3E36;margin:0;">📅 ${dateStr}</p>
          ${cancellationReason ? `<p style="color:#6B5E50;margin:8px 0 0;">理由：${cancellationReason}</p>` : ""}
        </div>
        ${FOOTER_HTML}
      </div>
    `,
  });
}
