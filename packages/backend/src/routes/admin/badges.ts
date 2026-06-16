// =============================================================
// 管理者バッジルート
// POST /api/admin/badges/award-monthly-mvp — 月間MVP手動確定
// =============================================================
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { newId } from "../../services/auth.ts";
import type { Env, Variables } from "../../types.ts";

export const adminBadgeRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// POST /api/admin/badges/award-monthly-mvp
// 今月の1位メンバーに月間MVPバッジを付与する（月初に管理者が手動実行）
adminBadgeRoutes.post("/award-monthly-mvp", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  // 今月の開始 Unix timestamp
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  const monthStart = Math.floor(d.getTime() / 1000);

  // 当月ポイント1位のメンバーを取得
  const top = await db
    .select({
      memberId: schema.pointTransactions.memberId,
      total: sql<number>`sum(${schema.pointTransactions.delta})`.as("total"),
    })
    .from(schema.pointTransactions)
    .where(sql`${schema.pointTransactions.createdAt} >= ${monthStart} AND ${schema.pointTransactions.delta} > 0`)
    .groupBy(schema.pointTransactions.memberId)
    .orderBy(sql`total DESC`)
    .limit(1)
    .get();

  if (!top) {
    return c.json({ ok: false, message: "対象メンバーがいません" });
  }

  // 既存バッジ確認
  const existing = await db
    .select({ id: schema.memberBadges.id })
    .from(schema.memberBadges)
    .where(
      sql`${schema.memberBadges.memberId} = ${top.memberId} AND ${schema.memberBadges.badgeId} = 'badge_monthly_mvp' AND ${schema.memberBadges.earnedAt} >= ${monthStart}`
    )
    .get();

  if (existing) {
    return c.json({ ok: false, message: "今月はすでに付与済みです" });
  }

  await db.insert(schema.memberBadges).values({
    id: newId(),
    memberId: top.memberId,
    badgeId: "badge_monthly_mvp",
    earnedAt: now,
  });

  // メンバー名取得
  const member = await db
    .select({ name: schema.members.name })
    .from(schema.members)
    .where(eq(schema.members.id, top.memberId))
    .get();

  return c.json({ ok: true, memberId: top.memberId, memberName: member?.name, points: top.total });
});
