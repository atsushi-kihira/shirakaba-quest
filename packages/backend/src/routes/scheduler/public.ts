// 公開予約エンドポイント（認証不要）
// GET  /api/scheduler/public/:memberSlug           → メタ情報取得
// GET  /api/scheduler/public/:memberSlug/slots     → 予約可能スロット
// POST /api/scheduler/public/:memberSlug/book      → 予約確定
// GET  /api/scheduler/public/booking/:token        → 予約詳細（キャンセル用）
// POST /api/scheduler/public/booking/:token/cancel → キャンセル

import { Hono } from "hono";
import { eq, and, gte, lt } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { newId } from "../../services/auth.ts";
import { fetchBusy } from "../../services/googleClient.ts";
import { calculateSlots } from "../../services/slotCalculator.ts";
import { createConference, getValidGoogleAccessToken, getAvailableConferenceTypes } from "../../services/conferenceService.ts";
import { sendCancellationMail } from "../../services/schedulerMailer.ts";
import { MailService } from "../../services/mailer.ts";
import { deleteCalendarEvent } from "../../services/googleClient.ts";
import { getFrontendUrl } from "../../services/frontendUrl.ts";
import type { Env, Variables } from "../../types.ts";

export const publicBookingRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function formatBookingDateRange(startUtc: string, endUtc: string, tz = "Asia/Tokyo"): string {
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

function buildConferenceText(conferenceType: string, conferenceUrl: string | null): string {
  if (conferenceType === "google_meet" && conferenceUrl) {
    return `📹 Google Meet: ${conferenceUrl}`;
  }
  if (conferenceType === "zoom" && conferenceUrl) {
    return `📹 Zoom: ${conferenceUrl}`;
  }
  return "📹 会議URLは主催者から別途ご連絡します。";
}

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ---- GET /api/scheduler/public/:memberSlug ----
publicBookingRoutes.get("/:memberSlug", async (c) => {
  const { memberSlug } = c.req.param();
  const db = createDb(c.env.DB);

  const settings = await db
    .select()
    .from(schema.memberSchedulingSettings)
    .where(eq(schema.memberSchedulingSettings.slug, memberSlug))
    .get();

  if (!settings || !settings.isPublic) {
    return c.json({ error: { code: "not_found", message: "この予約ページは存在しないか、公開されていません" } }, 404);
  }

  const member = await db
    .select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
    .from(schema.members)
    .where(eq(schema.members.id, settings.memberId))
    .get();

  if (!member) {
    return c.json({ error: { code: "not_found", message: "メンバーが見つかりません" } }, 404);
  }

  const availableConferenceTypes = await getAvailableConferenceTypes(db, settings.memberId);

  return c.json({
    data: {
      memberSlug,
      memberId: member.id,
      memberName: member.name,
      memberEmoji: member.emoji,
      memberBgColor: member.bgColor,
      displayTitle: settings.displayTitle,
      description: settings.description,
      durationMinutes: settings.durationMinutes,
      locationNote: settings.locationNote,
      availableConferenceTypes,
    },
  });
});

// ---- GET /api/scheduler/public/:memberSlug/slots ----
publicBookingRoutes.get("/:memberSlug/slots", async (c) => {
  const { memberSlug } = c.req.param();
  const { from, to, tz } = c.req.query();
  const timezone = tz ?? "Asia/Tokyo";
  const db = createDb(c.env.DB);

  const settings = await db
    .select()
    .from(schema.memberSchedulingSettings)
    .where(eq(schema.memberSchedulingSettings.slug, memberSlug))
    .get();

  if (!settings || !settings.isPublic) {
    return c.json({ error: { code: "not_found", message: "予約ページが見つかりません" } }, 404);
  }

  // 日付範囲のデフォルト: 今から maxAdvanceDays 日後まで、最大 7 日
  const fromDate = from ? new Date(`${from}T00:00:00Z`) : new Date();
  const toDate = to
    ? new Date(`${to}T23:59:59Z`)
    : new Date(fromDate.getTime() + 7 * 86400_000);

  // maxAdvanceDays 制限
  const maxTo = new Date(Date.now() + settings.maxAdvanceDays * 86400_000);
  const effectiveTo = toDate < maxTo ? toDate : maxTo;

  // 曜日ルールと例外を取得
  const rules = await db
    .select()
    .from(schema.availabilityRules)
    .where(eq(schema.availabilityRules.memberId, settings.memberId))
    .all();

  const overrides = await db
    .select()
    .from(schema.availabilityOverrides)
    .where(eq(schema.availabilityOverrides.memberId, settings.memberId))
    .all();

  // Google FreeBusy 取得（連携済みの場合）
  let busy: { start: string; end: string }[] = [];
  const googleCred = await getValidGoogleAccessToken(
    db, settings.memberId,
    c.env.SCHEDULER_TOKEN_KEY,
    c.env.GOOGLE_OAUTH_CLIENT_ID,
    c.env.GOOGLE_OAUTH_CLIENT_SECRET
  );

  if (googleCred) {
    try {
      busy = await fetchBusy(
        googleCred.accessToken,
        googleCred.calendarId,
        fromDate.toISOString(),
        effectiveTo.toISOString()
      );
    } catch (e) {
      console.error("FreeBusy fetch failed:", e);
    }
  }

  // 確定済み予約を busy に追加（Google 連携がない場合も考慮）
  const confirmedBookings = await db
    .select({ startAtUtc: schema.bookings.startAtUtc, endAtUtc: schema.bookings.endAtUtc })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.hostMemberId, settings.memberId),
        eq(schema.bookings.status, "confirmed"),
        gte(schema.bookings.startAtUtc, fromDate.toISOString()),
        lt(schema.bookings.startAtUtc, effectiveTo.toISOString())
      )
    )
    .all();

  for (const b of confirmedBookings) {
    busy.push({ start: b.startAtUtc, end: b.endAtUtc });
  }

  // 日別の既存予約数を集計
  const existingBookingsPerDay = new Map<string, number>();
  for (const b of confirmedBookings) {
    const dateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(b.startAtUtc));
    existingBookingsPerDay.set(dateStr, (existingBookingsPerDay.get(dateStr) ?? 0) + 1);
  }

  const slots = calculateSlots({
    rules: rules.map((r) => ({
      dayOfWeek: r.dayOfWeek,
      startTimeLocal: r.startTimeLocal,
      endTimeLocal: r.endTimeLocal,
      timezone: r.timezone,
    })),
    overrides: overrides.map((o) => ({
      dateLocal: o.dateLocal,
      isBlocked: o.isBlocked === 1,
      startTimeLocal: o.startTimeLocal,
      endTimeLocal: o.endTimeLocal,
    })),
    busy,
    durationMinutes: settings.durationMinutes,
    slotIntervalMinutes: settings.slotIntervalMinutes,
    bufferBeforeMinutes: settings.bufferBeforeMinutes,
    bufferAfterMinutes: settings.bufferAfterMinutes,
    minNoticeMinutes: settings.minNoticeMinutes,
    fromUtc: fromDate,
    toUtc: effectiveTo,
    timezone,
    dailyMax: settings.dailyMaxBookings ?? undefined,
    existingBookingsPerDay,
  });

  // businessHours: 曜日別ルールの概要（カレンダーグリッドの背景表示用）
  const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const businessHours: Record<string, { start: string; end: string }> = {};
  for (const rule of rules) {
    const key = DOW[rule.dayOfWeek];
    if (key) businessHours[key] = { start: rule.startTimeLocal, end: rule.endTimeLocal };
  }

  const availableConferenceTypes = await getAvailableConferenceTypes(db, settings.memberId);

  return c.json({
    data: {
      memberSlug,
      displayTitle: settings.displayTitle,
      durationMinutes: settings.durationMinutes,
      timezone,
      availableSlots: slots,
      businessHours,
      availableConferenceTypes,
    },
  });
});

// ---- POST /api/scheduler/public/:memberSlug/book ----
publicBookingRoutes.post("/:memberSlug/book", async (c) => {
  const { memberSlug } = c.req.param();
  const db = createDb(c.env.DB);
  const body = await c.req.json<{
    startUtc: string;
    endUtc: string;
    guestName: string;
    guestEmail: string;
    guestMessage?: string;
    conferenceType?: "google_meet" | "zoom" | "manual";
    timezone?: string;
  }>();

  if (!body.startUtc || !body.endUtc || !body.guestName || !body.guestEmail) {
    return c.json({ error: { code: "bad_request", message: "必須項目が不足しています" } }, 400);
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(body.guestEmail)) {
    return c.json({ error: { code: "bad_request", message: "メールアドレスの形式が正しくありません" } }, 400);
  }

  const settings = await db
    .select()
    .from(schema.memberSchedulingSettings)
    .where(eq(schema.memberSchedulingSettings.slug, memberSlug))
    .get();

  if (!settings || !settings.isPublic) {
    return c.json({ error: { code: "not_found", message: "予約ページが見つかりません" } }, 404);
  }

  // スロットの重複チェック
  const overlapping = await db
    .select({ id: schema.bookings.id })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.hostMemberId, settings.memberId),
        eq(schema.bookings.status, "confirmed"),
        lt(schema.bookings.startAtUtc, body.endUtc),
        gte(schema.bookings.endAtUtc, body.startUtc)
      )
    )
    .get();

  if (overlapping) {
    return c.json({ error: { code: "slot_taken", message: "その時間帯は既に予約されています。別の時間を選んでください。" } }, 409);
  }

  const member = await db
    .select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
    .from(schema.members)
    .where(eq(schema.members.id, settings.memberId))
    .get();

  if (!member) {
    return c.json({ error: { code: "not_found", message: "ホストが見つかりません" } }, 404);
  }

  const bookingId = newId();
  const cancellationToken = generateToken();
  const rescheduleToken = generateToken();
  const now = new Date().toISOString();
  const timezone = body.timezone ?? "Asia/Tokyo";
  const requestedType = body.conferenceType ?? "google_meet";
  const frontendUrl = getFrontendUrl(c.env);

  // ゲストがメンバーの場合は guestMemberId を設定
  const guestMemberRecord = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(eq(schema.members.email, body.guestEmail))
    .get();
  const guestMemberId = guestMemberRecord?.id ?? null;

  // 会議 URL 発行 + Calendar 登録
  const conferenceResult = await createConference({
    db,
    tokenKey: c.env.SCHEDULER_TOKEN_KEY,
    hostMemberId: settings.memberId,
    bookingId,
    requestedType,
    summary: `${settings.displayTitle}（${body.guestName}）`,
    description: [
      `ゲスト: ${body.guestName} <${body.guestEmail}>`,
      body.guestMessage ? `メッセージ: ${body.guestMessage}` : "",
    ].filter(Boolean).join("\n"),
    startAtUtc: body.startUtc,
    endAtUtc: body.endUtc,
    hostEmail: member.email,
    guestEmail: body.guestEmail,
    clientId: c.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: c.env.GOOGLE_OAUTH_CLIENT_SECRET,
    zoomClientId: c.env.ZOOM_CLIENT_ID,
    zoomClientSecret: c.env.ZOOM_CLIENT_SECRET,
  });

  await db.insert(schema.bookings).values({
    id: bookingId,
    hostMemberId: settings.memberId,
    guestMemberId,
    guestName: body.guestName,
    guestEmail: body.guestEmail,
    guestMessage: body.guestMessage ?? null,
    startAtUtc: body.startUtc,
    endAtUtc: body.endUtc,
    timezone,
    status: "confirmed",
    cancellationReason: null,
    cancellationToken,
    rescheduleToken,
    hostCalendarEventId: conferenceResult.calendarEventId,
    conferenceType: conferenceResult.conferenceType,
    conferenceUrl: conferenceResult.conferenceUrl,
    conferenceMetaJson: conferenceResult.conferenceMetaJson,
    oneOnOneSessionId: null,
    source: "public",
    createdAt: now,
    updatedAt: now,
  });

  // 監査ログ
  await db.insert(schema.bookingEvents).values({
    id: newId(),
    bookingId,
    eventType: "created",
    actorKind: "guest",
    actorId: null,
    payloadJson: JSON.stringify({ guestEmail: body.guestEmail }),
    occurredAt: now,
  });

  // メール送信用変数を準備
  const appTitleBook = (await db.select({ appTitle: schema.cardDesigns.appTitle }).from(schema.cardDesigns).get())?.appTitle ?? "白樺クエスト";
  const dateRange = formatBookingDateRange(body.startUtc, body.endUtc, timezone);
  const conferenceInfo = buildConferenceText(conferenceResult.conferenceType, conferenceResult.conferenceUrl);
  const cancellationUrl = `${frontendUrl}/book/confirmation/${cancellationToken}`;
  const bookingUrl = `${frontendUrl}/scheduler/bookings/${bookingId}`;
  const guestMessageBlock = body.guestMessage ? `💬 メッセージ：${body.guestMessage}` : "";

  const mailerBook = new MailService(db, c.env);
  await Promise.allSettled([
    mailerBook.send("scheduler_booking_guest", body.guestEmail, {
      appTitle: appTitleBook,
      guestName: body.guestName,
      hostName: member.name,
      displayTitle: settings.displayTitle,
      dateRange,
      conferenceInfo,
      cancellationUrl,
    }),
    ...(member.email ? [mailerBook.send("scheduler_booking_host", member.email, {
      appTitle: appTitleBook,
      hostName: member.name,
      guestName: body.guestName,
      guestEmail: body.guestEmail,
      displayTitle: settings.displayTitle,
      dateRange,
      conferenceInfo,
      guestMessageBlock,
      bookingUrl,
    })] : []),
  ]);

  return c.json({
    data: {
      bookingId,
      cancellationToken,
      conferenceType: conferenceResult.conferenceType,
      conferenceUrl: conferenceResult.conferenceUrl,
      startAtUtc: body.startUtc,
      endAtUtc: body.endUtc,
    },
  }, 201);
});

// ---- GET /api/scheduler/public/booking/:token ----
publicBookingRoutes.get("/booking/:token", async (c) => {
  const { token } = c.req.param();
  const db = createDb(c.env.DB);

  const booking = await db
    .select()
    .from(schema.bookings)
    .where(eq(schema.bookings.cancellationToken, token))
    .get();

  if (!booking) {
    return c.json({ error: { code: "not_found", message: "予約が見つかりません" } }, 404);
  }

  // ホスト情報
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

  return c.json({
    data: {
      bookingId: booking.id,
      status: booking.status,
      guestName: booking.guestName,
      guestEmail: booking.guestEmail,
      guestMessage: booking.guestMessage,
      startAtUtc: booking.startAtUtc,
      endAtUtc: booking.endAtUtc,
      timezone: booking.timezone,
      conferenceType: booking.conferenceType,
      conferenceUrl: booking.conferenceUrl,
      hostName: host?.name ?? "",
      displayTitle: settings?.displayTitle ?? "1on1 ミーティング",
      cancellationReason: booking.cancellationReason,
    },
  });
});

// ---- POST /api/scheduler/public/booking/:token/cancel ----
publicBookingRoutes.post("/booking/:token/cancel", async (c) => {
  const { token } = c.req.param();
  const db = createDb(c.env.DB);
  const body: { reason?: string } = await c.req.json<{ reason?: string }>().catch(() => ({}));

  const booking = await db
    .select()
    .from(schema.bookings)
    .where(eq(schema.bookings.cancellationToken, token))
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
    .where(eq(schema.bookings.id, booking.id));

  // Google Calendar から削除
  if (booking.hostCalendarEventId) {
    const googleCred = await getValidGoogleAccessToken(
      db, booking.hostMemberId,
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
    bookingId: booking.id,
    eventType: "cancelled",
    actorKind: "guest",
    actorId: null,
    payloadJson: JSON.stringify({ reason: body.reason }),
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
