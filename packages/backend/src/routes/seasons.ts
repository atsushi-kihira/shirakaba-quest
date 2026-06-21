// =============================================================
// シーズンルート（公開）
// GET /api/season          — アクティブシーズン情報
// GET /api/ranking/season  — シーズンランキング（ranking.ts へ委譲せず直接実装）
// =============================================================
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import type { Env, Variables } from "../types.ts";

export const seasonRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/season — アクティブシーズン
seasonRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const season = await db
    .select()
    .from(schema.seasons)
    .where(eq(schema.seasons.isActive, 1))
    .get();

  if (!season) return c.json({ data: null });

  return c.json({
    data: {
      id: season.id,
      name: season.name,
      theme: season.theme,
      startsAt: season.startsAt,
      endsAt: season.endsAt,
      isActive: !!season.isActive,
      createdAt: season.createdAt,
      updatedAt: season.updatedAt,
    },
  });
});

// GET /api/season/ranking?seasonId=xxx — シーズンランキング
seasonRoutes.get("/ranking", authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const { seasonId } = c.req.query();

  let season;
  if (seasonId) {
    season = await db.select().from(schema.seasons).where(eq(schema.seasons.id, seasonId)).get();
  } else {
    season = await db.select().from(schema.seasons).where(eq(schema.seasons.isActive, 1)).get();
  }

  if (!season) return c.json({ data: [], season: null });

  // シーズン期間内の pointTransactions を集計
  const endTs = season.endsAt ?? Math.floor(Date.now() / 1000);
  const rows = await db
    .select({
      memberId: schema.pointTransactions.memberId,
      total:    sql<number>`sum(${schema.pointTransactions.delta})`.as("total"),
    })
    .from(schema.pointTransactions)
    .where(
      sql`${schema.pointTransactions.delta} > 0 AND ${schema.pointTransactions.createdAt} >= ${season.startsAt} AND ${schema.pointTransactions.createdAt} <= ${endTs}`
    )
    .groupBy(schema.pointTransactions.memberId)
    .orderBy(sql`total DESC`)
    .all();

  // メンバー情報取得
  const members = await db
    .select({
      id: schema.members.id, name: schema.members.name, furigana: schema.members.furigana,
      emoji: schema.members.emoji, bgColor: schema.members.bgColor, category: schema.members.category,
    })
    .from(schema.members)
    .where(eq(schema.members.status, "active"))
    .all();

  const memberMap = new Map(members.map((m) => [m.id, m]));
  const pointMap = new Map(rows.filter((r) => memberMap.has(r.memberId)).map((r) => [r.memberId, Number(r.total ?? 0)]));

  // ポイント0のアクティブメンバーも含めて全員をランキングに載せる
  const ranked = members
    .map((m) => ({ member: m, points: pointMap.get(m.id) ?? 0 }))
    .sort((a, b) => b.points - a.points);

  const result = ranked.map((r, i) => ({
    rank: i + 1,
    member: r.member,
    points: r.points,
  }));

  return c.json({
    data: result,
    season: {
      id: season.id,
      name: season.name,
      theme: season.theme,
      startsAt: season.startsAt,
      endsAt: season.endsAt,
      isActive: !!season.isActive,
    },
  });
});
