// =============================================================
// メンバーへの追加ロール（パイロット枠・パワーチームコーディネーター）
// =============================================================
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { newId } from "./auth.ts";

// 新機能をパイロット枠で先行公開する場合は、pilot1 / pilot2 のように
// 機能ごとに細分化したロールで対象メンバーを絞る（初期の一枚岩"pilot"は廃止済み）。
export type MemberRoleName =
  | "pilot1"
  | "pilot2"
  | "power_team_coordinator"
  | "mentor_coordinator"    // MTC: メンターコーディネーター
  | "personal_mentor"       // PM: パーソナルメンター
  | "topic_mentor";         // TM: トピックメンター

export async function hasMemberRole(
  db: Db,
  memberId: string,
  role: MemberRoleName
): Promise<boolean> {
  const row = await db
    .select({ id: schema.memberRoles.id })
    .from(schema.memberRoles)
    .where(
      and(
        eq(schema.memberRoles.memberId, memberId),
        eq(schema.memberRoles.role, role),
        isNull(schema.memberRoles.revokedAt)
      )
    )
    .get();
  return !!row;
}

/** 複数メンバー分の付与状況を一括取得（管理画面の一覧表示用） */
export async function getActiveMemberIdsWithRole(
  db: Db,
  role: MemberRoleName
): Promise<Set<string>> {
  const rows = await db
    .select({ memberId: schema.memberRoles.memberId })
    .from(schema.memberRoles)
    .where(and(eq(schema.memberRoles.role, role), isNull(schema.memberRoles.revokedAt)))
    .all();
  return new Set(rows.map((r) => r.memberId));
}

/** ロールを付与する。すでに失効済みの付与があれば復活させる（再作成せず updated) */
export async function grantMemberRole(
  db: Db,
  memberId: string,
  role: MemberRoleName,
  grantedBy: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const existing = await db
    .select({ id: schema.memberRoles.id })
    .from(schema.memberRoles)
    .where(and(eq(schema.memberRoles.memberId, memberId), eq(schema.memberRoles.role, role)))
    .get();

  if (existing) {
    await db
      .update(schema.memberRoles)
      .set({ revokedAt: null, grantedBy, grantedAt: now })
      .where(eq(schema.memberRoles.id, existing.id));
    return;
  }

  await db.insert(schema.memberRoles).values({
    id: newId(),
    memberId,
    role,
    grantedBy,
    grantedAt: now,
    revokedAt: null,
  });
}

export async function revokeMemberRole(
  db: Db,
  memberId: string,
  role: MemberRoleName
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(schema.memberRoles)
    .set({ revokedAt: now })
    .where(and(eq(schema.memberRoles.memberId, memberId), eq(schema.memberRoles.role, role)));
}
