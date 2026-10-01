// =============================================================
// シーズンルート（公開）
// GET /api/season          — アクティブシーズン情報
// GET /api/ranking/season  — シーズンランキング（ranking.ts へ委譲せず直接実装）
// GET /api/season/ranking/me — 自分のシーズンポイント・シーズン順位
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

// GET /api/season/list — 全シーズン一覧（新しい順。ランキング画面のシーズン選択に使う）
seasonRoutes.get("/list", async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.seasons)
    .orderBy(sql`${schema.seasons.startsAt} DESC`)
    .all();

  return c.json({
    data: rows.map((s) => ({
      id: s.id,
      name: s.name,
      theme: s.theme,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      isActive: !!s.isActive,
    })),
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

// GET /api/season/ranking/me?seasonId=xxx — 自分のシーズンポイント・シーズン順位
// （ホーム画面の「現在のポイント」表示用。/ranking/me の全期間集計をシーズン期間に絞ったもの）
seasonRoutes.get("/ranking/me", authMiddleware, async (c) => {
  const db = createDb(c.env.DB);
  const userId = c.get("userId");
  const { seasonId } = c.req.query();

  let season;
  if (seasonId) {
    season = await db.select().from(schema.seasons).where(eq(schema.seasons.id, seasonId)).get();
  } else {
    season = await db.select().from(schema.seasons).where(eq(schema.seasons.isActive, 1)).get();
  }

  // シーズンが存在しない場合、全期間の合計に静かにフォールバックすると「シーズンポイント」の
  // 意味が崩れるため、明示的に0件・順位なしを返す（teams.ts の scope=season と違い、ここでは
  // フォールバックしない）。
  if (!season) return c.json({ data: { points: 0, rank: null } });

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
    .all();

  const totalMap = new Map(rows.map((r) => [r.memberId, Number(r.total ?? 0)]));
  const myPoints = totalMap.get(userId) ?? 0;
  const rank = [...totalMap.values()].filter((p) => p > myPoints).length + 1;

  return c.json({ data: { points: myPoints, rank } });
});
