// =============================================================
// 共有：外部人脈（共有する人が登録した人脈の一覧）
// 公開の設定は、人脈ごとの設定のとおり（共有しても、設定より多くは見せない）。
//   ・非公開（private）  ：出さない（件数も出さない）
//   ・存在のみ（existence）：専門分野・事業の概要・関係性・所在地だけ。名前・会社名は出さない
//   ・全公開（full）     ：名前・会社名も出す
// 備考・メールアドレスは、どの設定でも出さない。
// =============================================================
import { eq, inArray, desc } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import type { ShareRow, ViewerLevel } from "./content-share.ts";

export type SharedContact = {
  id: string; name: string | null; company: string | null; specialty: string | null;
  summary: string | null; relationships: string[]; prefecture: string | null;
};
export type SharedContactsBody = { contacts: SharedContact[]; truncated: boolean };

const MAX_CONTACTS = 1000;

export async function manageContacts(db: Db, subjectId: string, meId: string): Promise<{ title: string } | null> {
  if (subjectId !== meId) return null;
  const m = await db.select({ name: schema.members.name }).from(schema.members).where(eq(schema.members.id, meId)).get();
  return m ? { title: `${m.name}さんの外部人脈` } : null;
}

export async function titlesForContacts(db: Db, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 80) {
    const rows = await db.select({ id: schema.members.id, name: schema.members.name }).from(schema.members).where(inArray(schema.members.id, ids.slice(i, i + 80))).all();
    for (const r of rows) out.set(r.id, `${r.name}さんの外部人脈`);
  }
  return out;
}

export async function buildContactsView(
  db: Db, share: ShareRow, _viewerId: string | null, _level: ViewerLevel,
): Promise<{ title: string; body: SharedContactsBody } | null> {
  const owner = await db.select({ id: schema.members.id, name: schema.members.name, status: schema.members.status }).from(schema.members).where(eq(schema.members.id, share.subjectId)).get();
  if (!owner || owner.status === "deleted") return null;

  const rows = (await db.select().from(schema.externalContacts).where(eq(schema.externalContacts.ownerMemberId, owner.id))
    .orderBy(desc(schema.externalContacts.updatedAt)).all()).filter((c) => c.visibility !== "private");
  const truncated = rows.length > MAX_CONTACTS;
  const shown = rows.slice(0, MAX_CONTACTS);

  const rels = new Map<string, string[]>();
  for (let i = 0; i < shown.length; i += 80) {
    const r = await db.select().from(schema.externalContactRelationships).where(inArray(schema.externalContactRelationships.contactId, shown.slice(i, i + 80).map((c) => c.id))).all();
    for (const x of r) rels.set(x.contactId, [...(rels.get(x.contactId) ?? []), x.relationship]);
  }

  const contacts: SharedContact[] = shown.map((c) => {
    const full = c.visibility === "full";
    return {
      id: c.id,
      name: full ? c.name : null,
      company: full ? c.company : null,
      specialty: c.specialty,
      summary: c.businessSummaryStatus === "done" ? c.businessSummary : null,
      relationships: rels.get(c.id) ?? [],
      prefecture: c.prefectureStatus === "done" || c.prefectureStatus === "manual" ? c.prefecture : null,
    };
  });
  return { title: `${owner.name}さんの外部人脈`, body: { contacts, truncated } };
}
