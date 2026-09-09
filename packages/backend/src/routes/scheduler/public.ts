// 公開予約エンドポイント（認証不要）
// GET  /api/scheduler/public/:memberSlug           → メタ情報取得
// GET  /api/scheduler/public/:memberSlug/slots     → 予約可能スロット
// POST /api/scheduler/public/:memberSlug/book      → 予約確定
// GET  /api/scheduler/public/booking/:token        → 予約詳細（キャンセル用）
// POST /api/scheduler/public/booking/:token/cancel → キャンセル

import { Hono } from "hono";
import { eq, and, gte, lt } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { newId, generateUrlSafeToken } from "../../services/auth.ts";
import { listEvents } from "../../services/googleClient.ts";
import { calculateSlots } from "../../services/slotCalculator.ts";
import { createConference, getValidGoogleAccessToken, getAvailableConferenceTypes } from "../../services/conferenceService.ts";
import { sendCancellationMail } from "../../services/schedulerMailer.ts";
import { MailService } from "../../services/mailer.ts";
import { deleteCalendarEvent } from "../../services/googleClient.ts";
import { getFrontendUrl } from "../../services/frontendUrl.ts";
import { cancelConfirmedBooking } from "../../services/bookingCancellation.ts";
import { resolveSettingsByShareToken } from "../../services/schedulerShareToken.ts";
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

// ---- GET /api/scheduler/public/:memberSlug ----
publicBookingRoutes.get("/:memberSlug", async (c) => {
  const { memberSlug } = c.req.param();
  const { oneOnOneId } = c.req.query();
  const db = createDb(c.env.DB);

  const resolved = await resolveSettingsByShareToken(db, memberSlug);
  if (resolved.status === "not_found") {
    return c.json({ error: { code: "not_found", message: "この予約ページは存在しないか、公開されていません" } }, 404);
  }
  if (resolved.status === "link_expired") {
    return c.json({ error: { code: "link_expired", message: "この予約ページの有効期限が切れています。共有した方に、新しいリンクの発行を依頼してください。" } }, 404);
  }
  const settings = resolved.settings;

  const member = await db
    .select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
    .from(schema.members)
    .where(eq(schema.members.id, settings.memberId))
    .get();

  if (!member) {
    return c.json({ error: { code: "not_found", message: "メンバーが見つかりません" } }, 404);
  }

  const availableConferenceTypes = await getAvailableConferenceTypes(db, settings.memberId);

  // この1to1申込がすでに予約確定済みなら、その内容を伝えて二重予約を防ぐ
  let existingBooking: { startAtUtc: string; endAtUtc: string; conferenceType: string; conferenceUrl: string | null } | null = null;
  // 1to1申込に紐づく正当なリンクであれば、相手（回答者）の登録名・メールを伝え、
  // 予約フォーム側で編集不可の表示として本人確定できるようにする
  let respondentName: string | null = null;
  let respondentEmail: string | null = null;
  // 通常申込時に申込者がこのリンク専用に指定したタイトル・所要時間（未指定ならページ全体の既定値を使う）
  let effectiveDisplayTitle = settings.displayTitle;
  let effectiveDurationMinutes = settings.durationMinutes;
  if (oneOnOneId) {
    const booking = await db
      .select({
        startAtUtc: schema.bookings.startAtUtc,
        endAtUtc: schema.bookings.endAtUtc,
        conferenceType: schema.bookings.conferenceType,
        conferenceUrl: schema.bookings.conferenceUrl,
      })
      .from(schema.bookings)
      .where(and(eq(schema.bookings.oneOnOneSessionId, oneOnOneId), eq(schema.bookings.status, "confirmed")))
      .get();
    if (booking) existingBooking = booking;

    const session = await db
      .select({
        requesterId: schema.oneOnOneSessions.requesterId,
        responderId: schema.oneOnOneSessions.responderId,
        status: schema.oneOnOneSessions.status,
        customTitle: schema.oneOnOneSessions.customTitle,
        customDurationMinutes: schema.oneOnOneSessions.customDurationMinutes,
      })
      .from(schema.oneOnOneSessions)
      .where(eq(schema.oneOnOneSessions.id, oneOnOneId))
      .get();
    if (session && (session.status === "pending" || session.status === "accepted") && session.requesterId === settings.memberId) {
      const responder = await db
        .select({ name: schema.members.name, email: schema.members.email })
        .from(schema.members)
        .where(eq(schema.members.id, session.responderId))
        .get();
      if (responder) {
        respondentName = responder.name;
        respondentEmail = responder.email;
      }
      if (session.customTitle) effectiveDisplayTitle = session.customTitle;
      if (session.customDurationMinutes) effectiveDurationMinutes = session.customDurationMinutes;
    }
  }

  return c.json({
    data: {
      memberSlug,
      memberId: member.id,
      memberName: member.name,
      memberEmoji: member.emoji,
      memberBgColor: member.bgColor,
      displayTitle: effectiveDisplayTitle,
      description: settings.description,
      durationMinutes: effectiveDurationMinutes,
      locationNote: settings.locationNote,
      availableConferenceTypes,
      existingBooking,
      respondentName,
      respondentEmail,
    },
  });
});

// ---- GET /api/scheduler/public/:memberSlug/slots ----
publicBookingRoutes.get("/:memberSlug/slots", async (c) => {
  const { memberSlug } = c.req.param();
  const { from, to, tz, oneOnOneId } = c.req.query();
  const timezone = tz ?? "Asia/Tokyo";
  const db = createDb(c.env.DB);

  const resolved = await resolveSettingsByShareToken(db, memberSlug);
  if (resolved.status === "not_found") {
    return c.json({ error: { code: "not_found", message: "予約ページが見つかりません" } }, 404);
  }
  if (resolved.status === "link_expired") {
    return c.json({ error: { code: "link_expired", message: "この予約ページの有効期限が切れています。共有した方に、新しいリンクの発行を依頼してください。" } }, 404);
  }
  const settings = resolved.settings;

  // 通常申込時に申込者がこのリンク専用に指定した所要時間があれば、ページ全体の既定値の代わりに使う
  let effectiveDurationMinutes = settings.durationMinutes;
  if (oneOnOneId) {
    const session = await db
      .select({ requesterId: schema.oneOnOneSessions.requesterId, customDurationMinutes: schema.oneOnOneSessions.customDurationMinutes })
      .from(schema.oneOnOneSessions)
      .where(eq(schema.oneOnOneSessions.id, oneOnOneId))
      .get();
    if (session && session.requesterId === settings.memberId && session.customDurationMinutes) {
      effectiveDurationMinutes = session.customDurationMinutes;
    }
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

  // Googleカレンダーの予定を取得（連携済みの場合）し、busy 区間に変換する。
  // freeBusy.query ではなく events.list を使うことで、「予定なし」（transparency: transparent）
  // に設定された予定も判定対象にできる（メンバーの設定次第で busy とみなす／みなさない）。
  let busy: { start: string; end: string }[] = [];
  const googleCred = await getValidGoogleAccessToken(
    db, settings.memberId,
    c.env.SCHEDULER_TOKEN_KEY,
    c.env.GOOGLE_OAUTH_CLIENT_ID,
    c.env.GOOGLE_OAUTH_CLIENT_SECRET
  );

  if (googleCred.status === "refresh_failed") {
    // 連携済みだがGoogle側の一時的な不調等でトークンを取得できなかったケース。
    // ここで busy=[] のまま処理を続けると、実際には埋まっている時間帯まで
    // 「空き」として案内してしまい二重予約の原因になるため、必ずエラーとして返す。
    console.error(`Google token refresh failed for member ${settings.memberId} (scheduler/public slots)`);
    return c.json({
      error: {
        code: "calendar_unavailable",
        message: "Googleカレンダーの予定を一時的に取得できませんでした。少し時間をおいてから、もう一度お試しください。",
      },
    }, 503);
  }

  if (googleCred.status === "ok") {
    try {
      const eventLists = await Promise.all(
        googleCred.busyCalendars.map((cal) =>
          listEvents(googleCred.accessToken, cal.id, fromDate.toISOString(), effectiveTo.toISOString())
        )
      );
      busy = eventLists.flat()
        .filter((ev) => {
          if (ev.allDay && !settings.blockAllDayEvents) return false;
          if (!ev.allDay && ev.transparency === "transparent" && !settings.treatFreeEventsAsBusy) return false;
          return true;
        })
        .map((ev) => ({ start: ev.startUtc, end: ev.endUtc }));
    } catch (e) {
      console.error(`Calendar events fetch failed for member ${settings.memberId}:`, e);
      // ここで busy=[] のまま処理を続けると、実際には埋まっている時間帯まで
      // 「空き」として案内してしまい二重予約の原因になるため、必ずエラーとして返す。
      return c.json({
        error: {
          code: "calendar_unavailable",
          message: "現在カレンダーの空き状況を確認できません。しばらく経ってからもう一度お試しください。",
        },
      }, 503);
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
    durationMinutes: effectiveDurationMinutes,
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
      durationMinutes: effectiveDurationMinutes,
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
    guestName?: string;
    guestEmail?: string;
    guestMessage?: string;
    guestCompany?: string;
    conferenceType?: "google_meet" | "zoom" | "manual";
    timezone?: string;
    oneOnOneSessionId?: string;
    // 汎用の公開予約URL（1to1申込に紐づかないリンク）から、同じ人がすでに確定済みの
    // 予約を持った状態で再度予約しようとした場合、まず何も指定せず問い合わせ、
    // ユーザーに「別件として追加する」か「既存のどれかを置き換える」かを選んでもらう
    // （無言でどちらかに決め打ちしない）。
    addAsNew?: boolean; // true: 既存の予約はそのままに、新しい予約を追加する
    replaceBookingId?: string; // 指定した既存予約をキャンセルしてから新しい予約を作る
  }>();

  if (!body.startUtc || !body.endUtc) {
    return c.json({ error: { code: "bad_request", message: "必須項目が不足しています" } }, 400);
  }

  const resolved = await resolveSettingsByShareToken(db, memberSlug);
  if (resolved.status === "not_found") {
    return c.json({ error: { code: "not_found", message: "予約ページが見つかりません" } }, 404);
  }
  if (resolved.status === "link_expired") {
    return c.json({ error: { code: "link_expired", message: "この予約ページの有効期限が切れています。共有した方に、新しいリンクの発行を依頼してください。" } }, 404);
  }
  const settings = resolved.settings;

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
  const cancellationToken = generateUrlSafeToken();
  const rescheduleToken = generateUrlSafeToken();
  const now = new Date().toISOString();
  const timezone = body.timezone ?? "Asia/Tokyo";
  const requestedType = body.conferenceType ?? "google_meet";
  const frontendUrl = getFrontendUrl(c.env);

  // 1to1申込からの予約なら、申込に記録されている「相手（回答者）」の登録情報を正として使う。
  // メール未ログインでリンクを開いた場合、外部ゲストと同様に名前・メールを手入力させると
  // 入力ミスや別アドレス使用によって本人と紐づかなくなるため、セッションIDから直接本人を特定する
  // （ホスト=申込者であることは必ず確認し、合致しなければ外部ゲストの入力にフォールバックする）
  let linkedOneOnOneId: string | null = null;
  let linkedOneOnOneWasPending = false;
  let linkedOneOnOneCustomTitle: string | null = null;
  let identifiedGuest: { id: string; name: string; email: string } | null = null;

  if (body.oneOnOneSessionId) {
    const session = await db
      .select({
        id: schema.oneOnOneSessions.id,
        requesterId: schema.oneOnOneSessions.requesterId,
        responderId: schema.oneOnOneSessions.responderId,
        status: schema.oneOnOneSessions.status,
        customTitle: schema.oneOnOneSessions.customTitle,
      })
      .from(schema.oneOnOneSessions)
      .where(eq(schema.oneOnOneSessions.id, body.oneOnOneSessionId))
      .get();

    if (
      session &&
      (session.status === "pending" || session.status === "accepted") &&
      session.requesterId === settings.memberId
    ) {
      const responder = await db
        .select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
        .from(schema.members)
        .where(eq(schema.members.id, session.responderId))
        .get();

      if (responder) {
        linkedOneOnOneId = session.id;
        linkedOneOnOneWasPending = session.status === "pending";
        linkedOneOnOneCustomTitle = session.customTitle;
        identifiedGuest = responder;

        // すでにこの1to1申込に対して確定済みの予約があれば、二重予約になるため拒否する
        const existingBooking = await db
          .select({ id: schema.bookings.id })
          .from(schema.bookings)
          .where(and(eq(schema.bookings.oneOnOneSessionId, linkedOneOnOneId), eq(schema.bookings.status, "confirmed")))
          .get();
        if (existingBooking) {
          return c.json({
            error: { code: "already_booked", message: "この1to1はすでに日程が確定しています。予約をやり直す場合は、一度予約をキャンセルしてください。" },
          }, 409);
        }
      }
    }
  }

  // 1to1申込に紐づかない場合は、外部ゲストとして名前・メールアドレスの入力を必須とする
  if (!identifiedGuest) {
    if (!body.guestName || !body.guestEmail) {
      return c.json({ error: { code: "bad_request", message: "必須項目が不足しています" } }, 400);
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(body.guestEmail)) {
      return c.json({ error: { code: "bad_request", message: "メールアドレスの形式が正しくありません" } }, 400);
    }
  }

  // ゲストがメンバーの場合は guestMemberId を設定（1to1申込に紐づく場合は上で特定済みの本人情報を優先する）
  const guestMemberRecord = identifiedGuest
    ? null
    : await db
        .select({ id: schema.members.id, name: schema.members.name })
        .from(schema.members)
        .where(eq(schema.members.email, body.guestEmail!))
        .get();

  const guestName = identifiedGuest?.name ?? body.guestName!;
  const guestEmail = identifiedGuest?.email ?? body.guestEmail!;
  const guestMemberId = identifiedGuest?.id ?? guestMemberRecord?.id ?? null;

  // 1to1申込に紐づかない、汎用の公開予約URL（マイページの「あなたの予約URL」等）から
  // 予約する場合、同じ人が別のタイミングで再度このURLから予約することがある。
  // 「日程を変更したい」場合と「別件でもう1つ予約を追加したい」場合の両方があり得るため、
  // 無言でどちらかに決め打ちせず、既存の予約一覧を提示してゲストに選んでもらう。
  // メンバーなら会員ID、外部ゲストならメールアドレスで本人を特定する。
  // （1to1申込ID経由のリンクは、申込ごとに個別の予約として扱いたいためこの対象外）
  if (!identifiedGuest && !body.addAsNew) {
    const existingConfirmed = await db
      .select()
      .from(schema.bookings)
      .where(
        and(
          eq(schema.bookings.hostMemberId, settings.memberId),
          eq(schema.bookings.status, "confirmed"),
          guestMemberId
            ? eq(schema.bookings.guestMemberId, guestMemberId)
            : eq(schema.bookings.guestEmail, guestEmail)
        )
      )
      .all();

    if (existingConfirmed.length > 0) {
      if (body.replaceBookingId) {
        const target = existingConfirmed.find((b) => b.id === body.replaceBookingId);
        if (!target) {
          return c.json({ error: { code: "bad_request", message: "指定された予約が見つかりません" } }, 400);
        }
        await cancelConfirmedBooking(db, c.env, target, {
          reason: "同じ方が別の日時で予約し直したため自動キャンセル",
          actorKind: "guest",
          actorId: guestMemberId,
        });
      } else {
        return c.json({
          error: {
            code: "existing_booking_found",
            message: existingConfirmed.length === 1
              ? `この予約ページからは既に ${formatBookingDateRange(existingConfirmed[0].startAtUtc, existingConfirmed[0].endAtUtc, timezone)} で予約を受け付けています。`
              : `この予約ページからは既に${existingConfirmed.length}件の予約を受け付けています。`,
          },
          data: {
            existingBookings: existingConfirmed.map((b) => ({ id: b.id, startAtUtc: b.startAtUtc, endAtUtc: b.endAtUtc })),
          },
        }, 409);
      }
    }
  }

  // 1to1申込に紐づく予約の場合、会議名が分かりやすいよう「申込者さんと相手さんの1to1」という形式にする
  // （ホスト側の予約ページ表示名や、ゲストがフォームに入力した名前だと「自分との1to1」のように見えてしまうため）
  const conferenceSummary = linkedOneOnOneId
    ? (linkedOneOnOneCustomTitle || `${member.name}さんと${guestName}さんの1to1`)
    : `${settings.displayTitle}（${guestName}）`;

  // 会議 URL 発行 + Calendar 登録
  const conferenceResult = await createConference({
    db,
    tokenKey: c.env.SCHEDULER_TOKEN_KEY,
    hostMemberId: settings.memberId,
    bookingId,
    requestedType,
    summary: conferenceSummary,
    description: [
      `ゲスト: ${guestName} <${guestEmail}>`,
      body.guestMessage ? `メッセージ: ${body.guestMessage}` : "",
    ].filter(Boolean).join("\n"),
    startAtUtc: body.startUtc,
    endAtUtc: body.endUtc,
    hostEmail: member.email,
    guestEmail,
    clientId: c.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: c.env.GOOGLE_OAUTH_CLIENT_SECRET,
    zoomClientId: c.env.ZOOM_CLIENT_ID,
    zoomClientSecret: c.env.ZOOM_CLIENT_SECRET,
  });

  await db.insert(schema.bookings).values({
    id: bookingId,
    hostMemberId: settings.memberId,
    guestMemberId,
    guestName,
    guestEmail,
    guestMessage: body.guestMessage ?? null,
    guestCompany: body.guestCompany?.trim() || null,
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
    oneOnOneSessionId: linkedOneOnOneId,
    source: "public",
    createdAt: now,
    updatedAt: now,
  });

  // 1to1申込に、確定した日時を反映する
  // 予約者（responder）が自ら日程を確定させた時点で、その行為自体が「承諾」を意味するため、
  // pendingのままだった場合はここで自動的に accepted へ遷移させる
  if (linkedOneOnOneId) {
    const nowSec = Math.floor(Date.now() / 1000);
    await db
      .update(schema.oneOnOneSessions)
      .set({
        scheduledFor: Math.floor(new Date(body.startUtc).getTime() / 1000),
        ...(linkedOneOnOneWasPending ? { status: "accepted", respondedAt: nowSec } : {}),
      })
      .where(eq(schema.oneOnOneSessions.id, linkedOneOnOneId));
  }

  // 監査ログ
  await db.insert(schema.bookingEvents).values({
    id: newId(),
    bookingId,
    eventType: "created",
    actorKind: "guest",
    actorId: null,
    payloadJson: JSON.stringify({ guestEmail }),
    occurredAt: now,
  });

  // メール送信用変数を準備
  const appTitleBook = (await db.select({ appTitle: schema.cardDesigns.appTitle }).from(schema.cardDesigns).get())?.appTitle ?? "白樺クエスト";
  const dateRange = formatBookingDateRange(body.startUtc, body.endUtc, timezone);
  const conferenceInfo = buildConferenceText(conferenceResult.conferenceType, conferenceResult.conferenceUrl);
  const cancellationUrl = `${frontendUrl}/book/confirmation/${cancellationToken}`;
  const bookingUrl = `${frontendUrl}/scheduler/bookings/${bookingId}`;
  const guestMessageBlock = body.guestMessage ? `💬 メッセージ：${body.guestMessage}` : "";
  const bookingDisplayTitle = linkedOneOnOneCustomTitle || settings.displayTitle;

  const mailerBook = new MailService(db, c.env);
  await Promise.allSettled([
    mailerBook.send("scheduler_booking_guest", guestEmail, {
      appTitle: appTitleBook,
      guestName,
      hostName: member.name,
      displayTitle: bookingDisplayTitle,
      dateRange,
      conferenceInfo,
      cancellationUrl,
    }),
    ...(member.email ? [mailerBook.send("scheduler_booking_host", member.email, {
      appTitle: appTitleBook,
      hostName: member.name,
      guestName,
      guestEmail,
      displayTitle: bookingDisplayTitle,
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

  // 1to1申込に紐づいていた予約なら、確定日時の表示をクリアする
  if (booking.oneOnOneSessionId) {
    await db
      .update(schema.oneOnOneSessions)
      .set({ scheduledFor: null })
      .where(eq(schema.oneOnOneSessions.id, booking.oneOnOneSessionId));
  }

  // Google Calendar から削除
  if (booking.hostCalendarEventId) {
    const googleCred = await getValidGoogleAccessToken(
      db, booking.hostMemberId,
      c.env.SCHEDULER_TOKEN_KEY,
      c.env.GOOGLE_OAUTH_CLIENT_ID,
      c.env.GOOGLE_OAUTH_CLIENT_SECRET
    );
    if (googleCred.status === "ok") {
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
