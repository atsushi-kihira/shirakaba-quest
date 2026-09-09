// =============================================================
// 1to1 公開ルート（未ログインでのメール経由の承諾/辞退用）
// GET  /api/oneonone/public/:token         → 申込内容の確認（認証不要）
// POST /api/oneonone/public/:token/accept  → 承諾（認証不要）
// POST /api/oneonone/public/:token/reject  → 辞退（認証不要）
// =============================================================
import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import type { Env, Variables } from "../types.ts";

export const oneOnOnePublicRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

async function loadByToken(db: ReturnType<typeof createDb>, token: string) {
  const session = await db
    .select()
    .from(schema.oneOnOneSessions)
    .where(eq(schema.oneOnOneSessions.responseToken, token))
    .get();
  if (!session) return null;

  const [requester, responder] = await Promise.all([
    db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
      .from(schema.members).where(eq(schema.members.id, session.requesterId)).get(),
    db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
      .from(schema.members).where(eq(schema.members.id, session.responderId)).get(),
  ]);

  const booking = await db
    .select({ conferenceType: schema.bookings.conferenceType, conferenceUrl: schema.bookings.conferenceUrl })
    .from(schema.bookings)
    .where(eq(schema.bookings.oneOnOneSessionId, session.id))
    .get();

  return { session, requester, responder, booking };
}

oneOnOnePublicRoutes.get("/:token", async (c) => {
  const db = createDb(c.env.DB);
  const token = c.req.param("token");
  const result = await loadByToken(db, token);
  if (!result) return c.json({ error: { code: "not_found", message: "申込が見つかりません" } }, 404);

  const { session, requester, responder, booking } = result;
  return c.json({
    data: {
      status: session.status,
      requesterName: requester?.name ?? "メンバー",
      requesterEmoji: requester?.emoji ?? "🙂",
      responderName: responder?.name ?? "メンバー",
      scheduledFor: session.scheduledFor,
      conferenceType: booking?.conferenceType ?? null,
      conferenceUrl: booking?.conferenceUrl ?? null,
    },
  });
});

oneOnOnePublicRoutes.post("/:token/accept", async (c) => {
  const db = createDb(c.env.DB);
  const token = c.req.param("token");
  const result = await loadByToken(db, token);
  if (!result) return c.json({ error: { code: "not_found", message: "申込が見つかりません" } }, 404);

  const { session } = result;
  if (session.status !== "pending") {
    return c.json({ data: { status: session.status, alreadyResolved: true } });
  }

  const now = Math.floor(Date.now() / 1000);
  await db.update(schema.oneOnOneSessions)
    .set({ status: "accepted", respondedAt: now })
    .where(eq(schema.oneOnOneSessions.id, session.id));
  await db.update(schema.connections)
    .set({ oneOnOneAcceptedAt: now })
    .where(and(eq(schema.connections.fromMemberId, session.requesterId), eq(schema.connections.toMemberId, session.responderId)));

  return c.json({ data: { status: "accepted", alreadyResolved: false } });
});

oneOnOnePublicRoutes.post("/:token/reject", async (c) => {
  const db = createDb(c.env.DB);
  const token = c.req.param("token");
  const result = await loadByToken(db, token);
  if (!result) return c.json({ error: { code: "not_found", message: "申込が見つかりません" } }, 404);

  const { session } = result;
  if (session.status !== "pending") {
    return c.json({ data: { status: session.status, alreadyResolved: true } });
  }

  const now = Math.floor(Date.now() / 1000);
  await db.update(schema.oneOnOneSessions)
    .set({ status: "rejected", respondedAt: now })
    .where(eq(schema.oneOnOneSessions.id, session.id));

  return c.json({ data: { status: "rejected", alreadyResolved: false } });
});
