// =============================================================
// 確定した日時（公開予約ページのスロット選択・候補日提示への回答のいずれから来ても）を
// 実際の bookings 行として記録する共通処理。
// scheduler/public.ts の POST /:memberSlug/book と、外部ゲスト招待の候補日選択の
// 両方から呼ばれる（会議URL発行・監査ログ・確認メール送信のロジックを重複させないため）。
// =============================================================
import { createDb, schema } from "../db/index.ts";
import { newId, generateUrlSafeToken } from "./auth.ts";
import { createConference } from "./conferenceService.ts";
import { MailService } from "./mailer.ts";
import { getFrontendUrl } from "./frontendUrl.ts";
import type { Env } from "../types.ts";

type Db = ReturnType<typeof createDb>;

export function formatBookingDateRange(startUtc: string, endUtc: string, tz = "Asia/Tokyo"): string {
  const fmt = new Intl.DateTimeFormat("ja-JP", {
    timeZone: tz,
    year: "numeric", month: "long", day: "numeric",
    weekday: "short", hour: "2-digit", minute: "2-digit",
  });
  const startStr = fmt.format(new Date(startUtc));
  const endTime = new Intl.DateTimeFormat("ja-JP", {
    timeZone: tz, hour: "2-digit", minute: "2-digit",
  }).format(new Date(endUtc));
  return `${startStr}〜${endTime}`;
}

export function buildConferenceText(conferenceType: string, conferenceUrl: string | null): string {
  if (conferenceType === "google_meet" && conferenceUrl) return `📹 Google Meet: ${conferenceUrl}`;
  if (conferenceType === "zoom" && conferenceUrl) return `📹 Zoom: ${conferenceUrl}`;
  return "📹 会議URLは主催者から別途ご連絡します。";
}

export type CreateBookingForConfirmedSlotArgs = {
  db: Db;
  env: Env;
  hostMemberId: string;
  hostName: string;
  hostEmail: string;
  guestMemberId?: string | null;
  guestName: string;
  guestEmail: string;
  guestMessage?: string | null;
  guestCompany?: string | null;
  startAtUtc: string;
  endAtUtc: string;
  timezone: string;
  requestedConferenceType: "google_meet" | "zoom" | "manual";
  conferenceSummary: string;
  displayTitle: string;
  oneOnOneSessionId?: string | null;
  guestInviteId?: string | null;
  source: "public" | "guest_invite";
};

export type CreateBookingForConfirmedSlotResult = {
  bookingId: string;
  cancellationToken: string;
  conferenceType: string;
  conferenceUrl: string | null;
};

export async function createBookingForConfirmedSlot(args: CreateBookingForConfirmedSlotArgs): Promise<CreateBookingForConfirmedSlotResult> {
  const { db, env } = args;
  const bookingId = newId();
  const cancellationToken = generateUrlSafeToken();
  const rescheduleToken = generateUrlSafeToken();
  const now = new Date().toISOString();

  const conferenceResult = await createConference({
    db,
    tokenKey: env.SCHEDULER_TOKEN_KEY,
    hostMemberId: args.hostMemberId,
    bookingId,
    requestedType: args.requestedConferenceType,
    summary: args.conferenceSummary,
    description: [
      `ゲスト: ${args.guestName} <${args.guestEmail}>`,
      args.guestMessage ? `メッセージ: ${args.guestMessage}` : "",
    ].filter(Boolean).join("\n"),
    startAtUtc: args.startAtUtc,
    endAtUtc: args.endAtUtc,
    hostEmail: args.hostEmail,
    guestEmail: args.guestEmail,
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    zoomClientId: env.ZOOM_CLIENT_ID,
    zoomClientSecret: env.ZOOM_CLIENT_SECRET,
  });

  await db.insert(schema.bookings).values({
    id: bookingId,
    hostMemberId: args.hostMemberId,
    guestMemberId: args.guestMemberId ?? null,
    guestName: args.guestName,
    guestEmail: args.guestEmail,
    guestMessage: args.guestMessage ?? null,
    guestCompany: args.guestCompany?.trim() || null,
    startAtUtc: args.startAtUtc,
    endAtUtc: args.endAtUtc,
    timezone: args.timezone,
    status: "confirmed",
    cancellationReason: null,
    cancellationToken,
    rescheduleToken,
    hostCalendarEventId: conferenceResult.calendarEventId,
    conferenceType: conferenceResult.conferenceType,
    conferenceUrl: conferenceResult.conferenceUrl,
    conferenceMetaJson: conferenceResult.conferenceMetaJson,
    conferenceUrlStatus: conferenceResult.urlStatus === "unresolved" ? "unresolved" : null,
    oneOnOneSessionId: args.oneOnOneSessionId ?? null,
    guestInviteId: args.guestInviteId ?? null,
    source: args.source,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.bookingEvents).values({
    id: newId(),
    bookingId,
    eventType: "created",
    actorKind: "guest",
    actorId: null,
    payloadJson: JSON.stringify({ guestEmail: args.guestEmail }),
    occurredAt: now,
  });

  const appTitle = (await db.select({ appTitle: schema.cardDesigns.appTitle }).from(schema.cardDesigns).get())?.appTitle ?? "白樺クエスト";
  const dateRange = formatBookingDateRange(args.startAtUtc, args.endAtUtc, args.timezone);
  const conferenceInfo = buildConferenceText(conferenceResult.conferenceType, conferenceResult.conferenceUrl);
  const frontendUrl = getFrontendUrl(env);
  const cancellationUrl = `${frontendUrl}/book/confirmation/${cancellationToken}`;
  const bookingUrl = `${frontendUrl}/scheduler/bookings/${bookingId}`;
  const guestMessageBlock = args.guestMessage ? `💬 メッセージ：${args.guestMessage}` : "";

  const mailer = new MailService(db, env);
  await Promise.allSettled([
    mailer.send("scheduler_booking_guest", args.guestEmail, {
      appTitle,
      guestName: args.guestName,
      hostName: args.hostName,
      displayTitle: args.displayTitle,
      dateRange,
      conferenceInfo,
      cancellationUrl,
    }),
    args.hostEmail ? mailer.send("scheduler_booking_host", args.hostEmail, {
      appTitle,
      hostName: args.hostName,
      guestName: args.guestName,
      guestEmail: args.guestEmail,
      displayTitle: args.displayTitle,
      dateRange,
      conferenceInfo,
      guestMessageBlock,
      bookingUrl,
    }) : Promise.resolve(),
  ]);

  return {
    bookingId,
    cancellationToken,
    conferenceType: conferenceResult.conferenceType,
    conferenceUrl: conferenceResult.conferenceUrl,
  };
}
