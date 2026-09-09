// 自分の調整カレンダー設定 CRUD
// GET    /api/scheduler/me/settings
// PUT    /api/scheduler/me/settings
// GET    /api/scheduler/me/availability-rules
// PUT    /api/scheduler/me/availability-rules
// GET    /api/scheduler/me/overrides
// POST   /api/scheduler/me/overrides
// DELETE /api/scheduler/me/overrides/:id
// GET    /api/scheduler/me/public-url

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { newId } from "../../services/auth.ts";
import { getActiveShareLink, issueNewShareLink, ensureActiveShareLink } from "../../services/schedulerShareToken.ts";
import { getValidGoogleAccessToken } from "../../services/conferenceService.ts";
import { listEvents, insertCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from "../../services/googleClient.ts";
import { resolveEffectiveMemberId } from "../../services/resolve-member.ts";
import type { Env, Variables } from "../../types.ts";

export const schedulerSettingsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- settings ----

schedulerSettingsRoutes.get("/settings", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const settings = await db
    .select()
    .from(schema.memberSchedulingSettings)
    .where(eq(schema.memberSchedulingSettings.memberId, memberId))
    .get();

  return c.json({ data: settings ?? null });
});

schedulerSettingsRoutes.put("/settings", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);
  const body = await c.req.json<{
    slug?: string;
    displayTitle?: string;
    description?: string;
    durationMinutes?: number;
    bufferBeforeMinutes?: number;
    bufferAfterMinutes?: number;
    minNoticeMinutes?: number;
    maxAdvanceDays?: number;
    dailyMaxBookings?: number | null;
    slotIntervalMinutes?: number;
    locationNote?: string | null;
    isPublic?: boolean;
    treatFreeEventsAsBusy?: boolean;
    blockAllDayEvents?: boolean;
  }>();

  const now = new Date().toISOString();
  const existing = await db
    .select()
    .from(schema.memberSchedulingSettings)
    .where(eq(schema.memberSchedulingSettings.memberId, memberId))
    .get();

  // slug の重複チェック
  if (body.slug && body.slug !== existing?.slug) {
    const conflict = await db
      .select({ memberId: schema.memberSchedulingSettings.memberId })
      .from(schema.memberSchedulingSettings)
      .where(eq(schema.memberSchedulingSettings.slug, body.slug))
      .get();
    if (conflict) {
      return c.json({ error: { code: "slug_taken", message: "その URL スラッグは既に使用されています" } }, 409);
    }
  }

  if (!existing) {
    // メールから自動 slug 生成（未設定時）
    const member = await db
      .select({ email: schema.members.email })
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .get();
    const autoSlug = body.slug ?? (member?.email.split("@")[0] ?? memberId.slice(0, 8));

    await db.insert(schema.memberSchedulingSettings).values({
      memberId,
      slug: autoSlug,
      displayTitle: body.displayTitle ?? "1on1 ミーティング",
      description: body.description ?? null,
      durationMinutes: body.durationMinutes ?? 30,
      bufferBeforeMinutes: body.bufferBeforeMinutes ?? 0,
      bufferAfterMinutes: body.bufferAfterMinutes ?? 10,
      minNoticeMinutes: body.minNoticeMinutes ?? 1440,
      maxAdvanceDays: body.maxAdvanceDays ?? 60,
      dailyMaxBookings: body.dailyMaxBookings ?? null,
      slotIntervalMinutes: body.slotIntervalMinutes ?? 30,
      locationNote: body.locationNote ?? null,
      isPublic: body.isPublic !== false ? 1 : 0,
      treatFreeEventsAsBusy: body.treatFreeEventsAsBusy !== false ? 1 : 0,
      blockAllDayEvents: body.blockAllDayEvents === true ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db
      .update(schema.memberSchedulingSettings)
      .set({
        ...(body.slug !== undefined && { slug: body.slug }),
        ...(body.displayTitle !== undefined && { displayTitle: body.displayTitle }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.durationMinutes !== undefined && { durationMinutes: body.durationMinutes }),
        ...(body.bufferBeforeMinutes !== undefined && { bufferBeforeMinutes: body.bufferBeforeMinutes }),
        ...(body.bufferAfterMinutes !== undefined && { bufferAfterMinutes: body.bufferAfterMinutes }),
        ...(body.minNoticeMinutes !== undefined && { minNoticeMinutes: body.minNoticeMinutes }),
        ...(body.maxAdvanceDays !== undefined && { maxAdvanceDays: body.maxAdvanceDays }),
        ...(body.dailyMaxBookings !== undefined && { dailyMaxBookings: body.dailyMaxBookings }),
        ...(body.slotIntervalMinutes !== undefined && { slotIntervalMinutes: body.slotIntervalMinutes }),
        ...(body.locationNote !== undefined && { locationNote: body.locationNote }),
        ...(body.isPublic !== undefined && { isPublic: body.isPublic ? 1 : 0 }),
        ...(body.treatFreeEventsAsBusy !== undefined && { treatFreeEventsAsBusy: body.treatFreeEventsAsBusy ? 1 : 0 }),
        ...(body.blockAllDayEvents !== undefined && { blockAllDayEvents: body.blockAllDayEvents ? 1 : 0 }),
        updatedAt: now,
      })
      .where(eq(schema.memberSchedulingSettings.memberId, memberId));
  }

  const updated = await db
    .select()
    .from(schema.memberSchedulingSettings)
    .where(eq(schema.memberSchedulingSettings.memberId, memberId))
    .get();

  return c.json({ data: updated });
});

// ---- availability-rules ----

schedulerSettingsRoutes.get("/availability-rules", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const rules = await db
    .select()
    .from(schema.availabilityRules)
    .where(eq(schema.availabilityRules.memberId, memberId))
    .all();

  return c.json({ data: rules });
});

schedulerSettingsRoutes.put("/availability-rules", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);
  const body = await c.req.json<{
    rules: {
      dayOfWeek: number;
      startTimeLocal: string;
      endTimeLocal: string;
      timezone?: string;
    }[];
  }>();

  // 既存ルールを全削除してから再挿入
  await db.delete(schema.availabilityRules).where(eq(schema.availabilityRules.memberId, memberId));

  if (body.rules.length > 0) {
    await db.insert(schema.availabilityRules).values(
      body.rules.map((r) => ({
        id: newId(),
        memberId,
        dayOfWeek: r.dayOfWeek,
        startTimeLocal: r.startTimeLocal,
        endTimeLocal: r.endTimeLocal,
        timezone: r.timezone ?? "Asia/Tokyo",
      }))
    );
  }

  const rules = await db
    .select()
    .from(schema.availabilityRules)
    .where(eq(schema.availabilityRules.memberId, memberId))
    .all();

  return c.json({ data: rules });
});

// ---- overrides ----

schedulerSettingsRoutes.get("/overrides", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const overrides = await db
    .select()
    .from(schema.availabilityOverrides)
    .where(eq(schema.availabilityOverrides.memberId, memberId))
    .all();

  return c.json({ data: overrides });
});

schedulerSettingsRoutes.post("/overrides", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);
  const body = await c.req.json<{
    dateLocal: string;
    isBlocked?: boolean;
    startTimeLocal?: string;
    endTimeLocal?: string;
    note?: string;
  }>();

  const id = newId();
  await db.insert(schema.availabilityOverrides).values({
    id,
    memberId,
    dateLocal: body.dateLocal,
    isBlocked: body.isBlocked ? 1 : 0,
    startTimeLocal: body.startTimeLocal ?? null,
    endTimeLocal: body.endTimeLocal ?? null,
    note: body.note ?? null,
  });

  return c.json({ data: { id } }, 201);
});

schedulerSettingsRoutes.delete("/overrides/:id", async (c) => {
  const overrideId = c.req.param("id");
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const existing = await db
    .select({ memberId: schema.availabilityOverrides.memberId })
    .from(schema.availabilityOverrides)
    .where(eq(schema.availabilityOverrides.id, overrideId))
    .get();

  if (!existing || existing.memberId !== memberId) {
    return c.json({ error: { code: "not_found", message: "見つかりません" } }, 404);
  }

  await db.delete(schema.availabilityOverrides).where(eq(schema.availabilityOverrides.id, overrideId));
  return c.json({ data: { deleted: true } });
});

// ---- public-url（期限付き共有リンク） ----

// 現在有効なリンクの状態を返す（未発行・期限切れの場合は publicUrl: null）
// ?ensure=1 を付けた場合、未発行／期限切れなら自動で新規発行してから返す
// （1to1の設定画面など、都度手動発行を求めるのが不便な導線で使う）
schedulerSettingsRoutes.get("/public-url", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const ensure = c.req.query("ensure") === "1";
  const link = ensure
    ? await ensureActiveShareLink(db, c.env, memberId)
    : await getActiveShareLink(db, c.env, memberId);
  return c.json({ data: { publicUrl: link?.publicUrl ?? null, expiresAt: link?.expiresAt ?? null } });
});

// 新しい期限付きリンクを発行する（既存のリンクは無効になる）
schedulerSettingsRoutes.post("/share-link", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const link = await issueNewShareLink(db, c.env, memberId);
  if (!link) {
    return c.json({ error: { code: "not_configured", message: "先に受付時間の設定を保存し、予約ページを公開してください" } }, 400);
  }
  return c.json({ data: { publicUrl: link.publicUrl, expiresAt: link.expiresAt } });
});

// ---- 自分のカレンダーの予定（他メンバーの公開予約ページで、自分の予定を重ねて表示・その場で編集するため）----
// GET    /api/scheduler/me/calendar-events            → 予定一覧（タイトル付き、設定で選んだカレンダー全部）
// POST   /api/scheduler/me/calendar-events             → 予定を新規作成
// PATCH  /api/scheduler/me/calendar-events/:eventId    → 予定を編集
// DELETE /api/scheduler/me/calendar-events/:eventId    → 予定を削除

schedulerSettingsRoutes.get("/calendar-events", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);
  const { from, to } = c.req.query();

  if (!from || !to) {
    return c.json({ error: { code: "invalid_input", message: "from, to を指定してください" } }, 400);
  }
  // from/to は日付のみ（YYYY-MM-DD）で渡ってくる想定。GoogleのAPIはRFC3339形式を要求するため、
  // その日の始まり・終わりのタイムスタンプに変換してから渡す（変換しないとGoogle側が400を返し、
  // 「自分の予定が一切表示されない」という不具合になる）。
  const timeMinUtc = new Date(`${from}T00:00:00Z`).toISOString();
  const timeMaxUtc = new Date(`${to}T23:59:59Z`).toISOString();

  const googleCred = await getValidGoogleAccessToken(
    db, memberId,
    c.env.SCHEDULER_TOKEN_KEY,
    c.env.GOOGLE_OAUTH_CLIENT_ID,
    c.env.GOOGLE_OAUTH_CLIENT_SECRET
  );

  if (googleCred.status === "not_connected") {
    return c.json({ data: { connected: false, events: [], calendars: [] } });
  }
  if (googleCred.status === "refresh_failed") {
    return c.json({ error: { code: "calendar_unavailable", message: "Googleカレンダーの予定を一時的に取得できませんでした。少し時間をおいてから、もう一度お試しください。" } }, 503);
  }

  try {
    const eventLists = await Promise.all(
      googleCred.busyCalendars.map((cal) => listEvents(googleCred.accessToken, cal.id, timeMinUtc, timeMaxUtc))
    );
    const events = eventLists.flat().sort((a, b) => a.startUtc.localeCompare(b.startUtc));
    return c.json({ data: { connected: true, events, calendars: googleCred.busyCalendars } });
  } catch (e) {
    console.error("[scheduler/me/calendar-events] listEvents failed:", e);
    return c.json({ error: { code: "calendar_unavailable", message: "カレンダーの予定を取得できませんでした。時間をおいて再度お試しください。" } }, 503);
  }
});

schedulerSettingsRoutes.post("/calendar-events", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const body = await c.req.json<{ calendarId?: string; summary?: string; startUtc?: string; endUtc?: string; location?: string; description?: string }>().catch(() => ({}) as { calendarId?: string; summary?: string; startUtc?: string; endUtc?: string; location?: string; description?: string });
  if (!body.calendarId || !body.summary?.trim() || !body.startUtc || !body.endUtc) {
    return c.json({ error: { code: "invalid_input", message: "カレンダー・タイトル・開始日時・終了日時を指定してください" } }, 400);
  }
  if (new Date(body.endUtc).getTime() <= new Date(body.startUtc).getTime()) {
    return c.json({ error: { code: "invalid_input", message: "終了日時は開始日時より後にしてください" } }, 400);
  }

  const googleCred = await getValidGoogleAccessToken(
    db, memberId, c.env.SCHEDULER_TOKEN_KEY, c.env.GOOGLE_OAUTH_CLIENT_ID, c.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
  if (googleCred.status === "not_connected") return c.json({ error: { code: "not_connected", message: "Googleと連携されていません" } }, 400);
  if (googleCred.status === "refresh_failed") return c.json({ error: { code: "calendar_unavailable", message: "Googleとの連携情報を一時的に取得できませんでした。少し時間をおいてから、もう一度お試しください。" } }, 503);
  if (!googleCred.busyCalendars.some((cal) => cal.id === body.calendarId)) {
    return c.json({ error: { code: "invalid_calendar", message: "空き状況の確認対象に設定されているカレンダーのみ指定できます" } }, 400);
  }

  try {
    const result = await insertCalendarEvent({
      accessToken: googleCred.accessToken,
      calendarId: body.calendarId,
      summary: body.summary.trim(),
      description: body.description?.trim() ?? "",
      location: body.location?.trim() ?? "",
      startAtUtc: body.startUtc,
      endAtUtc: body.endUtc,
      attendeeEmails: [],
      requestId: `manual-${Date.now()}`,
      withMeet: false,
    });
    return c.json({ data: { id: result.eventId } }, 201);
  } catch (e) {
    console.error("[scheduler/me/calendar-events] insert failed:", e);
    return c.json({ error: { code: "calendar_unavailable", message: "予定の作成に失敗しました。時間をおいて再度お試しください。" } }, 503);
  }
});

schedulerSettingsRoutes.patch("/calendar-events/:eventId", async (c) => {
  const eventId = c.req.param("eventId");
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const body = await c.req.json<{
    calendarId?: string; summary?: string; location?: string; description?: string;
    allDay?: boolean; startUtc?: string; endUtc?: string; startDate?: string; endDate?: string;
  }>().catch(() => ({}) as { calendarId?: string; summary?: string; location?: string; description?: string; allDay?: boolean; startUtc?: string; endUtc?: string; startDate?: string; endDate?: string });
  if (!body.calendarId || !body.summary?.trim()) {
    return c.json({ error: { code: "invalid_input", message: "カレンダー・タイトルを指定してください" } }, 400);
  }
  // 終日予定は date（YYYY-MM-DD）、時間指定の予定は dateTime（ISO文字列）で受け取る。
  // dateTime を終日予定に流用すると Google 側が "Invalid start time" で更新を拒否するため区別する。
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (body.allDay) {
    if (!body.startDate || !body.endDate || !DATE_RE.test(body.startDate) || !DATE_RE.test(body.endDate)) {
      return c.json({ error: { code: "invalid_input", message: "開始日・終了日を指定してください" } }, 400);
    }
    if (body.endDate <= body.startDate) {
      return c.json({ error: { code: "invalid_input", message: "終了日は開始日より後にしてください" } }, 400);
    }
  } else {
    if (!body.startUtc || !body.endUtc) {
      return c.json({ error: { code: "invalid_input", message: "開始日時・終了日時を指定してください" } }, 400);
    }
    if (new Date(body.endUtc).getTime() <= new Date(body.startUtc).getTime()) {
      return c.json({ error: { code: "invalid_input", message: "終了日時は開始日時より後にしてください" } }, 400);
    }
  }

  const googleCred = await getValidGoogleAccessToken(
    db, memberId, c.env.SCHEDULER_TOKEN_KEY, c.env.GOOGLE_OAUTH_CLIENT_ID, c.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
  if (googleCred.status === "not_connected") return c.json({ error: { code: "not_connected", message: "Googleと連携されていません" } }, 400);
  if (googleCred.status === "refresh_failed") return c.json({ error: { code: "calendar_unavailable", message: "Googleとの連携情報を一時的に取得できませんでした。少し時間をおいてから、もう一度お試しください。" } }, 503);
  if (!googleCred.busyCalendars.some((cal) => cal.id === body.calendarId)) {
    return c.json({ error: { code: "invalid_calendar", message: "空き状況の確認対象に設定されているカレンダーのみ指定できます" } }, 400);
  }

  try {
    await updateCalendarEvent({
      accessToken: googleCred.accessToken,
      calendarId: body.calendarId,
      eventId,
      summary: body.summary.trim(),
      location: body.location?.trim() ?? "",
      description: body.description?.trim() ?? "",
      ...(body.allDay
        ? { allDay: true as const, startDate: body.startDate!, endDate: body.endDate! }
        : { allDay: false as const, startAtUtc: body.startUtc!, endAtUtc: body.endUtc! }),
    });
    return c.json({ data: { updated: true } });
  } catch (e) {
    console.error("[scheduler/me/calendar-events] update failed:", e);
    return c.json({ error: { code: "calendar_unavailable", message: "予定の更新に失敗しました。時間をおいて再度お試しください。" } }, 503);
  }
});

schedulerSettingsRoutes.delete("/calendar-events/:eventId", async (c) => {
  const eventId = c.req.param("eventId");
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const calendarId = c.req.query("calendarId");
  if (!calendarId) return c.json({ error: { code: "invalid_input", message: "calendarId を指定してください" } }, 400);

  const googleCred = await getValidGoogleAccessToken(
    db, memberId, c.env.SCHEDULER_TOKEN_KEY, c.env.GOOGLE_OAUTH_CLIENT_ID, c.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
  if (googleCred.status === "not_connected") return c.json({ error: { code: "not_connected", message: "Googleと連携されていません" } }, 400);
  if (googleCred.status === "refresh_failed") return c.json({ error: { code: "calendar_unavailable", message: "Googleとの連携情報を一時的に取得できませんでした。少し時間をおいてから、もう一度お試しください。" } }, 503);
  if (!googleCred.busyCalendars.some((cal) => cal.id === calendarId)) {
    return c.json({ error: { code: "invalid_calendar", message: "空き状況の確認対象に設定されているカレンダーのみ指定できます" } }, 400);
  }

  try {
    await deleteCalendarEvent(googleCred.accessToken, calendarId, eventId);
    return c.json({ data: { deleted: true } });
  } catch (e) {
    console.error("[scheduler/me/calendar-events] delete failed:", e);
    return c.json({ error: { code: "calendar_unavailable", message: "予定の削除に失敗しました。時間をおいて再度お試しください。" } }, 503);
  }
});
