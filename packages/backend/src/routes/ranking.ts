// =============================================================
// ランキングルート
// GET /api/ranking     → 現在のランキング
// GET /api/ranking/me  → 自分の順位
// =============================================================
import { Hono } from "hono";
import { eq, sum, desc, sql } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import type { Env, Variables } from "../types.ts";

export const rankingRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

rankingRoutes.use("*", authMiddleware);

// ---- GET /api/ranking ----
rankingRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);

  // ポイント集計（SUM(delta) per member）
  const pointRows = await db
    .select({
      memberId: schema.pointTransactions.memberId,
      total: sum(schema.pointTransactions.delta).as("total"),
      lastAt: sql<number>`MAX(${schema.pointTransactions.createdAt})`.as("last_at"),
    })
    .from(schema.pointTransactions)
    .groupBy(schema.pointTransactions.memberId)
    .all();

  // アクティブメンバーを取得
  const activeMembers = await db
    .select({
      id: schema.members.id,
      name: schema.members.name,
      furigana: schema.members.furigana,
      emoji: schema.members.emoji,
      bgColor: schema.members.bgColor,
      category: schema.members.category,
    })
    .from(schema.members)
    .where(eq(schema.members.status, "active"))
    .all();

  const pointMap = new Map(pointRows.map((r) => [r.memberId, { total: Number(r.total ?? 0), lastAt: r.lastAt }]));

  // 全メンバー（ポイント0含む）でランキングを組む
  const ranked = activeMembers
    .map((m) => ({
      member: m,
      points: pointMap.get(m.id)?.total ?? 0,
      lastPointedAt: pointMap.get(m.id)?.lastAt ?? null,
    }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      // 同点は最終ポイント取得日時が早い方が上
      if (a.lastPointedAt && b.lastPointedAt) return a.lastPointedAt - b.lastPointedAt;
      return 0;
    });

  const result = ranked.map((r, i) => ({
    rank: i + 1,
    member: r.member,
    points: r.points,
    lastPointedAt: r.lastPointedAt,
  }));

  return c.json({ data: result });
});

// ---- GET /api/ranking/me ----
rankingRoutes.get("/me", async (c) => {
  const db = createDb(c.env.DB);
  const userId = c.get("userId");

  const pointRows = await db
    .select({
      memberId: schema.pointTransactions.memberId,
      total: sum(schema.pointTransactions.delta).as("total"),
    })
    .from(schema.pointTransactions)
    .groupBy(schema.pointTransactions.memberId)
    .all();

  const totalMap = new Map(pointRows.map((r) => [r.memberId, Number(r.total ?? 0)]));
  const myPoints = totalMap.get(userId) ?? 0;
  const rank = [...totalMap.values()].filter((p) => p > myPoints).length + 1;

  return c.json({ data: { points: myPoints, rank } });
});
