// =============================================================
// バッジルート
// GET /api/badges              — バッジマスター一覧
// GET /api/members/me/badges   — 自分の取得バッジ
// GET /api/members/:id/badges  — 他者のバッジ（公開）
// =============================================================
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import type { Env, Variables } from "../types.ts";

export const badgeRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/badges
badgeRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const badges = await db
    .select()
    .from(schema.badges)
    .orderBy(schema.badges.sortOrder)
    .all();
  return c.json({ data: badges.map(toPublicBadge) });
});

// GET /api/members/me/badges
badgeRoutes.get("/members/me/badges", authMiddleware, async (c) => {
  const memberId = c.get("userId");
  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.memberBadges)
    .innerJoin(schema.badges, eq(schema.badges.id, schema.memberBadges.badgeId))
    .where(eq(schema.memberBadges.memberId, memberId))
    .orderBy(schema.badges.sortOrder)
    .all();
  return c.json({
    data: rows.map((r) => ({
      id: r.member_badges.id,
      memberId: r.member_badges.memberId,
      badgeId: r.member_badges.badgeId,
      earnedAt: r.member_badges.earnedAt,
      badge: toPublicBadge(r.badges),
    })),
  });
});

// GET /api/members/:id/badges
badgeRoutes.get("/members/:id/badges", authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.memberBadges)
    .innerJoin(schema.badges, eq(schema.badges.id, schema.memberBadges.badgeId))
    .where(eq(schema.memberBadges.memberId, c.req.param("id")))
    .orderBy(schema.badges.sortOrder)
    .all();
  return c.json({
    data: rows.map((r) => ({
      id: r.member_badges.id,
      memberId: r.member_badges.memberId,
      badgeId: r.member_badges.badgeId,
      earnedAt: r.member_badges.earnedAt,
      badge: toPublicBadge(r.badges),
    })),
  });
});

function toPublicBadge(b: typeof schema.badges.$inferSelect) {
  return {
    id: b.id,
    name: b.name,
    emoji: b.emoji,
    description: b.description,
    conditionType: b.conditionType,
    conditionValue: b.conditionValue ?? undefined,
    sortOrder: b.sortOrder,
  };
}
