// =============================================================
// ミーティング・定例会の作成時に指定する、外部ゲストの検証
//   ・あらかじめ指定するゲストは、名前とメールアドレスが必須（回答を、メールアドレスで対応づけるため）。
//     ただし、「名前（とメール）だけで招待」するゲストは、notifyByEmail=false を指定すると、名前だけで加えられる
//     （招待メールは送らず、主催者が専用URLをDMなどでお渡しする。メールアドレスは、ゲストが回答のときに入力する）。
//     この指定は、ミーティング・定例会の作成のように、専用URLをその場で主催者に返せる呼び出し（allowNoEmail）だけで有効
//   ・外部人脈から選んだゲストは、notifyByEmail に関わらず、いつもメールで招待する（メールアドレスが必須）
//   ・メールアドレスのわからない方には、共有URLを何らかの方法でお伝えし、回答時に名前・メールアドレス・会社名を入力してもらう
//   ・外部人脈から選んだゲストは、人脈の名前・メールアドレスを使う。人脈にメールアドレスがなければ、作成時に入力してもらい、
//     その人脈に保存する（保存しない指定もできる）
//   ・名前とメールアドレスを直接入力したゲストも指定できる
//   ・1回に招待できる人数は上限あり（迷惑メールの中継に使われないようにするため）
// =============================================================
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";

export const MAX_GUESTS = 30;
export type GuestInput = { name?: string; email?: string; contactId?: string; saveToContact?: boolean; notifyByEmail?: boolean };
/** email が null のゲストは、招待メールを送らない（専用URLをDMなどでお渡しする） */
export type ResolvedGuest = { name: string; email: string | null; contactId: string | null };
export type ResolvedGuestWithEmail = ResolvedGuest & { email: string };

/** メールアドレスのあるゲストだけにする（グループなど、メールアドレスが必須の呼び出し向け） */
export function withEmail(guests: ResolvedGuest[]): ResolvedGuestWithEmail[] {
  return guests.filter((g): g is ResolvedGuestWithEmail => !!g.email);
}

export const isEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export async function resolveGuests(
  db: Db, hostMemberId: string, inputs: GuestInput[] | undefined, opts: { allowNoEmail?: boolean } = {},
): Promise<{ ok: true; guests: ResolvedGuest[] } | { ok: false; message: string }> {
  const list = inputs ?? [];
  if (list.length === 0) return { ok: true, guests: [] };
  if (list.length > MAX_GUESTS) return { ok: false, message: `一度に招待できる外部ゲストは${MAX_GUESTS}人までです` };

  const contactIds = [...new Set(list.map((g) => g.contactId).filter((x): x is string => !!x))];
  const contacts = contactIds.length > 0
    ? await db.select().from(schema.externalContacts)
        .where(and(eq(schema.externalContacts.ownerMemberId, hostMemberId), inArray(schema.externalContacts.id, contactIds))).all()
    : [];
  const contactById = new Map(contacts.map((ct) => [ct.id, ct]));

  const guests: ResolvedGuest[] = [];
  const seenEmails = new Set<string>();
  const seenNoEmailNames = new Set<string>();
  const seenContacts = new Set<string>();
  const saves: Array<{ contactId: string; email: string }> = [];
  for (const g of list) {
    const contact = g.contactId ? contactById.get(g.contactId) : undefined;
    if (g.contactId && !contact) return { ok: false, message: "選んだ人脈が見つかりません。選び直してください" };
    if (contact && seenContacts.has(contact.id)) continue; // 同じ人脈を2回選んでいても、1人として扱う
    if (contact) seenContacts.add(contact.id);

    const name = (g.name?.trim() || contact?.name || "").trim();
    if (!name) return { ok: false, message: "ゲストの名前を入力してください" };
    // メールで案内しないゲスト（名前だけで招待）。外部人脈から選んだゲストには、この指定は効かない
    if (opts.allowNoEmail && g.notifyByEmail === false && !contact) {
      const key = name.toLowerCase();
      if (seenNoEmailNames.has(key)) return { ok: false, message: `「${name}」が重複しています。別の方は、お名前を区別できるようにしてください` };
      seenNoEmailNames.add(key);
      guests.push({ name, email: null, contactId: null });
      continue;
    }
    const typed = g.email?.trim() || "";
    if (typed && !isEmail(typed)) return { ok: false, message: `「${name}」のメールアドレスの形式が正しくありません` };
    const email = (typed || contact?.email || "").toLowerCase();
    if (!email) return { ok: false, message: `「${name}」のメールアドレスを入力してください（メールアドレスがわからない方には、共有URLをお伝えください）` };
    if (seenEmails.has(email)) return { ok: false, message: `メールアドレス「${email}」が重複しています` };
    seenEmails.add(email);
    if (contact && typed && !contact.email && g.saveToContact !== false) saves.push({ contactId: contact.id, email });
    guests.push({ name, email, contactId: contact?.id ?? null });
  }

  // 検証がすべて通ってから、人脈にメールアドレスを保存する
  const now = Math.floor(Date.now() / 1000);
  for (const s of saves) {
    await db.update(schema.externalContacts).set({ email: s.email, updatedAt: now }).where(eq(schema.externalContacts.id, s.contactId));
  }
  return { ok: true, guests };
}
