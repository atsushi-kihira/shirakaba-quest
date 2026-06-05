// =============================================================
// ランキングルート
// GET /api/ranking     → 現在のランキング
// GET /api/ranking/me  → 自分の順位
// =============================================================
import { Hono } from "hono";
import { eq, sum, desc, sql, and } from "drizzle-orm";
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

// ---- GET /api/ranking/history ----
// 自分のポイント獲得履歴（直近50件）
rankingRoutes.get("/history", async (c) => {
  const db = createDb(c.env.DB);
  const userId = c.get("userId");

  const txs = await db
    .select()
    .from(schema.pointTransactions)
    .where(eq(schema.pointTransactions.memberId, userId))
    .orderBy(desc(schema.pointTransactions.createdAt))
    .limit(50)
    .all();

  // relatedId から関連情報を補足（クエストタイトルなど）
  const questIds = txs
    .filter((t) => t.reason === "quest_normal_solved" || t.reason === "quest_hard_solved")
    .map((t) => t.relatedId)
    .filter((id): id is string => !!id);

  const quests = questIds.length > 0
    ? await db
        .select({ id: schema.quests.id, title: schema.quests.title, emoji: schema.quests.emoji })
        .from(schema.quests)
        .all()
    : [];
  const questMap = new Map(quests.map((q) => [q.id, q]));

  // relatedId からメンバー名を補足（1to1、リアルカード）
  const memberRelatedIds = txs
    .filter((t) => t.reason === "one_on_one_completed" || t.reason === "real_card_exchanged")
    .map((t) => t.relatedId)
    .filter((id): id is string => !!id);

  const relatedMembers = memberRelatedIds.length > 0
    ? await db
        .select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji })
        .from(schema.members)
        .all()
    : [];
  const memberMap = new Map(relatedMembers.map((m) => [m.id, m]));

  const REASON_LABEL: Record<string, string> = {
    one_on_one_completed: "🤝 1to1完了",
    real_card_exchanged:  "🃏 リアルカード受け取り",
    quest_normal_solved:  "⚔️ お題クリア",
    quest_hard_solved:    "🔥 難題クリア",
    admin_reset:          "🔄 ポイントリセット",
  };

  const data = txs.map((t) => {
    const label = REASON_LABEL[t.reason] ?? t.reason;
    const quest = questMap.get(t.relatedId ?? "");
    const member = memberMap.get(t.relatedId ?? "");
    const detail = quest
      ? `${quest.emoji} ${quest.title}`
      : member
      ? `${member.emoji} ${member.name}`
      : undefined;

    return {
      id: t.id,
      delta: t.delta,
      reason: t.reason,
      label,
      detail,
      createdAt: t.createdAt,
    };
  });

  // 累計ポイントを計算（履歴に付与）
  const totalPoints = txs.reduce((sum, t) => sum + t.delta, 0);

  return c.json({ data, totalPoints });
});
