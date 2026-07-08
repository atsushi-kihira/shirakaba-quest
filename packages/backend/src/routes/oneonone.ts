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
import { eq, or, and, sql, inArray } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId } from "../services/auth.ts";
import { MailService } from "../services/mailer.ts";
import { checkAndAwardBadges } from "../services/badge.ts";
import { getActiveSeasonPoints } from "../services/season-points.ts";
import { getFrontendUrl } from "../services/frontendUrl.ts";
import type { Env, Variables } from "../types.ts";

export const oneOnOneRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
oneOnOneRoutes.use("*", authMiddleware);

// ---- GET /api/oneonone ----
oneOnOneRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const userId = c.get("userId");

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

  // pending/accepted セッションの申込者（requester）の公開スケジュールURLをまとめて取得
  const requesterIds = [...new Set(
    sessions
      .filter((s) => s.status === "pending" || s.status === "accepted")
      .map((s) => s.requesterId)
  )];
  const schedulerRows = requesterIds.length > 0
    ? await db
        .select({
          memberId: schema.memberSchedulingSettings.memberId,
          slug: schema.memberSchedulingSettings.slug,
          isPublic: schema.memberSchedulingSettings.isPublic,
        })
        .from(schema.memberSchedulingSettings)
        .where(inArray(schema.memberSchedulingSettings.memberId, requesterIds))
        .all()
    : [];
  const frontendUrl = getFrontendUrl(c.env);
  const schedulerUrlMap = new Map(
    schedulerRows
      .filter((r) => r.isPublic && r.slug)
      .map((r) => [r.memberId, `${frontendUrl}/book/${r.slug}`])
  );

  const result = sessions.map((s) => {
    const partnerId = s.requesterId === userId ? s.responderId : s.requesterId;
    return {
      ...s,
      partner: memberMap.get(partnerId) ?? null,
      myRole: s.requesterId === userId ? "requester" : "responder",
      requesterSchedulerUrl: schedulerUrlMap.get(s.requesterId) ?? null,
    };
  });

  return c.json({ data: result });
});

// ---- POST /api/oneonone ----
oneOnOneRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const requesterId = c.get("userId");
  const { responderId, notifyByEmail } = await c.req.json<{ responderId: string; notifyByEmail?: boolean }>();

  if (requesterId === responderId) {
    return c.json({ error: { code: "self_request", message: "自分自身に1to1は申し込めません" } }, 400);
  }

  // 相手が存在するか確認
  const responder = await db
    .select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
    .from(schema.members)
    .where(eq(schema.members.id, responderId))
    .get();

  if (!responder) {
    return c.json({ error: { code: "not_found", message: "相手が見つかりません" } }, 404);
  }

  // 既にpending/acceptedのセッションがないか確認
  const existing = await db
    .select({ id: schema.oneOnOneSessions.id, status: schema.oneOnOneSessions.status })
    .from(schema.oneOnOneSessions)
    .where(
      and(
        or(
          and(eq(schema.oneOnOneSessions.requesterId, requesterId), eq(schema.oneOnOneSessions.responderId, responderId)),
          and(eq(schema.oneOnOneSessions.requesterId, responderId), eq(schema.oneOnOneSessions.responderId, requesterId))
        )
      )
    )
    .all();

  const active = existing.find((s) => s.status === "pending" || s.status === "accepted");
  if (active) {
    return c.json({ error: { code: "already_exists", message: "進行中の1to1申込があります" } }, 409);
  }

  const now = Math.floor(Date.now() / 1000);
  const id = newId();

  await db.insert(schema.oneOnOneSessions).values({
    id,
    requesterId,
    responderId,
    status: "pending",
    requestedAt: now,
  });

  // 接続レコードを準備（なければ作成）
  await ensureConnection(db, requesterId, responderId, now);
  await ensureConnection(db, responderId, requesterId, now);

  // 接続の requested_at を更新
  await db
    .update(schema.connections)
    .set({ oneOnOneRequestedAt: now })
    .where(and(eq(schema.connections.fromMemberId, requesterId), eq(schema.connections.toMemberId, responderId)));

  // メール通知（申込者が希望した場合のみ）
  if (notifyByEmail && responder.email) {
    try {
      const requester = await db
        .select({ name: schema.members.name })
        .from(schema.members)
        .where(eq(schema.members.id, requesterId))
        .get();

      const design = await db.select().from(schema.cardDesigns).get();

      // 申込者のスケジューラー公開URLを取得（設定済みの場合は候補日リンクをメールに含める）
      const schedulerSettings = await db
        .select({ slug: schema.memberSchedulingSettings.slug, isPublic: schema.memberSchedulingSettings.isPublic })
        .from(schema.memberSchedulingSettings)
        .where(eq(schema.memberSchedulingSettings.memberId, requesterId))
        .get();
      const frontendUrl = getFrontendUrl(c.env);
      const schedulerUrl = schedulerSettings?.isPublic && schedulerSettings.slug
        ? `${frontendUrl}/book/${schedulerSettings.slug}`
        : null;

      const schedulerHtml = schedulerUrl
        ? `<p style="margin-top:16px;padding:12px 16px;background:#F0FBF0;border-radius:8px;">📅 <strong>日程を予約する</strong><br><a href="${schedulerUrl}" style="color:#5A8C5C;word-break:break-all;">${schedulerUrl}</a></p>`
        : "";
      await new MailService(db, c.env).send("oneonone_request", responder.email, {
        appTitle: design?.appTitle ?? "白樺クエスト",
        responderName: responder.name,
        requesterName: requester?.name ?? "メンバー",
        schedulerBlock: schedulerHtml,
      });
    } catch (err) {
      console.error("[oneonone] 通知メール送信失敗", err);
    }
  }

  return c.json({ data: { id, status: "pending" } }, 201);
});

// ---- PATCH /api/oneonone/:id/accept ----
oneOnOneRoutes.patch("/:id/accept", async (c) => {
  const db = createDb(c.env.DB);
  const userId = c.get("userId");
  const sessionId = c.req.param("id");

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
  const userId = c.get("userId");
  const sessionId = c.req.param("id");

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

  return c.json({ data: { status: "rejected" } });
});

// ---- PATCH /api/oneonone/:id/complete ----
oneOnOneRoutes.patch("/:id/complete", async (c) => {
  const db = createDb(c.env.DB);
  const userId = c.get("userId");
  const sessionId = c.req.param("id");

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
    await db.update(schema.oneOnOneSessions)
      .set({ status: "completed", completedAt: now })
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

    return c.json({ data: { status: "completed", bothCompleted: true } });
  }

  return c.json({ data: { status: "waiting_partner", bothCompleted: false } });
});

// ---- PATCH /api/oneonone/:id/uncomplete ---- 完了を取り消す
oneOnOneRoutes.patch("/:id/uncomplete", async (c) => {
  const db = createDb(c.env.DB);
  const userId = c.get("userId");
  const sessionId = c.req.param("id");

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
  const userId = c.get("userId");
  const sessionId = c.req.param("id");

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

  return c.json({ data: { status: "cancelled" } });
});

// ---- DELETE /api/oneonone/:id ----
oneOnOneRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const userId = c.get("userId");
  const sessionId = c.req.param("id");

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

  await db.delete(schema.oneOnOneSessions)
    .where(eq(schema.oneOnOneSessions.id, sessionId));

  return c.json({ data: { deleted: true } });
});

// ---- ユーティリティ ----
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
