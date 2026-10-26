// =============================================================
// 外部ゲストが回答したときに、主催者の外部人脈へ登録する（ミーティング・定例会・1to1のお誘いの共通処理）
//   ・ゲストが入力した名前・メールアドレス・会社名（屋号）を、主催者の外部人脈にする
//   ・メールアドレスで突き合わせる。主催者がすでに同じメールアドレスの人脈を持っていれば、新しく作らず、
//     会社名が空欄のときだけ補う（主催者が入れた内容は上書きしない）
//   ・ゲスト本人は、公開に同意していないため、公開範囲は「非公開」で登録する（登録件数の上限にも入らない）。
//     主催者が、人脈の管理ページで、あとから公開範囲を変えられる
//   ・メンバー（承認済み）のメールアドレスは、外部人脈にしない
// =============================================================
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { newId } from "./auth.ts";

export const normalizeEmail = (s: string): string => s.trim().toLowerCase();
export const isEmailLike = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export async function registerGuestAsContact(
  db: Db, ownerMemberId: string,
  guest: { name: string; email: string; company?: string | null; contactId?: string | null },
): Promise<string | null> {
  const email = normalizeEmail(guest.email);
  const name = guest.name.trim();
  const company = guest.company?.trim() || null;
  if (!name || !isEmailLike(email)) return null;
  const now = Math.floor(Date.now() / 1000);

  // 主催者が人脈から選んだゲスト、または、同じメールアドレスの人脈がすでにある
  let existing = guest.contactId
    ? await db.select().from(schema.externalContacts)
        .where(and(eq(schema.externalContacts.id, guest.contactId), eq(schema.externalContacts.ownerMemberId, ownerMemberId))).get()
    : undefined;
  if (!existing) {
    existing = await db.select().from(schema.externalContacts)
      .where(and(eq(schema.externalContacts.ownerMemberId, ownerMemberId), sql`lower(${schema.externalContacts.email}) = ${email}`)).get();
  }
  if (existing) {
    const patch: Partial<typeof schema.externalContacts.$inferInsert> = {};
    if (!existing.company && company) {
      patch.company = company;
      // 非公開以外の人脈では、会社名が入ったので、会社概要を作れるようにする
      if (existing.visibility !== "private") patch.businessSummaryStatus = "pending";
    }
    if (!existing.email) patch.email = email;
    if (Object.keys(patch).length > 0) await db.update(schema.externalContacts).set({ ...patch, updatedAt: now }).where(eq(schema.externalContacts.id, existing.id));
    return existing.id;
  }

  // メンバーのメールアドレスは、外部人脈にしない
  const member = await db.select({ id: schema.members.id }).from(schema.members)
    .where(and(eq(schema.members.status, "active"), sql`lower(${schema.members.email}) = ${email}`)).get();
  if (member) return null;

  const id = newId();
  await db.insert(schema.externalContacts).values({
    id, ownerMemberId, name, company, email, visibility: "private", source: "guest",
    note: "招待したゲストが、回答したときに登録した情報です",
    createdAt: now, updatedAt: now, businessSummaryStatus: "skipped",
  });
  return id;
}
