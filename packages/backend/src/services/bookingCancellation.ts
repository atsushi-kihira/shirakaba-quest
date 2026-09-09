// =============================================================
// 予約（bookings）のキャンセル処理を共通化するサービス
// scheduler/bookings.ts（ホストのキャンセル操作）と
// oneonone.ts（1to1のキャンセル/辞退に連動した自動キャンセル）の両方から利用する
// =============================================================
import { eq } from "drizzle-orm";
import { schema } from "../db/index.ts";
import type { Db } from "../db/index.ts";
import { newId } from "./auth.ts";
import { getValidGoogleAccessToken } from "./conferenceService.ts";
import { deleteCalendarEvent } from "./googleClient.ts";
import { sendCancellationMail } from "./schedulerMailer.ts";
import type { Env } from "../types.ts";

type BookingRow = typeof schema.bookings.$inferSelect;

export async function cancelConfirmedBooking(
  db: Db,
  env: Env,
  booking: BookingRow,
  options: { reason?: string | null; actorKind: string; actorId: string | null }
): Promise<void> {
  if (booking.status !== "confirmed") return;

  const now = new Date().toISOString();
  await db
    .update(schema.bookings)
    .set({ status: "cancelled", cancellationReason: options.reason ?? null, updatedAt: now })
    .where(eq(schema.bookings.id, booking.id));

  // Google Calendar から削除
  if (booking.hostCalendarEventId) {
    const googleCred = await getValidGoogleAccessToken(
      db, booking.hostMemberId, env.SCHEDULER_TOKEN_KEY,
      env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET
    );
    if (googleCred.status === "ok") {
      await deleteCalendarEvent(googleCred.accessToken, googleCred.calendarId, booking.hostCalendarEventId).catch(() => {});
    }
  }

  await db.insert(schema.bookingEvents).values({
    id: newId(),
    bookingId: booking.id,
    eventType: "cancelled",
    actorKind: options.actorKind,
    actorId: options.actorId,
    payloadJson: JSON.stringify({ reason: options.reason ?? null }),
    occurredAt: now,
  });

  const host = await db
    .select({ name: schema.members.name, email: schema.members.email })
    .from(schema.members)
    .where(eq(schema.members.id, booking.hostMemberId))
    .get();

  const settings = await db
    .select({ displayTitle: schema.memberSchedulingSettings.displayTitle })
    .from(schema.memberSchedulingSettings)
    .where(eq(schema.memberSchedulingSettings.memberId, booking.hostMemberId))
    .get();

  const isDev = env.ENVIRONMENT === "development";
  const displayTitle = settings?.displayTitle ?? "1on1 ミーティング";

  await Promise.allSettled([
    sendCancellationMail({
      to: booking.guestEmail,
      recipientName: booking.guestName,
      otherPartyName: host?.name ?? "",
      displayTitle,
      startAtUtc: booking.startAtUtc,
      cancellationReason: options.reason ?? null,
      apiKey: env.SENDGRID_API_KEY,
      fromEmail: env.SENDGRID_FROM_EMAIL,
      isDev,
    }),
    host
      ? sendCancellationMail({
          to: host.email,
          recipientName: host.name,
          otherPartyName: booking.guestName,
          displayTitle,
          startAtUtc: booking.startAtUtc,
          cancellationReason: options.reason ?? null,
          apiKey: env.SENDGRID_API_KEY,
          fromEmail: env.SENDGRID_FROM_EMAIL,
          isDev,
        })
      : Promise.resolve(),
  ]);
}
