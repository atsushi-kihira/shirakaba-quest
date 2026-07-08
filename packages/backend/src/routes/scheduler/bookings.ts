// ホスト用予約管理ルート（認証必須）
// GET  /api/scheduler/bookings          → 自分の予約一覧
// GET  /api/scheduler/bookings/:id      → 予約詳細
// POST /api/scheduler/bookings/:id/cancel → ホストからキャンセル

import { Hono } from "hono";
import { eq, and, gte, lte, desc, or } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { newId } from "../../services/auth.ts";
import { getValidGoogleAccessToken } from "../../services/conferenceService.ts";
import { deleteCalendarEvent } from "../../services/googleClient.ts";
import { sendCancellationMail } from "../../services/schedulerMailer.ts";
import type { Env, Variables } from "../../types.ts";

export const schedulerBookingsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- GET /api/scheduler/bookings/upcoming ----
// ホストとしてもゲストとしても参加する直近の確定済み予約を返す
schedulerBookingsRoutes.get("/upcoming", async (c) => {
  const memberId = c.get("userId");
  const db = createDb(c.env.DB);

  const me = await db
    .select({ email: schema.members.email, name: schema.members.name })
    .from(schema.members)
    .where(eq(schema.members.id, memberId))
    .get();

  const nowStr = new Date().toISOString();

  // ホストとして入った予約 + ゲストとして入った予約（メールで照合）
  const bookings = await db
    .select()
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.status, "confirmed"),
        gte(schema.bookings.startAtUtc, nowStr),
        or(
          eq(schema.bookings.hostMemberId, memberId),
          ...(me?.email ? [eq(schema.bookings.guestEmail, me.email)] : []),
        )
      )
    )
    .orderBy(schema.bookings.startAtUtc)
    .limit(10)
    .all();

  // ホスト情報を付加
  const hostIds = [...new Set(bookings.map((b) => b.hostMemberId))];
  const hosts = hostIds.length > 0
    ? await db
        .select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji })
        .from(schema.members)
        .where(or(...hostIds.map((id) => eq(schema.members.id, id))))
        .all()
    : [];
  const hostMap = new Map(hosts.map((h) => [h.id, h]));

  const result = bookings.map((b) => ({
    id: b.id,
    startAtUtc: b.startAtUtc,
    endAtUtc: b.endAtUtc,
    conferenceType: b.conferenceType,
    conferenceUrl: b.conferenceUrl,
    cancellationToken: b.cancellationToken,
    isHost: b.hostMemberId === memberId,
    guestName: b.guestName,
    host: hostMap.get(b.hostMemberId) ?? null,
    displayTitle: null as string | null,
  }));

  // スケジューラー設定からタイトル取得
  const settingsRows = hostIds.length > 0
    ? await db
        .select({ memberId: schema.memberSchedulingSettings.memberId, displayTitle: schema.memberSchedulingSettings.displayTitle })
        .from(schema.memberSchedulingSettings)
        .where(or(...hostIds.map((id) => eq(schema.memberSchedulingSettings.memberId, id))))
        .all()
    : [];
  const settingsMap = new Map(settingsRows.map((s) => [s.memberId, s.displayTitle]));
  for (const r of result) {
    r.displayTitle = settingsMap.get(bookings.find((b) => b.id === r.id)!.hostMemberId) ?? null;
  }

  return c.json({ data: result });
});

// ---- GET /api/scheduler/bookings ----
schedulerBookingsRoutes.get("/", async (c) => {
  const memberId = c.get("userId");
  const db = createDb(c.env.DB);
  const { from, to, status } = c.req.query();

  const conditions = [eq(schema.bookings.hostMemberId, memberId)];
  if (from) conditions.push(gte(schema.bookings.startAtUtc, from));
  if (to) conditions.push(lte(schema.bookings.startAtUtc, to));
  if (status) conditions.push(eq(schema.bookings.status, status));

  const bookings = await db
    .select()
    .from(schema.bookings)
    .where(and(...conditions))
    .orderBy(desc(schema.bookings.startAtUtc))
    .all();

  // ゲストメールアドレスをマスク
  const masked = bookings.map((b) => ({
    ...b,
    guestEmail: maskEmail(b.guestEmail),
  }));

  return c.json({ data: masked });
});

// ---- GET /api/scheduler/bookings/:id ----
schedulerBookingsRoutes.get("/:id", async (c) => {
  const memberId = c.get("userId");
  const bookingId = c.req.param("id");
  const db = createDb(c.env.DB);

  const booking = await db
    .select()
    .from(schema.bookings)
    .where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.hostMemberId, memberId)))
    .get();

  if (!booking) {
    return c.json({ error: { code: "not_found", message: "予約が見つかりません" } }, 404);
  }

  const events = await db
    .select()
    .from(schema.bookingEvents)
    .where(eq(schema.bookingEvents.bookingId, bookingId))
    .all();

  return c.json({ data: { ...booking, events } });
});

// ---- POST /api/scheduler/bookings/:id/cancel ----
schedulerBookingsRoutes.post("/:id/cancel", async (c) => {
  const memberId = c.get("userId");
  const bookingId = c.req.param("id");
  const db = createDb(c.env.DB);
  const body: { reason?: string } = await c.req.json<{ reason?: string }>().catch(() => ({}));

  const booking = await db
    .select()
    .from(schema.bookings)
    .where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.hostMemberId, memberId)))
    .get();

  if (!booking) {
    return c.json({ error: { code: "not_found", message: "予約が見つかりません" } }, 404);
  }

  if (booking.status !== "confirmed") {
    return c.json({ error: { code: "already_cancelled", message: "この予約は既にキャンセル済みです" } }, 409);
  }

  const now = new Date().toISOString();
  await db
    .update(schema.bookings)
    .set({ status: "cancelled", cancellationReason: body.reason ?? null, updatedAt: now })
    .where(eq(schema.bookings.id, bookingId));

  // Google Calendar から削除
  if (booking.hostCalendarEventId) {
    const googleCred = await getValidGoogleAccessToken(
      db, memberId,
      c.env.SCHEDULER_TOKEN_KEY,
      c.env.GOOGLE_OAUTH_CLIENT_ID,
      c.env.GOOGLE_OAUTH_CLIENT_SECRET
    );
    if (googleCred) {
      await deleteCalendarEvent(googleCred.accessToken, googleCred.calendarId, booking.hostCalendarEventId).catch(() => {});
    }
  }

  await db.insert(schema.bookingEvents).values({
    id: newId(),
    bookingId,
    eventType: "cancelled",
    actorKind: "host",
    actorId: memberId,
    payloadJson: JSON.stringify({ reason: body.reason }),
    occurredAt: now,
  });

  const host = await db
    .select({ name: schema.members.name, email: schema.members.email })
    .from(schema.members)
    .where(eq(schema.members.id, memberId))
    .get();

  const settings = await db
    .select({ displayTitle: schema.memberSchedulingSettings.displayTitle })
    .from(schema.memberSchedulingSettings)
    .where(eq(schema.memberSchedulingSettings.memberId, memberId))
    .get();

  const isDev = c.env.ENVIRONMENT === "development";
  const displayTitle = settings?.displayTitle ?? "1on1 ミーティング";

  await Promise.allSettled([
    sendCancellationMail({
      to: booking.guestEmail,
      recipientName: booking.guestName,
      otherPartyName: host?.name ?? "",
      displayTitle,
      startAtUtc: booking.startAtUtc,
      cancellationReason: body.reason ?? null,
      apiKey: c.env.SENDGRID_API_KEY,
      fromEmail: c.env.SENDGRID_FROM_EMAIL,
      isDev,
    }),
    host ? sendCancellationMail({
      to: host.email,
      recipientName: host.name,
      otherPartyName: booking.guestName,
      displayTitle,
      startAtUtc: booking.startAtUtc,
      cancellationReason: body.reason ?? null,
      apiKey: c.env.SENDGRID_API_KEY,
      fromEmail: c.env.SENDGRID_FROM_EMAIL,
      isDev,
    }) : Promise.resolve(),
  ]);

  return c.json({ data: { cancelled: true } });
});

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const masked = local.length > 2
    ? `${local[0]}${"*".repeat(local.length - 2)}${local[local.length - 1]}`
    : `${local[0]}*`;
  return `${masked}@${domain}`;
}
