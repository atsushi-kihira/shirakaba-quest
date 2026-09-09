// =============================================================
// 協働リンクの作成・更新
// =============================================================
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { newId } from "./auth.ts";

function normalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * 1to1完了などの活動発生時に呼ぶ。既存リンクがあれば1to1回数・最終活動日時を更新し、
 * なければ新規作成する。呼び出し元の主フローを絶対に壊さないよう、
 * 呼び出し側で try/catch すること前提の設計とする。
 */
export async function touchCollaborationLink(
  db: Db,
  memberAId: string,
  memberBId: string,
  activityAt: number
): Promise<void> {
  const [memberLowId, memberHighId] = normalizePair(memberAId, memberBId);

  const existing = await db
    .select({ id: schema.collaborationLinks.id, oneOnOneCount: schema.collaborationLinks.oneOnOneCount })
    .from(schema.collaborationLinks)
    .where(
      and(
        eq(schema.collaborationLinks.memberLowId, memberLowId),
        eq(schema.collaborationLinks.memberHighId, memberHighId)
      )
    )
    .get();

  const now = Math.floor(Date.now() / 1000);

  if (existing) {
    await db
      .update(schema.collaborationLinks)
      .set({
        oneOnOneCount: existing.oneOnOneCount + 1,
        lastActivityAt: activityAt,
        updatedAt: now,
      })
      .where(eq(schema.collaborationLinks.id, existing.id));
    return;
  }

  await db.insert(schema.collaborationLinks).values({
    id: newId(),
    memberLowId,
    memberHighId,
    oneOnOneCount: 1,
    lastActivityAt: activityAt,
    possibleLow: 0,
    possibleHigh: 0,
    referralLow: 0,
    referralHigh: 0,
    stage: "one",
    stalled: "active",
    createdAt: now,
    updatedAt: now,
  });
}
