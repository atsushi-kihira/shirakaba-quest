// =============================================================
// 外部ゲストが回答したときに、主催者の外部人脈へ登録する（ミーティング・定例会・1to1のお誘いの共通処理）
//   ・ゲストが入力した名前・メールアドレス・会社名（屋号）を、主催者の外部人脈にする
//   ・メールアドレスで突き合わせる。主催者がすでに同じメールアドレスの人脈を持っていれば、新しく作らず、
//     会社名が空欄のときだけ補う（主催者が入れた内容は上書きしない）
//   ・会社名・屋号が入っていない回答は、登録しない
//   ・公開範囲は「存在のみ公開」で登録する（名前・会社名は他のメンバーに見えない）。主催者が、人脈の管理ページで、あとから変えられる。
//   ・登録件数の上限（非公開を除いて300件）に達している場合は、登録せずに保留（guest_contact_proposals）にして、主催者に確認する。
//     主催者は、「非公開として登録する」「既存の人脈を1件、非公開に変えて、存在のみ公開で登録する」「登録しない」から選ぶ
//   ・メンバー（承認済み）のメールアドレスは、外部人脈にしない
// =============================================================
import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { newId } from "./auth.ts";

export const CONTACT_LIMIT = 300; // collab.ts の EXTERNAL_CONTACTS_LIMIT（非公開を除く登録上限）と同じ

export const normalizeEmail = (s: string): string => s.trim().toLowerCase();
export const isEmailLike = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export async function registerGuestAsContact(
  db: Db, ownerMemberId: string,
  guest: { name: string; email: string; company?: string | null; contactId?: string | null; context?: string },
): Promise<string | null> {
  const email = normalizeEmail(guest.email);
  const name = guest.name.trim();
  const company = guest.company?.trim() || null;
  // 会社名・屋号が入っていない回答は、登録しない
  if (!name || !company || !isEmailLike(email)) return null;
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

  // 登録件数の上限（非公開を除く）に達しているときは、登録せずに、主催者に確認する
  if ((await countPublicContacts(db, ownerMemberId)) >= CONTACT_LIMIT) {
    const pending = await db.select({ id: schema.guestContactProposals.id }).from(schema.guestContactProposals)
      .where(and(eq(schema.guestContactProposals.ownerMemberId, ownerMemberId), eq(schema.guestContactProposals.status, "pending"),
        sql`lower(${schema.guestContactProposals.email}) = ${email}`)).get();
    if (!pending) {
      await db.insert(schema.guestContactProposals).values({
        id: newId(), ownerMemberId, name, email, company, context: guest.context ?? null, status: "pending", createdAt: now,
      });
    }
    return null;
  }
  return insertGuestContact(db, ownerMemberId, { name, email, company }, "existence");
}

export async function countPublicContacts(db: Db, ownerMemberId: string): Promise<number> {
  return (await db.select({ id: schema.externalContacts.id }).from(schema.externalContacts)
    .where(and(eq(schema.externalContacts.ownerMemberId, ownerMemberId), ne(schema.externalContacts.visibility, "private"))).all()).length;
}

/** ゲストの回答から、外部人脈を1件作る（公開範囲は呼び出し側で決める。非公開以外は、会社名から事業概要を作る） */
export async function insertGuestContact(
  db: Db, ownerMemberId: string, g: { name: string; email: string; company: string }, visibility: "existence" | "private",
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const id = newId();
  await db.insert(schema.externalContacts).values({
    id, ownerMemberId, name: g.name, company: g.company, email: normalizeEmail(g.email), visibility, source: "guest",
    note: "招待したゲストが、回答したときに登録した情報です",
    createdAt: now, updatedAt: now,
    // 会社名から事業概要を作る（画面に表示されたときに、自動で生成される）
    businessSummaryStatus: visibility === "private" ? "skipped" : "pending",
  });
  return id;
}
