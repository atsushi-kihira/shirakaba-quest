// =============================================================
// お知らせ配信の宛先解決（ミーティングの対象者の選び方と同じ「全員／ギルド／チーム／指定」）
// 常に利用中（status='active'）のメンバーだけを対象にする。
// =============================================================
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";

export type RecipientScope = "all" | "team" | "collab_team" | "selected";

export type RecipientQuery = {
  scope: RecipientScope;
  /** scope='team'（ギルド）のとき */
  teamId?: string | null;
  /** scope='collab_team'（チーム）のとき */
  collabTeamId?: string | null;
  /** scope='selected'（指定）のとき */
  memberIds?: string[];
};

export type Recipient = { id: string; name: string; email: string; emoji: string };

const CHUNK = 50; // D1のバインド変数上限を避けるためIN句を分割する

function chunk<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
  return out;
}

export async function resolveRecipients(db: Db, q: RecipientQuery): Promise<Recipient[]> {
  let ids: string[] | null = null; // null = 全員

  if (q.scope === "team") {
    if (!q.teamId) return [];
    const rows = await db.select({ memberId: schema.teamMembers.memberId }).from(schema.teamMembers)
      .where(eq(schema.teamMembers.teamId, q.teamId)).all();
    ids = rows.map((r) => r.memberId);
  } else if (q.scope === "collab_team") {
    if (!q.collabTeamId) return [];
    const rows = await db.select({ memberId: schema.collabTeamMembers.memberId }).from(schema.collabTeamMembers)
      .where(and(eq(schema.collabTeamMembers.teamId, q.collabTeamId), eq(schema.collabTeamMembers.status, "active"))).all();
    ids = rows.map((r) => r.memberId);
  } else if (q.scope === "selected") {
    ids = [...new Set(q.memberIds ?? [])];
  }

  const select = {
    id: schema.members.id, name: schema.members.name, email: schema.members.email, emoji: schema.members.emoji,
  };
  if (ids === null) {
    return db.select(select).from(schema.members).where(eq(schema.members.status, "active")).all();
  }
  if (ids.length === 0) return [];
  const out: Recipient[] = [];
  for (const part of chunk(ids)) {
    out.push(...await db.select(select).from(schema.members)
      .where(and(inArray(schema.members.id, part), eq(schema.members.status, "active"))).all());
  }
  return out;
}
