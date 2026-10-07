// =============================================================
// シーズンポイントの集計
// 「シーズンポイント」＝ そのシーズンの期間内に獲得したポイント（加算分のみ）。
// 「累計ポイント」（全期間の SUM(delta)）とは別物で、ホーム・プロフィール・ランキングの表示に使う。
// =============================================================
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";

export type Season = typeof schema.seasons.$inferSelect;

export async function getActiveSeason(db: Db): Promise<Season | undefined> {
  return db.select().from(schema.seasons).where(eq(schema.seasons.isActive, 1)).get();
}

/** 指定シーズンの期間内に獲得したポイントを、メンバーごとに集計する */
export async function getSeasonPointTotals(db: Db, season: Season): Promise<Map<string, number>> {
  const endTs = season.endsAt ?? Math.floor(Date.now() / 1000);
  const rows = await db
    .select({
      memberId: schema.pointTransactions.memberId,
      total: sql<number>`sum(${schema.pointTransactions.delta})`.as("total"),
    })
    .from(schema.pointTransactions)
    .where(sql`${schema.pointTransactions.delta} > 0 AND ${schema.pointTransactions.createdAt} >= ${season.startsAt} AND ${schema.pointTransactions.createdAt} <= ${endTs}`)
    .groupBy(schema.pointTransactions.memberId)
    .all();
  return new Map(rows.map((r) => [r.memberId, Number(r.total ?? 0)]));
}

/** 1人分のシーズンポイントと順位（シーズンがなければ 0・順位なし） */
export async function getMemberSeasonPoints(
  db: Db, memberId: string, season?: Season
): Promise<{ seasonName: string | null; points: number; rank: number | null }> {
  const s = season ?? await getActiveSeason(db);
  if (!s) return { seasonName: null, points: 0, rank: null };
  const totals = await getSeasonPointTotals(db, s);
  const points = totals.get(memberId) ?? 0;
  const rank = [...totals.values()].filter((p) => p > points).length + 1;
  return { seasonName: s.name, points, rank };
}
