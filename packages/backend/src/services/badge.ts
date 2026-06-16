// =============================================================
// バッジ判定サービス
// イベント発生時にリアルタイムで呼び出す
// =============================================================
import { eq, and, count, isNotNull, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "../db/schema.ts";
import { newId } from "./auth.ts";

type DB = DrizzleD1Database<typeof schema>;

const BADGES_TO_CHECK = [
  "badge_first_1on1",
  "badge_members_10",
  "badge_quest_master",
  "badge_real_card_5",
] as const;

export async function checkAndAwardBadges(
  db: DB,
  memberId: string,
  schemaRef: typeof schema
): Promise<void> {
  try {
    // 既取得バッジIDセット
    const existing = await db
      .select({ badgeId: schemaRef.memberBadges.badgeId })
      .from(schemaRef.memberBadges)
      .where(eq(schemaRef.memberBadges.memberId, memberId))
      .all();
    const owned = new Set(existing.map((r) => r.badgeId));

    const now = Math.floor(Date.now() / 1000);

    for (const badgeId of BADGES_TO_CHECK) {
      if (owned.has(badgeId)) continue;

      const earned = await checkCondition(db, memberId, badgeId, schemaRef);
      if (!earned) continue;

      await db.insert(schemaRef.memberBadges).values({
        id: newId(),
        memberId,
        badgeId,
        earnedAt: now,
      }).onConflictDoNothing();
    }
  } catch {
    // バッジ付与エラーは握り潰す（メイン処理を妨げない）
  }
}

async function checkCondition(
  db: DB,
  memberId: string,
  badgeId: string,
  s: typeof schema
): Promise<boolean> {
  switch (badgeId) {
    case "badge_first_1on1": {
      const res = await db
        .select({ c: count() })
        .from(s.oneOnOneSessions)
        .where(
          and(
            eq(s.oneOnOneSessions.status, "completed"),
            sql`(${s.oneOnOneSessions.requesterId} = ${memberId} OR ${s.oneOnOneSessions.responderId} = ${memberId})`
          )
        )
        .get();
      return (res?.c ?? 0) >= 1;
    }

    case "badge_members_10": {
      const res = await db
        .select({ c: count() })
        .from(s.connections)
        .where(
          and(
            eq(s.connections.fromMemberId, memberId),
            sql`${s.connections.status} != 'none'`
          )
        )
        .get();
      return (res?.c ?? 0) >= 10;
    }

    case "badge_quest_master": {
      const res = await db
        .select({ c: count() })
        .from(s.questAttempts)
        .where(
          and(
            eq(s.questAttempts.memberId, memberId),
            eq(s.questAttempts.isCorrect, 1)
          )
        )
        .get();
      return (res?.c ?? 0) >= 10;
    }

    case "badge_real_card_5": {
      const res = await db
        .select({ c: count() })
        .from(s.connections)
        .where(
          and(
            eq(s.connections.fromMemberId, memberId),
            isNotNull(s.connections.realCardReceivedAt)
          )
        )
        .get();
      return (res?.c ?? 0) >= 5;
    }

    default:
      return false;
  }
}
