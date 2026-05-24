// =============================================================
// 1to1 ルート
// GET  /api/oneonone              → 自分の1to1セッション一覧
// POST /api/oneonone              → 申込
// PATCH /api/oneonone/:id/accept  → 承諾
// PATCH /api/oneonone/:id/reject  → 拒否
// PATCH /api/oneonone/:id/complete → 完了押下（双方で確定）
// =============================================================
import { Hono } from "hono";
import { eq, or, and } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId } from "../services/auth.ts";
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

  const result = sessions.map((s) => {
    const partnerId = s.requesterId === userId ? s.responderId : s.requesterId;
    return {
      ...s,
      partner: memberMap.get(partnerId) ?? null,
      myRole: s.requesterId === userId ? "requester" : "responder",
    };
  });

  return c.json({ data: result });
});

// ---- POST /api/oneonone ----
oneOnOneRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const requesterId = c.get("userId");
  const { responderId } = await c.req.json<{ responderId: string }>();

  if (requesterId === responderId) {
    return c.json({ error: { code: "self_request", message: "自分自身に1to1は申し込めません" } }, 400);
  }

  // 相手が存在するか確認
  const responder = await db
    .select({ id: schema.members.id })
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

    // 双方に +1pt 付与
    for (const memberId of [session.requesterId, session.responderId]) {
      await db.insert(schema.pointTransactions).values({
        id: newId(),
        memberId,
        delta: 1,
        reason: "one_on_one_completed",
        relatedId: sessionId,
        createdAt: now,
      });
    }

    return c.json({ data: { status: "completed", bothCompleted: true } });
  }

  return c.json({ data: { status: "waiting_partner", bothCompleted: false } });
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
