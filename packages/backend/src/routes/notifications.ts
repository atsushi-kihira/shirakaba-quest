// =============================================================
// 運営からのお知らせ（メンバー向け）
// GET  /api/notifications           — 自分宛てのお知らせ一覧（新しい順・未読件数つき）
// POST /api/notifications/read-all  — すべて既読にする
// POST /api/notifications/:id/read  — 1件を既読にする
// =============================================================
import { Hono } from "hono";
import { and, desc, eq, isNull } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { resolveEffectiveMemberId } from "../services/resolve-member.ts";
import type { Env, Variables } from "../types.ts";

export const notificationRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
notificationRoutes.use("*", authMiddleware);

const LIST_LIMIT = 100;

notificationRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ data: [], unreadCount: 0 });

  const rows = await db.select().from(schema.memberNotifications)
    .where(eq(schema.memberNotifications.memberId, meId))
    .orderBy(desc(schema.memberNotifications.createdAt))
    .limit(LIST_LIMIT).all();
  return c.json({
    data: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, readAt: r.readAt, createdAt: r.createdAt })),
    unreadCount: rows.filter((r) => r.readAt === null).length,
  });
});

// "read-all" を :id より先に登録する
notificationRoutes.post("/read-all", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ ok: true });
  await db.update(schema.memberNotifications).set({ readAt: Math.floor(Date.now() / 1000) })
    .where(and(eq(schema.memberNotifications.memberId, meId), isNull(schema.memberNotifications.readAt)));
  return c.json({ ok: true });
});

notificationRoutes.post("/:id/read", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ ok: true });
  await db.update(schema.memberNotifications).set({ readAt: Math.floor(Date.now() / 1000) })
    .where(and(
      eq(schema.memberNotifications.id, c.req.param("id")),
      eq(schema.memberNotifications.memberId, meId),
      isNull(schema.memberNotifications.readAt)
    ));
  return c.json({ ok: true });
});
