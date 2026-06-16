// =============================================================
// イベントルート（公開・認証必要）
// GET  /api/events/active              — アクティブイベント一覧
// GET  /api/events/visitor-invite/mine — 自分のビジター招待クエスト
// POST /api/events/visitor-invite/resolve — 招待クエスト解決
// =============================================================
import { Hono } from "hono";
import { eq, and, sql } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId } from "../services/auth.ts";
import type { Env, Variables } from "../types.ts";

export const eventRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
eventRoutes.use("*", authMiddleware);

// GET /api/events/active
eventRoutes.get("/active", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  const events = await db
    .select()
    .from(schema.eventCampaigns)
    .where(
      and(
        eq(schema.eventCampaigns.status, "active"),
        sql`(${schema.eventCampaigns.endsAt} IS NULL OR ${schema.eventCampaigns.endsAt} >= ${now})`
      )
    )
    .all();

  return c.json({ data: events.map(toPublic) });
});

// GET /api/events/visitor-invite/mine
eventRoutes.get("/visitor-invite/mine", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");

  const invite = await db
    .select()
    .from(schema.visitorInvites)
    .where(
      and(
        eq(schema.visitorInvites.memberId, memberId),
        eq(schema.visitorInvites.status, "pending")
      )
    )
    .get();

  // 未作成なら自動作成
  if (!invite) {
    const now = Math.floor(Date.now() / 1000);
    const id = newId();
    await db.insert(schema.visitorInvites).values({
      id,
      memberId,
      visitorName: "",
      status: "pending",
      pointsAwarded: 5,
      createdAt: now,
    });
    return c.json({ data: { id, memberId, visitorName: "", status: "pending", resolvedAt: null, pointsAwarded: 5, createdAt: now } });
  }

  return c.json({
    data: {
      id: invite.id,
      memberId: invite.memberId,
      visitorName: invite.visitorName,
      status: invite.status,
      resolvedAt: invite.resolvedAt,
      pointsAwarded: invite.pointsAwarded,
      createdAt: invite.createdAt,
    },
  });
});

// POST /api/events/visitor-invite/resolve
eventRoutes.post("/visitor-invite/resolve", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);
  const { visitorName, inviteId } = await c.req.json<{ visitorName: string; inviteId: string }>();

  if (!visitorName?.trim()) {
    return c.json({ error: { code: "invalid_input", message: "ビジター名を入力してください" } }, 400);
  }

  // 招待クエストを解決済みに更新
  await db
    .update(schema.visitorInvites)
    .set({ visitorName: visitorName.trim(), status: "resolved", resolvedAt: now })
    .where(
      and(
        eq(schema.visitorInvites.id, inviteId),
        eq(schema.visitorInvites.memberId, memberId),
        eq(schema.visitorInvites.status, "pending")
      )
    );

  // +5pt 付与
  await db.insert(schema.pointTransactions).values({
    id: newId(),
    memberId,
    delta: 5,
    reason: "visitor_invite_resolved",
    relatedId: inviteId,
    createdAt: now,
  });

  // 新しい招待クエストを自動発行
  const newInviteId = newId();
  await db.insert(schema.visitorInvites).values({
    id: newInviteId,
    memberId,
    visitorName: "",
    status: "pending",
    pointsAwarded: 5,
    createdAt: now,
  });

  return c.json({ ok: true, points: 5, newInviteId });
});

function toPublic(e: typeof schema.eventCampaigns.$inferSelect) {
  return {
    id: e.id,
    type: e.type,
    title: e.title,
    description: e.description,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    relatedMemberId: e.relatedMemberId,
    multiplier: e.multiplier,
    status: e.status,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}
