// =============================================================
// 1to1 ルート
// GET    /api/oneonone                → 自分の1to1セッション一覧
// POST   /api/oneonone                → 申込
// PATCH  /api/oneonone/:id/accept     → 承諾
// PATCH  /api/oneonone/:id/reject     → 拒否
// PATCH  /api/oneonone/:id/cancel     → キャンセル（申込者: pending/accepted、承諾者: accepted）
// PATCH  /api/oneonone/:id/complete   → 完了押下（双方で確定）
// PATCH  /api/oneonone/:id/uncomplete → 完了取り消し
// DELETE /api/oneonone/:id            → 記録削除（completed/rejected/cancelled）
// =============================================================
import { Hono } from "hono";
import { eq, or, and, sql, inArray, isNull, isNotNull } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId } from "../services/auth.ts";
import { MailService } from "../services/mailer.ts";
import { checkAndAwardBadges } from "../services/badge.ts";
import { getActiveSeasonPoints } from "../services/season-points.ts";
import { getFrontendUrl } from "../services/frontendUrl.ts";
import { getActiveShareLink, ensureActiveShareLink } from "../services/schedulerShareToken.ts";
import { resolveEffectiveMemberId } from "../services/resolve-member.ts";
import { touchCollaborationLink } from "../services/collab-link.ts";
import { generateRawToken } from "../services/auth.ts";
import { createConference, getAvailableConferenceTypes } from "../services/conferenceService.ts";
import { cancelConfirmedBooking } from "../services/bookingCancellation.ts";
import type { Env, Variables } from "../types.ts";

export const oneOnOneRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
oneOnOneRoutes.use("*", authMiddleware);

// ---- GET /api/oneonone ----
oneOnOneRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const userId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!userId) return c.json({ data: [] });

  // 放置された1to1（申込中1週間・承諾済みで実施日から1週間）を自動的に遷移させる
  await sweepStaleOneOnOneSessions(db);

  const sessions = await db
    .select()
    .from(schema.oneOnOneSessions)
    .where(
      or(
        eq(schema.oneOnOneSessions.requesterId, userId),
        eq(schema.oneOnOneSessions.responderId, userId)
      )
    )
    .all();

  // 相手メンバー情報を付与
  const memberIds = [
    ...new Set(sessions.flatMap((s) => [s.requesterId, s.responderId])),
  ].filter((id) => id !== userId);

  const members = memberIds.length > 0
    ? await db
        .select({
          id: schema.members.id,
          name: schema.members.name,
          emoji: schema.members.emoji,
          bgColor: schema.members.bgColor,
          category: schema.members.category,
        })
        .from(schema.members)
        .all()
    : [];

  const memberMap = new Map(members.map((m) => [m.id, m]));

  // pending/accepted セッションの申込者（requester）の公開スケジュールURL（期限内のものだけ）をまとめて取得。
  // 期限切れ・未発行の場合はリンクなし（＝日程調整ページ未設定の場合と同じ表示）になる。
  const requesterIds = [...new Set(
    sessions
      .filter((s) => s.status === "pending" || s.status === "accepted")
      .map((s) => s.requesterId)
  )];
  const schedulerLinks = await Promise.all(requesterIds.map((id) => getActiveShareLink(db, c.env, id)));
  const schedulerUrlMap = new Map(
    requesterIds
      .map((id, i) => [id, schedulerLinks[i]?.publicUrl] as const)
      .filter((entry): entry is [string, string] => !!entry[1])
  );

  // 予約確定済みの会議URLを1to1セッションに紐づけて取得
  const sessionIds = sessions.map((s) => s.id);
  const linkedBookings = sessionIds.length > 0
    ? await db
        .select({
          oneOnOneSessionId: schema.bookings.oneOnOneSessionId,
          conferenceType: schema.bookings.conferenceType,
          conferenceUrl: schema.bookings.conferenceUrl,
          startAtUtc: schema.bookings.startAtUtc,
          endAtUtc: schema.bookings.endAtUtc,
        })
        .from(schema.bookings)
        .where(
          and(
            inArray(schema.bookings.oneOnOneSessionId, sessionIds),
            eq(schema.bookings.status, "confirmed")
          )
        )
        .all()
    : [];
  const conferenceBySessionId = new Map(
    linkedBookings
      .filter((b) => b.oneOnOneSessionId)
      .map((b) => [b.oneOnOneSessionId as string, { conferenceType: b.conferenceType, conferenceUrl: b.conferenceUrl, startAtUtc: b.startAtUtc as string | null, endAtUtc: b.endAtUtc as string | null }])
  );

  // フォールバック: 1to1申込のURL（?oneOnOneId=...）経由ではなく、
  // 個人の汎用公開予約URL（マイページの「あなたの予約URL」等、期限付きだが
  // 特定の1to1に紐付かないリンク）経由で予約された場合、その予約には
  // one_on_one_session_id が設定されない。この場合でもゲストが登録メンバーで
  // あれば guest_member_id は正しく記録されるため、名前ではなく会員IDの一致で
  // 「本来この1to1に対応するはずの予約」を推測して補う。
  const participantIds = [...new Set(sessions.flatMap((s) => [s.requesterId, s.responderId]))];
  const unlinkedBookings = participantIds.length > 0
    ? await db
        .select({
          hostMemberId: schema.bookings.hostMemberId,
          guestMemberId: schema.bookings.guestMemberId,
          conferenceType: schema.bookings.conferenceType,
          conferenceUrl: schema.bookings.conferenceUrl,
          startAtUtc: schema.bookings.startAtUtc,
          endAtUtc: schema.bookings.endAtUtc,
          createdAt: schema.bookings.createdAt,
        })
        .from(schema.bookings)
        .where(
          and(
            isNull(schema.bookings.oneOnOneSessionId),
            eq(schema.bookings.status, "confirmed"),
            isNotNull(schema.bookings.guestMemberId),
            inArray(schema.bookings.hostMemberId, participantIds)
          )
        )
        .all()
    : [];
  const unlinkedByHost = new Map<string, typeof unlinkedBookings>();
  for (const b of unlinkedBookings) {
    const list = unlinkedByHost.get(b.hostMemberId) ?? [];
    list.push(b);
    unlinkedByHost.set(b.hostMemberId, list);
  }
  function findFallbackConference(session: typeof sessions[number]) {
    // 会員IDが一致するというだけで補うと、同じ2人の間で過去に行われた（今回とは
    // 無関係な）確定済み予約まで拾ってしまい、「新しく作った1to1申込に、何ヶ月も前の
    // 予約の会議URLが勝手に紐づいて表示される」不具合になる（実際にこの不具合が
    // 発生した）。このフォールバックは「今回の申込に対応するはずの予約」を拾う
    // ためのものなので、申込より前に作られた予約や、申込から大きく時間が経って
    // から作られた予約は対象外にする。
    const requestedAtMs = session.requestedAt * 1000;
    const BEFORE_BUFFER_MS = 60 * 60_000; // 1時間（申込直前の時刻ズレ対策）
    const AFTER_WINDOW_MS = 14 * 86400_000; // 2週間
    const tryHost = (hostId: string, otherId: string) => {
      const list = unlinkedByHost.get(hostId);
      if (!list) return null;
      return list.find((b) => {
        if (b.guestMemberId !== otherId) return false;
        const createdAtMs = new Date(b.createdAt).getTime();
        return createdAtMs >= requestedAtMs - BEFORE_BUFFER_MS && createdAtMs <= requestedAtMs + AFTER_WINDOW_MS;
      }) ?? null;
    };
    return tryHost(session.requesterId, session.responderId) ?? tryHost(session.responderId, session.requesterId);
  }

  const result = sessions.map((s) => {
    const partnerId = s.requesterId === userId ? s.responderId : s.requesterId;
    const baseSchedulerUrl = schedulerUrlMap.get(s.requesterId) ?? null;
    const conference = conferenceBySessionId.get(s.id) ?? findFallbackConference(s);
    // responseToken は未ログインでの承諾/辞退用の秘密情報のため、認証済みAPIレスポンスにも含めない
    const { responseToken: _responseToken, manualConferenceUrl, ...sessionWithoutToken } = s;
    return {
      ...sessionWithoutToken,
      partner: memberMap.get(partnerId) ?? null,
      myRole: s.requesterId === userId ? "requester" : "responder",
      // 予約ページにこの1to1申込のIDを持たせ、予約確定時に紐づけられるようにする
      requesterSchedulerUrl: baseSchedulerUrl ? `${baseSchedulerUrl}?oneOnOneId=${s.id}` : null,
      // scheduledFor が未設定でも、予約(booking)が見つかればその開始日時を使う
      scheduledFor: s.scheduledFor ?? (conference?.startAtUtc ? Math.floor(new Date(conference.startAtUtc).getTime() / 1000) : null),
      // 終了時刻は、予約(booking)が紐づいている場合のみ分かる（手動入力の日程には終了時刻の記録がないため）
      scheduledForEndUtc: conference?.endAtUtc ? Math.floor(new Date(conference.endAtUtc).getTime() / 1000) : null,
      // 予約が紐づいていればその会議URLを、なければ手動入力された会議URLを使う
      conferenceType: conference?.conferenceType ?? (manualConferenceUrl ? "manual_entry" : null),
      conferenceUrl: conference?.conferenceUrl ?? manualConferenceUrl ?? null,
    };
  });

  return c.json({ data: result });
});

// ---- PATCH /api/oneonone/:id/schedule ----
// 別の手段（カレンダー・メール等）で日程調整した1to1について、日時・会議URLを手動で記録する
oneOnOneRoutes.patch("/:id/schedule", async (c) => {
  const db = createDb(c.env.DB);
  const userId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  const sessionId = c.req.param("id");
  if (!userId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const session = await db
    .select()
    .from(schema.oneOnOneSessions)
    .where(eq(schema.oneOnOneSessions.id, sessionId))
    .get();

  if (!session) return c.json({ error: { code: "not_found", message: "セッションが見つかりません" } }, 404);
  if (session.requesterId !== userId && session.responderId !== userId) {
    return c.json({ error: { code: "forbidden", message: "権限がありません" } }, 403);
  }
  if (session.status !== "pending" && session.status !== "accepted") {
    return c.json({ error: { code: "invalid_status", message: "この1to1は編集できない状態です" } }, 400);
  }

  const body = await c.req.json<{
    scheduledForUtc?: string | null; endAtUtc?: string; conferenceUrl?: string | null;
    conferenceType?: "zoom" | "google_meet" | "manual";
  }>();

  const update: { scheduledFor?: number | null; manualConferenceUrl?: string | null; status?: "accepted"; respondedAt?: number } = {};
  if (body.scheduledForUtc !== undefined) {
    if (body.scheduledForUtc === null) {
      update.scheduledFor = null;
    } else {
      const ts = new Date(body.scheduledForUtc).getTime();
      if (Number.isNaN(ts)) return c.json({ error: { code: "bad_request", message: "日時の指定が正しくありません" } }, 400);
      update.scheduledFor = Math.floor(ts / 1000);
    }
  }

  let generatedConferenceUrl: string | null | undefined;

  if (body.conferenceType === "zoom" || body.conferenceType === "google_meet") {
    if (!body.scheduledForUtc || !body.endAtUtc) {
      return c.json({ error: { code: "bad_request", message: "会議URLを生成するには開始・終了日時が必要です" } }, 400);
    }
    const available = await getAvailableConferenceTypes(db, session.requesterId);
    if (!available.includes(body.conferenceType)) {
      const label = body.conferenceType === "zoom" ? "Zoom" : "Google Meet";
      return c.json({
        error: { code: "not_connected", message: `${label}との連携が完了していません。先に「マイページ→日程調整設定→外部サービス連携」で連携してください。` },
      }, 400);
    }

    const [requester, responder] = await Promise.all([
      db.select({ name: schema.members.name, email: schema.members.email }).from(schema.members).where(eq(schema.members.id, session.requesterId)).get(),
      db.select({ name: schema.members.name, email: schema.members.email }).from(schema.members).where(eq(schema.members.id, session.responderId)).get(),
    ]);
    if (!requester || !responder) return c.json({ error: { code: "not_found", message: "メンバー情報が見つかりません" } }, 404);

    const existingBooking = await db
      .select({ id: schema.bookings.id })
      .from(schema.bookings)
      .where(and(eq(schema.bookings.oneOnOneSessionId, sessionId), eq(schema.bookings.status, "confirmed")))
      .get();
    const bookingId = existingBooking?.id ?? newId();

    const conferenceResult = await createConference({
      db,
      tokenKey: c.env.SCHEDULER_TOKEN_KEY,
      hostMemberId: session.requesterId,
      bookingId,
      requestedType: body.conferenceType,
      summary: `${requester.name}さんと${responder.name}さんの1to1`,
      description: "",
      startAtUtc: body.scheduledForUtc,
      endAtUtc: body.endAtUtc,
      hostEmail: requester.email,
      guestEmail: responder.email,
      clientId: c.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: c.env.GOOGLE_OAUTH_CLIENT_SECRET,
      zoomClientId: c.env.ZOOM_CLIENT_ID,
      zoomClientSecret: c.env.ZOOM_CLIENT_SECRET,
    });
    generatedConferenceUrl = conferenceResult.conferenceUrl;

    if (existingBooking) {
      await db.update(schema.bookings).set({
        startAtUtc: body.scheduledForUtc,
        endAtUtc: body.endAtUtc,
        conferenceType: conferenceResult.conferenceType,
        conferenceUrl: conferenceResult.conferenceUrl,
        conferenceMetaJson: conferenceResult.conferenceMetaJson,
        hostCalendarEventId: conferenceResult.calendarEventId,
        updatedAt: new Date().toISOString(),
      }).where(eq(schema.bookings.id, existingBooking.id));
    } else {
      await db.insert(schema.bookings).values({
        id: bookingId,
        hostMemberId: session.requesterId,
        guestMemberId: session.responderId,
        guestName: responder.name,
        guestEmail: responder.email,
        guestMessage: null,
        startAtUtc: body.scheduledForUtc,
        endAtUtc: body.endAtUtc,
        timezone: "Asia/Tokyo",
        status: "confirmed",
        cancellationReason: null,
        cancellationToken: generateRawToken(),
        rescheduleToken: generateRawToken(),
        hostCalendarEventId: conferenceResult.calendarEventId,
        conferenceType: conferenceResult.conferenceType,
        conferenceUrl: conferenceResult.conferenceUrl,
        conferenceMetaJson: conferenceResult.conferenceMetaJson,
        oneOnOneSessionId: sessionId,
        source: "prearranged",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    // 実URLは bookings 側で管理するため、手入力欄は空にしておく（GET /oneonone は bookings を優先表示する）
    update.manualConferenceUrl = null;
  } else if (body.conferenceUrl !== undefined) {
    update.manualConferenceUrl = body.conferenceUrl?.trim() || null;
    // 手入力に切り替えた場合、既存の連携済み予約があれば表示上の会議URLも合わせておく
    const existingBooking = await db
      .select({ id: schema.bookings.id })
      .from(schema.bookings)
      .where(and(eq(schema.bookings.oneOnOneSessionId, sessionId), eq(schema.bookings.status, "confirmed")))
      .get();
    if (existingBooking) {
      await db.update(schema.bookings).set({
        conferenceType: "manual",
        conferenceUrl: update.manualConferenceUrl,
        updatedAt: new Date().toISOString(),
      }).where(eq(schema.bookings.id, existingBooking.id));
    }
  }

  // 承諾側（responder）が自ら日時・会議URLを記録した場合、その行為自体が「承諾」を意味するため、
  // pendingのままだった場合はここで自動的に accepted へ遷移させる
  // （予約サービス経由の確定と同様の扱い。申込側が記録しただけでは承諾したことにはならない）
  if (session.status === "pending" && userId === session.responderId) {
    update.status = "accepted";
    update.respondedAt = Math.floor(Date.now() / 1000);
  }

  await db.update(schema.oneOnOneSessions).set(update).where(eq(schema.oneOnOneSessions.id, sessionId));

  return c.json({ data: { id: sessionId, scheduledFor: update.scheduledFor, conferenceUrl: generatedConferenceUrl ?? update.manualConferenceUrl } });
});

// ---- POST /api/oneonone ----
oneOnOneRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const requesterId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!requesterId) {
    return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないため1to1を申し込めません" } }, 403);
  }
  const body = await c.req.json<{
    responderId: string;
    title?: string;
    durationMinutes?: number;
    note?: string;
    notifyByEmail?: boolean;
  }>();
  const { responderId, notifyByEmail } = body;

  if (requesterId === responderId) {
    return c.json({ error: { code: "self_request", message: "自分自身に1to1は申し込めません" } }, 400);
  }

  let customDurationMinutes: number | null = null;
  if (body.durationMinutes !== undefined) {
    if (!Number.isFinite(body.durationMinutes) || body.durationMinutes < 5 || body.durationMinutes > 480) {
      return c.json({ error: { code: "bad_request", message: "所要時間の指定が正しくありません" } }, 400);
    }
    customDurationMinutes = Math.round(body.durationMinutes);
  }
  const customTitle = body.title?.trim() || null;
  const customNote = body.note?.trim() || null;

  // 相手が存在するか確認
  const responder = await db
    .select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
    .from(schema.members)
    .where(eq(schema.members.id, responderId))
    .get();

  if (!responder) {
    return c.json({ error: { code: "not_found", message: "相手が見つかりません" } }, 404);
  }

  const now = Math.floor(Date.now() / 1000);
  const id = newId();

  await db.insert(schema.oneOnOneSessions).values({
    id,
    requesterId,
    responderId,
    status: "pending",
    requestedAt: now,
    customTitle,
    customDurationMinutes,
    customNote,
  });

  // 接続レコードを準備（なければ作成）
  await ensureConnection(db, requesterId, responderId, now);
  await ensureConnection(db, responderId, requesterId, now);

  // 接続の requested_at を更新
  await db
    .update(schema.connections)
    .set({ oneOnOneRequestedAt: now })
    .where(and(eq(schema.connections.fromMemberId, requesterId), eq(schema.connections.toMemberId, responderId)));

  // 通知（メールは申込者が希望した場合のみ。Web Pushはその選択に関わらず常に送る）
  if (responder.email) {
    try {
      const requester = await db
        .select({ name: schema.members.name })
        .from(schema.members)
        .where(eq(schema.members.id, requesterId))
        .get();

      const design = await db.select().from(schema.cardDesigns).get();

      // 申込者のスケジューラー公開URLを取得（設定済みの場合は候補日リンクをメールに含める。
      // 招待メールを送るこの時点で、期限内のリンクが無ければ新しく発行する）
      const schedulerLink = await ensureActiveShareLink(db, c.env, requesterId);
      const schedulerUrl = schedulerLink ? `${schedulerLink.publicUrl}?oneOnOneId=${id}` : null;

      const schedulerBlockText = schedulerUrl
        ? `📅 日程を予約する\n${schedulerUrl}\n\n`
        : "";
      const titleBlockText = customTitle ? `📌 タイトル：${customTitle}\n\n` : "";
      const noteBlockText = customNote ? `💬 メッセージ：${customNote}\n\n` : "";
      await new MailService(db, c.env).send("oneonone_request", responder.email, {
        appTitle: design?.appTitle ?? "白樺クエスト",
        responderName: responder.name,
        requesterName: requester?.name ?? "メンバー",
        titleBlock: titleBlockText,
        noteBlock: noteBlockText,
        schedulerBlock: schedulerBlockText,
      }, { skipEmailSend: !notifyByEmail });
    } catch (err) {
      console.error("[oneonone] 通知メール送信失敗", err);
    }
  }

  return c.json({ data: { id, status: "pending" } }, 201);
});

// ---- POST /api/oneonone/prearranged ----
// 既に別の手段で日程調整済みの相手に対し、日時・会議ツールを指定して1to1を申し込む。
// 相手は「承諾する」か「断る」のみで回答する（日程調整は不要）。
oneOnOneRoutes.post("/prearranged", async (c) => {
  const db = createDb(c.env.DB);
  const requesterId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!requesterId) {
    return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないため1to1を申し込めません" } }, 403);
  }

  const body = await c.req.json<{
    responderId: string;
    startAtUtc: string;
    endAtUtc: string;
    conferenceType: "zoom" | "google_meet" | "manual";
    conferenceUrl?: string;
    title?: string;
    note?: string;
    notifyByEmail?: boolean;
  }>();

  if (requesterId === body.responderId) {
    return c.json({ error: { code: "self_request", message: "自分自身に1to1は申し込めません" } }, 400);
  }
  if (!body.startAtUtc || !body.endAtUtc || new Date(body.endAtUtc).getTime() <= new Date(body.startAtUtc).getTime()) {
    return c.json({ error: { code: "bad_request", message: "日時の指定が正しくありません" } }, 400);
  }
  if (new Date(body.startAtUtc).getTime() <= Date.now()) {
    // 過去日時を指定できてしまうと、会議URLが自動発行された「もう終わったはずの1to1」が
    // 作られてしまう（実際にこの不具合が発生した）ため、必ず未来の日時のみ許可する。
    return c.json({ error: { code: "past_datetime", message: "過去の日時は指定できません。これから実施する1to1の日時を入力してください。" } }, 400);
  }
  if (!["zoom", "google_meet", "manual"].includes(body.conferenceType)) {
    return c.json({ error: { code: "bad_request", message: "会議ツールの指定が正しくありません" } }, 400);
  }

  const responder = await db
    .select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
    .from(schema.members)
    .where(eq(schema.members.id, body.responderId))
    .get();
  if (!responder) {
    return c.json({ error: { code: "not_found", message: "相手が見つかりません" } }, 404);
  }

  const requester = await db
    .select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
    .from(schema.members)
    .where(eq(schema.members.id, requesterId))
    .get();
  if (!requester) {
    return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないため1to1を申し込めません" } }, 403);
  }

  if (body.conferenceType !== "manual") {
    const available = await getAvailableConferenceTypes(db, requesterId);
    if (!available.includes(body.conferenceType)) {
      const label = body.conferenceType === "zoom" ? "Zoom" : "Google Meet";
      return c.json({
        error: { code: "not_connected", message: `${label}との連携が完了していません。先に「マイページ→日程調整設定→外部サービス連携」で連携してください。` },
      }, 400);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const sessionId = newId();
  const responseToken = generateRawToken();

  // 会議URL発行（申込者側の連携アカウントを使用）。
  // conferenceType が manual の場合は自動発行せず、手入力されたURL（任意）をそのまま使う。
  const bookingId = newId();
  const conferenceResult = body.conferenceType === "manual"
    ? { conferenceType: "manual" as const, conferenceUrl: body.conferenceUrl?.trim() || null, conferenceMetaJson: null, calendarEventId: null }
    : await createConference({
        db,
        tokenKey: c.env.SCHEDULER_TOKEN_KEY,
        hostMemberId: requesterId,
        bookingId,
        requestedType: body.conferenceType,
        summary: body.title?.trim() || `${requester.name}さんと${responder.name}さんの1to1`,
        description: body.note ?? "",
        startAtUtc: body.startAtUtc,
        endAtUtc: body.endAtUtc,
        hostEmail: requester.email,
        guestEmail: responder.email,
        clientId: c.env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: c.env.GOOGLE_OAUTH_CLIENT_SECRET,
        zoomClientId: c.env.ZOOM_CLIENT_ID,
        zoomClientSecret: c.env.ZOOM_CLIENT_SECRET,
      });

  await db.insert(schema.oneOnOneSessions).values({
    id: sessionId,
    requesterId,
    responderId: body.responderId,
    status: "pending",
    requestedAt: now,
    scheduledFor: Math.floor(new Date(body.startAtUtc).getTime() / 1000),
    responseToken,
  });

  await db.insert(schema.bookings).values({
    id: bookingId,
    hostMemberId: requesterId,
    guestMemberId: body.responderId,
    guestName: responder.name,
    guestEmail: responder.email,
    guestMessage: body.note ?? null,
    startAtUtc: body.startAtUtc,
    endAtUtc: body.endAtUtc,
    timezone: "Asia/Tokyo",
    status: "confirmed",
    cancellationReason: null,
    cancellationToken: generateRawToken(),
    rescheduleToken: generateRawToken(),
    hostCalendarEventId: conferenceResult.calendarEventId,
    conferenceType: conferenceResult.conferenceType,
    conferenceUrl: conferenceResult.conferenceUrl,
    conferenceMetaJson: conferenceResult.conferenceMetaJson,
    oneOnOneSessionId: sessionId,
    source: "prearranged",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await ensureConnection(db, requesterId, body.responderId, now);
  await ensureConnection(db, body.responderId, requesterId, now);
  await db
    .update(schema.connections)
    .set({ oneOnOneRequestedAt: now })
    .where(and(eq(schema.connections.fromMemberId, requesterId), eq(schema.connections.toMemberId, body.responderId)));

  // 通知（メールは申込者が希望した場合のみ。Web Pushはその選択に関わらず常に送る）
  if (responder.email) {
    try {
      const design = await db.select().from(schema.cardDesigns).get();
      const frontendUrl = getFrontendUrl(c.env);
      const dateLabel = new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit",
      }).format(new Date(body.startAtUtc));
      const conferenceLabel = conferenceResult.conferenceType === "zoom" ? "Zoom" : conferenceResult.conferenceType === "google_meet" ? "Google Meet" : "会議URL";
      const conferenceBlock = conferenceResult.conferenceUrl
        ? `🔗 ${conferenceLabel}: ${conferenceResult.conferenceUrl}\n\n`
        : "";
      const respondUrl = `${frontendUrl}/oneonone/respond/${responseToken}`;

      await new MailService(db, c.env).send("oneonone_prearranged_request", responder.email, {
        appTitle: design?.appTitle ?? "白樺クエスト",
        responderName: responder.name,
        requesterName: requester.name,
        dateLabel,
        conferenceBlock,
        noteBlock: body.note ? `💬 メッセージ：${body.note}\n\n` : "",
        respondUrl,
      }, { skipEmailSend: body.notifyByEmail === false });
    } catch (err) {
      console.error("[oneonone] prearranged 通知メール送信失敗", err);
    }
  }

  return c.json({ data: { id: sessionId, status: "pending", conferenceUrl: conferenceResult.conferenceUrl } }, 201);
});

// ---- PATCH /api/oneonone/:id/accept ----
oneOnOneRoutes.patch("/:id/accept", async (c) => {
  const db = createDb(c.env.DB);
  const userId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  const sessionId = c.req.param("id");
  if (!userId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const session = await db
    .select()
    .from(schema.oneOnOneSessions)
    .where(eq(schema.oneOnOneSessions.id, sessionId))
    .get();

  if (!session) return c.json({ error: { code: "not_found", message: "セッションが見つかりません" } }, 404);
  if (session.responderId !== userId) return c.json({ error: { code: "forbidden", message: "権限がありません" } }, 403);
  if (session.status !== "pending") return c.json({ error: { code: "invalid_status", message: "承諾できない状態です" } }, 400);

  const now = Math.floor(Date.now() / 1000);
  await db.update(schema.oneOnOneSessions)
    .set({ status: "accepted", respondedAt: now })
    .where(eq(schema.oneOnOneSessions.id, sessionId));

  await db.update(schema.connections)
    .set({ oneOnOneAcceptedAt: now })
    .where(and(eq(schema.connections.fromMemberId, session.requesterId), eq(schema.connections.toMemberId, session.responderId)));

  return c.json({ data: { status: "accepted" } });
});

// ---- PATCH /api/oneonone/:id/reject ----
oneOnOneRoutes.patch("/:id/reject", async (c) => {
  const db = createDb(c.env.DB);
  const userId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  const sessionId = c.req.param("id");
  if (!userId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const session = await db
    .select()
    .from(schema.oneOnOneSessions)
    .where(eq(schema.oneOnOneSessions.id, sessionId))
    .get();

  if (!session) return c.json({ error: { code: "not_found", message: "セッションが見つかりません" } }, 404);
  if (session.responderId !== userId) return c.json({ error: { code: "forbidden", message: "権限がありません" } }, 403);

  const now = Math.floor(Date.now() / 1000);
  await db.update(schema.oneOnOneSessions)
    .set({ status: "rejected", respondedAt: now })
    .where(eq(schema.oneOnOneSessions.id, sessionId));

  // 連携している確定済み予約があれば同期してキャンセルする
  await cancelLinkedBookingIfAny(db, c.env, sessionId, userId);

  return c.json({ data: { status: "rejected" } });
});

// ---- PATCH /api/oneonone/:id/complete ----
oneOnOneRoutes.patch("/:id/complete", async (c) => {
  const db = createDb(c.env.DB);
  const userId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  const sessionId = c.req.param("id");
  if (!userId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const session = await db
    .select()
    .from(schema.oneOnOneSessions)
    .where(eq(schema.oneOnOneSessions.id, sessionId))
    .get();

  if (!session) return c.json({ error: { code: "not_found", message: "セッションが見つかりません" } }, 404);
  if (session.requesterId !== userId && session.responderId !== userId) {
    return c.json({ error: { code: "forbidden", message: "権限がありません" } }, 403);
  }
  if (session.status !== "accepted" && session.status !== "pending") {
    return c.json({ error: { code: "invalid_status", message: "完了できない状態です" } }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const isRequester = session.requesterId === userId;

  const alreadyCompleted = isRequester ? session.requesterCompletedAt : session.responderCompletedAt;
  if (alreadyCompleted) {
    return c.json({ error: { code: "already_completed", message: "既に完了済みです" } }, 400);
  }

  const updateData = isRequester
    ? { requesterCompletedAt: now }
    : { responderCompletedAt: now };

  await db.update(schema.oneOnOneSessions)
    .set(updateData)
    .where(eq(schema.oneOnOneSessions.id, sessionId));

  // 双方完了チェック
  const bothDone = isRequester
    ? !!session.responderCompletedAt
    : !!session.requesterCompletedAt;

  if (bothDone) {
    await applyOneOnOneCompletion(db, session, now);
    return c.json({ data: { status: "completed", bothCompleted: true } });
  }

  return c.json({ data: { status: "waiting_partner", bothCompleted: false } });
});

// ---- PATCH /api/oneonone/:id/uncomplete ---- 完了を取り消す
oneOnOneRoutes.patch("/:id/uncomplete", async (c) => {
  const db = createDb(c.env.DB);
  const userId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  const sessionId = c.req.param("id");
  if (!userId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const session = await db
    .select()
    .from(schema.oneOnOneSessions)
    .where(eq(schema.oneOnOneSessions.id, sessionId))
    .get();

  if (!session) return c.json({ error: { code: "not_found", message: "セッションが見つかりません" } }, 404);
  if (session.requesterId !== userId && session.responderId !== userId) {
    return c.json({ error: { code: "forbidden", message: "権限がありません" } }, 403);
  }

  const isRequester = session.requesterId === userId;
  const myCompletedAt = isRequester ? session.requesterCompletedAt : session.responderCompletedAt;

  if (!myCompletedAt) {
    return c.json({ error: { code: "not_completed", message: "まだ完了を記録していません" } }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const wasFullyCompleted = session.status === "completed";

  // 自分の完了フラグをリセット
  const updateData = isRequester
    ? { requesterCompletedAt: null, status: "accepted" as const }
    : { responderCompletedAt: null, status: "accepted" as const };

  await db.update(schema.oneOnOneSessions)
    .set(updateData)
    .where(eq(schema.oneOnOneSessions.id, sessionId));

  // 双方完了済み（completed）だった場合、両者のポイントを取り消す
  if (wasFullyCompleted) {
    const seasonPts = await getActiveSeasonPoints(db);
    const delta = -seasonPts.oneOnOne;
    for (const memberId of [session.requesterId, session.responderId]) {
      await db.insert(schema.pointTransactions).values({
        id: newId(),
        memberId,
        delta,
        reason: "one_on_one_cancelled",
        relatedId: sessionId,
        createdAt: now,
      });
    }
  }

  return c.json({ data: { status: "accepted", pointsReversed: wasFullyCompleted } });
});

// ---- PATCH /api/oneonone/:id/cancel ----
oneOnOneRoutes.patch("/:id/cancel", async (c) => {
  const db = createDb(c.env.DB);
  const userId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  const sessionId = c.req.param("id");
  if (!userId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const session = await db
    .select()
    .from(schema.oneOnOneSessions)
    .where(eq(schema.oneOnOneSessions.id, sessionId))
    .get();

  if (!session) return c.json({ error: { code: "not_found", message: "セッションが見つかりません" } }, 404);
  if (session.requesterId !== userId && session.responderId !== userId) {
    return c.json({ error: { code: "forbidden", message: "権限がありません" } }, 403);
  }

  const isRequester = session.requesterId === userId;
  const canCancel = isRequester
    ? (session.status === "pending" || session.status === "accepted")
    : session.status === "accepted";

  if (!canCancel) {
    return c.json({ error: { code: "invalid_status", message: "キャンセルできない状態です" } }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  await db.update(schema.oneOnOneSessions)
    .set({ status: "cancelled", respondedAt: now })
    .where(eq(schema.oneOnOneSessions.id, sessionId));

  // 連携している確定済み予約があれば同期してキャンセルする
  await cancelLinkedBookingIfAny(db, c.env, sessionId, userId);

  return c.json({ data: { status: "cancelled" } });
});

// ---- DELETE /api/oneonone/:id ----
oneOnOneRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const userId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  const sessionId = c.req.param("id");
  if (!userId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const session = await db
    .select()
    .from(schema.oneOnOneSessions)
    .where(eq(schema.oneOnOneSessions.id, sessionId))
    .get();

  if (!session) return c.json({ error: { code: "not_found", message: "セッションが見つかりません" } }, 404);
  if (session.requesterId !== userId && session.responderId !== userId) {
    return c.json({ error: { code: "forbidden", message: "権限がありません" } }, 403);
  }

  const deletable = ["completed", "rejected", "cancelled"];
  if (!deletable.includes(session.status)) {
    return c.json({ error: { code: "invalid_status", message: "削除できない状態です（進行中の1to1はキャンセルしてから削除してください）" } }, 400);
  }

  // 念のため、連携している確定済み予約が残っていれば同期してキャンセルする
  await cancelLinkedBookingIfAny(db, c.env, sessionId, userId);

  await db.delete(schema.oneOnOneSessions)
    .where(eq(schema.oneOnOneSessions.id, sessionId));

  return c.json({ data: { deleted: true } });
});

// ---- ユーティリティ ----

// 1to1完了時の副作用（ポイント付与・Connection更新・協働リンク更新・ボーナス・バッジ判定）
// 手動完了（双方ボタン押下）・自動完了（1週間放置スイープ）の両方から同じ内容で呼び出す
async function applyOneOnOneCompletion(
  db: ReturnType<typeof createDb>,
  session: { id: string; requesterId: string; responderId: string },
  now: number,
  opts?: { auto?: boolean }
) {
  const sessionId = session.id;

  await db.update(schema.oneOnOneSessions)
    .set({
      status: "completed",
      completedAt: now,
      ...(opts?.auto ? { autoTransitionReason: "date_passed" } : {}),
    })
    .where(eq(schema.oneOnOneSessions.id, sessionId));

  // 双方の Connection を digital に更新
  for (const [from, to] of [
    [session.requesterId, session.responderId],
    [session.responderId, session.requesterId],
  ]) {
    await db.update(schema.connections)
      .set({ status: "digital", oneOnOneCompletedAt: now })
      .where(and(eq(schema.connections.fromMemberId, from), eq(schema.connections.toMemberId, to)));
  }

  // 協働リンクを更新（失敗しても1to1完了フロー自体は絶対に壊さない）
  try {
    await touchCollaborationLink(db, session.requesterId, session.responderId, now);
  } catch (e) {
    console.error("[oneonone] 協働リンク更新失敗", e);
  }

  // 双方にポイント付与（シーズン設定を優先）
  const seasonPts = await getActiveSeasonPoints(db);
  for (const memberId of [session.requesterId, session.responderId]) {
    await db.insert(schema.pointTransactions).values({
      id: newId(),
      memberId,
      delta: seasonPts.oneOnOne,
      reason: "one_on_one_completed",
      relatedId: sessionId,
      createdAt: now,
    });
  }

  // welcome_quest ボーナス（event_type_def_id 統一方式）
  try {
    const nowTs = now;
    const welcomeEvents = await db
      .select({
        id: schema.eventCampaigns.id,
        relatedMemberId: schema.eventCampaigns.relatedMemberId,
      })
      .from(schema.eventCampaigns)
      .innerJoin(
        schema.eventTypeDefinitions,
        eq(schema.eventCampaigns.eventTypeDefId, schema.eventTypeDefinitions.id)
      )
      .where(
        and(
          eq(schema.eventTypeDefinitions.triggerType, "one_on_one"),
          eq(schema.eventTypeDefinitions.rewardTarget, "partner_of_related"),
          eq(schema.eventCampaigns.status, "active"),
          sql`(${schema.eventCampaigns.endsAt} IS NULL OR ${schema.eventCampaigns.endsAt} >= ${nowTs})`
        )
      )
      .all();

    for (const ev of welcomeEvents) {
      const targetId = ev.relatedMemberId;
      if (!targetId) continue;
      // targetId が requesterId か responderId なら、相手にボーナス付与
      for (const [giver, receiver] of [
        [session.requesterId, session.responderId],
        [session.responderId, session.requesterId],
      ]) {
        if (receiver === targetId) {
          await db.insert(schema.pointTransactions).values({
            id: newId(),
            memberId: giver,
            delta: seasonPts.welcomeQuestBonus,
            reason: "welcome_quest_bonus",
            relatedId: ev.id,
            createdAt: now,
          });
        }
      }
    }
  } catch { /* ボーナスエラーは握り潰す */ }

  // チーム内1on1ボーナス: 同一チームなら双方に +50% の差分を付与
  try {
    const requesterTeam = await db
      .select({ teamId: schema.teamMembers.teamId })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.memberId, session.requesterId))
      .get();

    if (requesterTeam) {
      const responderTeam = await db
        .select({ teamId: schema.teamMembers.teamId })
        .from(schema.teamMembers)
        .where(
          and(
            eq(schema.teamMembers.memberId, session.responderId),
            eq(schema.teamMembers.teamId, requesterTeam.teamId)
          )
        )
        .get();

      if (responderTeam) {
        // 同じチーム → ベースポイント1ptの50%=0.5pt → floor = 0 だと意味がないので最低1
        const bonus = Math.max(1, Math.floor(1 * 0.5));
        for (const memberId of [session.requesterId, session.responderId]) {
          await db.insert(schema.pointTransactions).values({
            id: newId(),
            memberId,
            delta: bonus,
            reason: "1on1_team_bonus",
            relatedId: sessionId,
            createdAt: now,
          });
        }
      }
    }
  } catch { /* チームボーナスエラーは握り潰す */ }

  // バッジ判定（双方）
  await checkAndAwardBadges(db, session.requesterId, schema);
  await checkAndAwardBadges(db, session.responderId, schema);
}

const PENDING_TIMEOUT_SECONDS = 7 * 24 * 60 * 60;
const COMPLETED_GRACE_SECONDS = 7 * 24 * 60 * 60;

// 放置された1to1を自動的に遷移させる（申込中1週間→キャンセル、承諾済み+実施日から1週間→完了）
// Cron等の定期実行基盤がないため、他の遅延更新（events.ts の /active）と同様、
// 一覧取得のたびに軽量なスイープを行う方式を採用する
async function sweepStaleOneOnOneSessions(db: ReturnType<typeof createDb>) {
  const now = Math.floor(Date.now() / 1000);

  // 1) 申込中のまま1週間放置 → 自動キャンセル
  await db.update(schema.oneOnOneSessions)
    .set({ status: "cancelled", respondedAt: now, autoTransitionReason: "pending_timeout" })
    .where(
      and(
        eq(schema.oneOnOneSessions.status, "pending"),
        sql`${schema.oneOnOneSessions.requestedAt} < ${now - PENDING_TIMEOUT_SECONDS}`
      )
    );

  // 2) 承諾済みで実施日から1週間経過 → 自動完了（双方の完了フラグも立てた上で通常完了と同じ副作用を適用）
  const acceptedSessions = await db
    .select()
    .from(schema.oneOnOneSessions)
    .where(eq(schema.oneOnOneSessions.status, "accepted"))
    .all();
  if (acceptedSessions.length === 0) return;

  const sessionIds = acceptedSessions.map((s) => s.id);
  const linkedBookings = await db
    .select({
      oneOnOneSessionId: schema.bookings.oneOnOneSessionId,
      startAtUtc: schema.bookings.startAtUtc,
    })
    .from(schema.bookings)
    .where(
      and(
        inArray(schema.bookings.oneOnOneSessionId, sessionIds),
        eq(schema.bookings.status, "confirmed")
      )
    )
    .all();
  const bookingDateBySessionId = new Map(
    linkedBookings
      .filter((b) => b.oneOnOneSessionId)
      .map((b) => [b.oneOnOneSessionId as string, b.startAtUtc])
  );

  for (const s of acceptedSessions) {
    const bookingDate = bookingDateBySessionId.get(s.id);
    const effectiveDateSec = s.scheduledFor ?? (bookingDate ? Math.floor(new Date(bookingDate).getTime() / 1000) : null);
    if (effectiveDateSec === null) continue; // 実施日が不明なものは安全側に倒して対象外とする
    if (effectiveDateSec >= now - COMPLETED_GRACE_SECONDS) continue; // まだ猶予期間内

    await db.update(schema.oneOnOneSessions)
      .set({
        requesterCompletedAt: s.requesterCompletedAt ?? now,
        responderCompletedAt: s.responderCompletedAt ?? now,
      })
      .where(eq(schema.oneOnOneSessions.id, s.id));

    await applyOneOnOneCompletion(db, s, now, { auto: true });
  }
}

// 1to1申込に紐づく確定済み予約があればキャンセルする（1to1側の変更をbookings側に同期させる）
async function cancelLinkedBookingIfAny(
  db: ReturnType<typeof createDb>,
  env: Env,
  sessionId: string,
  actorId: string
) {
  const booking = await db
    .select()
    .from(schema.bookings)
    .where(and(eq(schema.bookings.oneOnOneSessionId, sessionId), eq(schema.bookings.status, "confirmed")))
    .get();
  if (booking) {
    await cancelConfirmedBooking(db, env, booking, {
      reason: "1to1申込がキャンセルされたため",
      actorKind: "member",
      actorId,
    });
  }
}

async function ensureConnection(
  db: ReturnType<typeof createDb>,
  fromId: string,
  toId: string,
  now: number
) {
  const existing = await db
    .select({ id: schema.connections.id })
    .from(schema.connections)
    .where(and(eq(schema.connections.fromMemberId, fromId), eq(schema.connections.toMemberId, toId)))
    .get();

  if (!existing) {
    await db.insert(schema.connections).values({
      id: newId(),
      fromMemberId: fromId,
      toMemberId: toId,
      status: "none",
    });
  }
}
