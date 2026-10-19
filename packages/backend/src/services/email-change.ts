// =============================================================
// メールアドレスの変更（メンバー本人の申請・管理者による代行 共通）
// =============================================================
import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { MailService } from "./mailer.ts";
import { normalizeEmail } from "./registration.ts";
import type { Env } from "../types.ts";

export const EMAIL_CHANGE_VALIDITY_SECONDS = 24 * 60 * 60; // 確認リンクの有効期間（24時間）

export function isValidEmailFormat(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** そのメールアドレスを、他のメンバー・管理者がすでに使っているか（大文字小文字は区別しない） */
export async function isEmailInUse(db: Db, email: string, exceptMemberId?: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  const member = await db.select({ id: schema.members.id }).from(schema.members)
    .where(exceptMemberId
      ? and(sql`lower(${schema.members.email}) = ${normalized}`, ne(schema.members.id, exceptMemberId))
      : sql`lower(${schema.members.email}) = ${normalized}`)
    .get();
  if (member) return true;
  const admin = await db.select({ id: schema.admins.id }).from(schema.admins)
    .where(sql`lower(${schema.admins.email}) = ${normalized}`).get();
  return !!admin;
}

/** メンバーと同じメールアドレスの管理者アカウント（なければ null） */
export async function findLinkedAdmin(db: Db, memberEmail: string) {
  return (await db.select({ id: schema.admins.id, name: schema.admins.name }).from(schema.admins)
    .where(sql`lower(${schema.admins.email}) = ${normalizeEmail(memberEmail)}`).get()) ?? null;
}

/**
 * メンバーのメールアドレスを切り替える。呼び出し前に、形式と重複の確認を済ませておくこと。
 * syncLinkedAdmin: 同じメールアドレスの管理者アカウントがある場合、管理者側も同じアドレスにそろえる（本人の操作のときだけ true）。
 * 変更前のメールアドレスに、変更のお知らせを送る（送信に失敗しても変更は取り消さない）。
 */
export async function applyEmailChange(
  db: Db, env: Env, waitUntil: (p: Promise<unknown>) => void,
  memberId: string, newEmail: string, opts: { syncLinkedAdmin: boolean }
): Promise<{ oldEmail: string }> {
  const member = await db.select({ name: schema.members.name, email: schema.members.email }).from(schema.members)
    .where(eq(schema.members.id, memberId)).get();
  if (!member) throw new Error("member not found");
  const normalized = normalizeEmail(newEmail);
  const now = Math.floor(Date.now() / 1000);

  await db.update(schema.members).set({ email: normalized, updatedAt: now }).where(eq(schema.members.id, memberId));
  if (opts.syncLinkedAdmin) {
    await db.update(schema.admins).set({ email: normalized })
      .where(sql`lower(${schema.admins.email}) = ${normalizeEmail(member.email)}`);
  }

  const design = await db.select({ appTitle: schema.cardDesigns.appTitle }).from(schema.cardDesigns).get();
  waitUntil(
    new MailService(db, env)
      .send("email_change_done", member.email, { appTitle: design?.appTitle ?? "白樺クエスト", memberName: member.name, newEmail: normalized })
      .catch((e) => console.error("[mail] email_change_done failed:", e))
  );
  return { oldEmail: member.email };
}
