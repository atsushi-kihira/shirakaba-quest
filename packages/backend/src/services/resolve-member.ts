// =============================================================
// resolveEffectiveMemberId
// 管理者セッションで一般ユーザー向け API を呼ぶ場合、
// 管理者のメールアドレスと一致するメンバーレコードの ID を返す。
// メンバーセッションの場合はそのまま userId を返す。
// =============================================================
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";

/**
 * @returns メンバーID（存在すれば）、管理者にメンバーが紐付かなければ null
 */
export async function resolveEffectiveMemberId(
  db: Db,
  userId: string,
  userType: "member" | "admin"
): Promise<string | null> {
  if (userType === "member") return userId;

  // 管理者の場合: 同メールアドレスのメンバーを探す
  const admin = await db
    .select({ email: schema.admins.email })
    .from(schema.admins)
    .where(eq(schema.admins.id, userId))
    .get();

  if (!admin) return null;

  const member = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(eq(schema.members.email, admin.email))
    .get();

  return member?.id ?? null;
}

/**
 * 承認待ち（pending）のゲストメンバーは限定機能のみ利用できる。
 * このメンバーが status="active"（承認済み）かどうかを返す（見つからない場合はfalse）。
 */
export async function isMemberApproved(db: Db, memberId: string): Promise<boolean> {
  const member = await db.select({ status: schema.members.status }).from(schema.members)
    .where(eq(schema.members.id, memberId)).get();
  return member?.status === "active";
}
