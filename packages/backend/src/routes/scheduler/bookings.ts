// ホスト用予約管理ルート（認証必須）
// GET    /api/scheduler/bookings                    → 自分の予約一覧
// GET    /api/scheduler/bookings/guest-followups     → 人脈化を促すべき外部ゲスト予約
// GET    /api/scheduler/bookings/pending-count       → 未決着の外部ゲスト1to1件数（バッジ用。実施前後を問わない）
// PATCH  /api/scheduler/bookings/:id/dismiss-followup → 人脈化プロンプトを今回は表示しない
// GET    /api/scheduler/bookings/:id      → 予約詳細
// POST   /api/scheduler/bookings/:id/cancel → ホストからキャンセル
// DELETE /api/scheduler/bookings          → 記録の一括削除（body: { ids: string[] }）
// DELETE /api/scheduler/bookings/:id      → 記録の削除

import { Hono } from "hono";
import { eq, and, gte, lte, desc, or, inArray, isNull } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { resolveEffectiveMemberId } from "../../services/resolve-member.ts";
import { cancelConfirmedBooking } from "../../services/bookingCancellation.ts";
import { createConference, getAvailableConferenceTypes } from "../../services/conferenceService.ts";
import type { Env, Variables } from "../../types.ts";

export const schedulerBookingsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- GET /api/scheduler/bookings/upcoming ----
// ホストとしてもゲストとしても参加する直近の確定済み予約を返す
schedulerBookingsRoutes.get("/upcoming", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

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
    oneOnOneSessionId: b.oneOnOneSessionId,
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

  // 1to1に紐づく予約のうち、自分がすでに完了を記録済みのものはここには出さない
  // （相手の完了待ちであっても、自分にとってはもうやることがないため）
  const sessionIds = [...new Set(result.filter((r) => r.oneOnOneSessionId).map((r) => r.oneOnOneSessionId as string))];
  const sessions = sessionIds.length > 0
    ? await db
        .select({
          id: schema.oneOnOneSessions.id,
          requesterId: schema.oneOnOneSessions.requesterId,
          requesterCompletedAt: schema.oneOnOneSessions.requesterCompletedAt,
          responderCompletedAt: schema.oneOnOneSessions.responderCompletedAt,
        })
        .from(schema.oneOnOneSessions)
        .where(inArray(schema.oneOnOneSessions.id, sessionIds))
        .all()
    : [];
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));
  const filteredResult = result.filter((r) => {
    if (!r.oneOnOneSessionId) return true;
    const session = sessionMap.get(r.oneOnOneSessionId);
    if (!session) return true;
    const myCompletedAt = session.requesterId === memberId ? session.requesterCompletedAt : session.responderCompletedAt;
    return !myCompletedAt;
  });

  return c.json({ data: filteredResult });
});

// メールアドレスが偶然どこかのメンバーと一致した場合、そのメンバーが退会・削除済みなら
// 実質的には外部ゲストとして扱う（在籍中のメンバーとの予約だけを「メンバー間のやり取り」として除外する）
async function filterEffectivelyExternal<T extends { guestMemberId: string | null }>(
  db: ReturnType<typeof createDb>,
  rows: T[]
): Promise<T[]> {
  const candidateIds = [...new Set(rows.map((r) => r.guestMemberId).filter((x): x is string => !!x))];
  if (candidateIds.length === 0) return rows;
  const activeIds = new Set(
    (await db.select({ id: schema.members.id }).from(schema.members)
      .where(and(inArray(schema.members.id, candidateIds), eq(schema.members.status, "active"))).all())
      .map((m) => m.id)
  );
  return rows.filter((r) => !r.guestMemberId || !activeIds.has(r.guestMemberId));
}

// ---- GET /api/scheduler/bookings/guest-followups ----
// 実施済みの外部ゲスト予約のうち、まだ外部人脈に追加も「今回は追加しない」もしていないものを返す
// （ホーム画面で「人脈に追加しませんか？」と促すため）
schedulerBookingsRoutes.get("/guest-followups", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ data: [] });

  const nowStr = new Date().toISOString();

  const rows = await db
    .select({
      id: schema.bookings.id,
      guestName: schema.bookings.guestName,
      guestMessage: schema.bookings.guestMessage,
      guestCompany: schema.bookings.guestCompany,
      guestMemberId: schema.bookings.guestMemberId,
      startAtUtc: schema.bookings.startAtUtc,
      endAtUtc: schema.bookings.endAtUtc,
    })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.hostMemberId, memberId),
        eq(schema.bookings.status, "confirmed"),
        isNull(schema.bookings.oneOnOneSessionId), // 内部の1to1に紐づく場合はそちらで完了管理するため対象外
        isNull(schema.bookings.externalContactId),
        isNull(schema.bookings.guestFollowupDismissedAt),
        lte(schema.bookings.endAtUtc, nowStr), // 実施予定時刻を過ぎたもののみ
      )
    )
    .orderBy(desc(schema.bookings.endAtUtc))
    .limit(20)
    .all();

  const external = await filterEffectivelyExternal(db, rows);
  return c.json({ data: external.map(({ guestMemberId: _omit, ...rest }) => rest) });
});

// ---- GET /api/scheduler/bookings/pending-count ----
// バッジ用：まだ人脈登録も「今回は追加しない」等の決着もついていない外部ゲスト予約の件数。
// guest-followups と異なり実施予定時刻を過ぎているかどうかは問わない（実施前の「進行中（完了待ち）」も含む）。
// メンバー同士の1to1バッジが、承諾済み・未完了であれば実施日時に関わらず件数に含める考え方と揃えている。
schedulerBookingsRoutes.get("/pending-count", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ data: { count: 0 } });

  const rows = await db
    .select({ id: schema.bookings.id, guestMemberId: schema.bookings.guestMemberId })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.hostMemberId, memberId),
        eq(schema.bookings.status, "confirmed"),
        isNull(schema.bookings.oneOnOneSessionId),
        isNull(schema.bookings.externalContactId),
        isNull(schema.bookings.guestFollowupDismissedAt),
      )
    )
    .all();

  const external = await filterEffectivelyExternal(db, rows);
  return c.json({ data: { count: external.length } });
});

// ---- PATCH /api/scheduler/bookings/:id/dismiss-followup ----
// body: { outcome: "not_held" | "no_add" }
//   not_held → そもそも実施しなかった
//   no_add   → 実施はしたが、今回は人脈に追加しない
schedulerBookingsRoutes.patch("/:id/dismiss-followup", async (c) => {
  const bookingId = c.req.param("id");
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const body = await c.req.json().catch(() => ({}));
  const outcome = body?.outcome === "not_held" ? "not_held" : "no_add";

  const booking = await db
    .select({ id: schema.bookings.id })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.hostMemberId, memberId)))
    .get();
  if (!booking) return c.json({ error: { code: "not_found", message: "予約が見つかりません" } }, 404);

  await db.update(schema.bookings)
    .set({ guestFollowupDismissedAt: new Date().toISOString(), guestFollowupOutcome: outcome })
    .where(eq(schema.bookings.id, bookingId));

  return c.json({ data: { dismissed: true } });
});

// ---- PATCH /api/scheduler/bookings/:id/reschedule ----
// 日時・会議URLの記録を手動で更新する（メンバー同士の1to1の「日時・会議URLを編集」と同様、
// 実際に発行済みのGoogle Meet/Zoomの予定そのものは変更せず、記録の更新のみを行う）
schedulerBookingsRoutes.patch("/:id/reschedule", async (c) => {
  const bookingId = c.req.param("id");
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const body = await c.req.json<{
    startUtc?: string; endUtc?: string; conferenceUrl?: string | null;
    conferenceType?: "zoom" | "google_meet" | "manual";
  }>().catch(() => ({}) as { startUtc?: string; endUtc?: string; conferenceUrl?: string | null; conferenceType?: "zoom" | "google_meet" | "manual" });
  if (body.startUtc && body.endUtc && new Date(body.endUtc).getTime() <= new Date(body.startUtc).getTime()) {
    return c.json({ error: { code: "bad_request", message: "終了日時は開始日時より後にしてください" } }, 400);
  }

  const booking = await db
    .select({ id: schema.bookings.id, hostMemberId: schema.bookings.hostMemberId, startAtUtc: schema.bookings.startAtUtc, endAtUtc: schema.bookings.endAtUtc, guestName: schema.bookings.guestName, guestEmail: schema.bookings.guestEmail })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.hostMemberId, memberId)))
    .get();
  if (!booking) return c.json({ error: { code: "not_found", message: "予約が見つかりません" } }, 404);

  let generatedConferenceUrl: string | null | undefined;

  if (body.conferenceType === "zoom" || body.conferenceType === "google_meet") {
    const startAtUtc = body.startUtc ?? booking.startAtUtc;
    const endAtUtc = body.endUtc ?? booking.endAtUtc;
    if (!startAtUtc || !endAtUtc) {
      return c.json({ error: { code: "bad_request", message: "会議URLを生成するには開始・終了日時が必要です" } }, 400);
    }
    const available = await getAvailableConferenceTypes(db, memberId);
    if (!available.includes(body.conferenceType)) {
      const label = body.conferenceType === "zoom" ? "Zoom" : "Google Meet";
      return c.json({
        error: { code: "not_connected", message: `${label}との連携が完了していません。先に「マイページ→日程調整設定→外部サービス連携」で連携してください。` },
      }, 400);
    }
    const host = await db.select({ name: schema.members.name, email: schema.members.email }).from(schema.members).where(eq(schema.members.id, memberId)).get();
    if (!host) return c.json({ error: { code: "not_found", message: "メンバー情報が見つかりません" } }, 404);

    const conferenceResult = await createConference({
      db,
      tokenKey: c.env.SCHEDULER_TOKEN_KEY,
      hostMemberId: memberId,
      bookingId,
      requestedType: body.conferenceType,
      summary: `${host.name}さんと${booking.guestName}さんの1to1`,
      description: "",
      startAtUtc,
      endAtUtc,
      hostEmail: host.email,
      guestEmail: booking.guestEmail ?? "",
      clientId: c.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: c.env.GOOGLE_OAUTH_CLIENT_SECRET,
      zoomClientId: c.env.ZOOM_CLIENT_ID,
      zoomClientSecret: c.env.ZOOM_CLIENT_SECRET,
    });
    generatedConferenceUrl = conferenceResult.conferenceUrl;

    await db.update(schema.bookings)
      .set({
        startAtUtc,
        endAtUtc,
        conferenceType: conferenceResult.conferenceType,
        conferenceUrl: conferenceResult.conferenceUrl,
        conferenceMetaJson: conferenceResult.conferenceMetaJson,
        hostCalendarEventId: conferenceResult.calendarEventId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.bookings.id, bookingId));
  } else {
    await db.update(schema.bookings)
      .set({
        ...(body.startUtc !== undefined && { startAtUtc: body.startUtc }),
        ...(body.endUtc !== undefined && { endAtUtc: body.endUtc }),
        ...(body.conferenceUrl !== undefined && { conferenceUrl: body.conferenceUrl?.trim() || null, conferenceType: "manual" as const }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.bookings.id, bookingId));
  }

  return c.json({ data: { updated: true, conferenceUrl: generatedConferenceUrl } });
});

// ---- GET /api/scheduler/bookings ----
schedulerBookingsRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);
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

  // ゲストが在籍中のメンバーかどうか（真の外部ゲストかどうかの判定に使う。
  // 退会・削除済みメンバーとメールが偶然一致しただけの場合は外部ゲスト扱いにする）
  const candidateIds = [...new Set(bookings.map((b) => b.guestMemberId).filter((x): x is string => !!x))];
  const activeIds = candidateIds.length > 0
    ? new Set((await db.select({ id: schema.members.id }).from(schema.members)
        .where(and(inArray(schema.members.id, candidateIds), eq(schema.members.status, "active"))).all())
        .map((m) => m.id))
    : new Set<string>();

  // ゲストメールアドレスをマスク
  const masked = bookings.map((b) => ({
    ...b,
    guestEmail: maskEmail(b.guestEmail),
    isExternalGuest: !b.guestMemberId || !activeIds.has(b.guestMemberId),
  }));

  return c.json({ data: masked });
});

// ---- GET /api/scheduler/bookings/:id ----
schedulerBookingsRoutes.get("/:id", async (c) => {
  const bookingId = c.req.param("id");
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

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

  let isExternalGuest = !booking.guestMemberId;
  if (booking.guestMemberId) {
    const guestMember = await db.select({ status: schema.members.status }).from(schema.members)
      .where(eq(schema.members.id, booking.guestMemberId)).get();
    isExternalGuest = !guestMember || guestMember.status !== "active";
  }

  return c.json({ data: { ...booking, events, isExternalGuest } });
});

// ---- POST /api/scheduler/bookings/:id/cancel ----
schedulerBookingsRoutes.post("/:id/cancel", async (c) => {
  const bookingId = c.req.param("id");
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);
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

  await cancelConfirmedBooking(db, c.env, booking, { reason: body.reason ?? null, actorKind: "host", actorId: memberId });

  // 連携している1to1申込があれば、そちらも同期して取り消す（進行中の1to1申込一覧から消えるようにする）
  if (booking.oneOnOneSessionId) {
    const linkedSession = await db
      .select({ status: schema.oneOnOneSessions.status })
      .from(schema.oneOnOneSessions)
      .where(eq(schema.oneOnOneSessions.id, booking.oneOnOneSessionId))
      .get();
    if (linkedSession && (linkedSession.status === "pending" || linkedSession.status === "accepted")) {
      await db.delete(schema.oneOnOneSessions).where(eq(schema.oneOnOneSessions.id, booking.oneOnOneSessionId));
    }
  }

  return c.json({ data: { cancelled: true } });
});

// ---- DELETE /api/scheduler/bookings ---- 一括削除
schedulerBookingsRoutes.delete("/", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);
  const { ids } = await c.req.json<{ ids?: string[] }>().catch(() => ({ ids: [] }));

  if (!ids || ids.length === 0) {
    return c.json({ error: { code: "invalid_request", message: "削除する予約を選択してください" } }, 400);
  }

  const owned = await db
    .select({ id: schema.bookings.id })
    .from(schema.bookings)
    .where(and(inArray(schema.bookings.id, ids), eq(schema.bookings.hostMemberId, memberId)))
    .all();
  const ownedIds = owned.map((b) => b.id);
  if (ownedIds.length === 0) {
    return c.json({ data: { deletedCount: 0 } });
  }

  await db.delete(schema.bookingEvents).where(inArray(schema.bookingEvents.bookingId, ownedIds));
  await db.delete(schema.bookings).where(inArray(schema.bookings.id, ownedIds));

  return c.json({ data: { deletedCount: ownedIds.length } });
});

// ---- DELETE /api/scheduler/bookings/:id ----
schedulerBookingsRoutes.delete("/:id", async (c) => {
  const bookingId = c.req.param("id");
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const booking = await db
    .select({ id: schema.bookings.id })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.hostMemberId, memberId)))
    .get();

  if (!booking) {
    return c.json({ error: { code: "not_found", message: "予約が見つかりません" } }, 404);
  }

  await db.delete(schema.bookingEvents).where(eq(schema.bookingEvents.bookingId, bookingId));
  await db.delete(schema.bookings).where(eq(schema.bookings.id, bookingId));

  return c.json({ data: { deleted: true } });
});

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const masked = local.length > 2
    ? `${local[0]}${"*".repeat(local.length - 2)}${local[local.length - 1]}`
    : `${local[0]}*`;
  return `${masked}@${domain}`;
}
