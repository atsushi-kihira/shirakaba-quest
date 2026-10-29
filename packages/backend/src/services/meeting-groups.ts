// =============================================================
// 対象者の「グループ」（ミーティング・定例会の対象者を、あらかじめまとめておく。作った本人だけが使える）
//   ・メンバーと、外部ゲスト（名前・メールアドレス。外部人脈から選んだ人は人脈ID付き）を入れられる
//   ・ミーティング・定例会の作成時にグループを指定すると、その時点のメンバーが招待メンバー（scope=selected）に、
//     外部ゲストが外部ゲストになる。作成された会には meetings.group_id / meeting_series.group_id が付き、
//     グループに後から人が加わったときの追加招待（meeting-participants.ts の propagateGroupAdditions）の対象になる
// =============================================================
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import type { GuestInput } from "./meeting-guests.ts";

export const MAX_GROUPS_PER_MEMBER = 50;
export const MAX_GROUP_NAME_LENGTH = 40;

export type GroupGuestRow = { id: string; name: string; email: string; contactId: string | null };

/** グループの外部ゲストを、ミーティング・定例会の作成で使う形（GuestInput）にする。削除済みの人脈IDは外す */
export async function groupGuestInputs(db: Db, ownerId: string, guests: GroupGuestRow[]): Promise<GuestInput[]> {
  const contactIds = [...new Set(guests.map((g) => g.contactId).filter((x): x is string => !!x))];
  const alive = contactIds.length > 0
    ? new Set((await db.select({ id: schema.externalContacts.id }).from(schema.externalContacts)
        .where(and(eq(schema.externalContacts.ownerMemberId, ownerId), inArray(schema.externalContacts.id, contactIds))).all()).map((r) => r.id))
    : new Set<string>();
  return guests.map((g) => ({ name: g.name, email: g.email, contactId: g.contactId && alive.has(g.contactId) ? g.contactId : undefined }));
}

export type GroupForCreate = { id: string; name: string; memberIds: string[]; guests: GuestInput[] };

/** ミーティング・定例会の作成で、グループを対象者にする。主催者本人のグループだけが使える */
export async function loadGroupForCreate(
  db: Db, ownerId: string, groupId: string | undefined,
): Promise<{ ok: true; group: GroupForCreate } | { ok: false; message: string }> {
  if (!groupId) return { ok: false, message: "グループを選んでください" };
  const group = await db.select().from(schema.meetingGroups)
    .where(and(eq(schema.meetingGroups.id, groupId), eq(schema.meetingGroups.ownerMemberId, ownerId))).get();
  if (!group) return { ok: false, message: "選んだグループが見つかりません。選び直してください" };

  const memberRows = await db.select({ memberId: schema.meetingGroupMembers.memberId }).from(schema.meetingGroupMembers)
    .where(eq(schema.meetingGroupMembers.groupId, group.id)).all();
  const ids = memberRows.map((r) => r.memberId).filter((id) => id !== ownerId);
  const active = ids.length > 0
    ? await db.select({ id: schema.members.id }).from(schema.members)
        .where(and(inArray(schema.members.id, ids), eq(schema.members.status, "active"))).all()
    : [];
  const guestRows = await db.select().from(schema.meetingGroupGuests).where(eq(schema.meetingGroupGuests.groupId, group.id)).all();
  const guests = await groupGuestInputs(db, ownerId, guestRows);
  if (active.length === 0 && guests.length === 0) {
    return { ok: false, message: `グループ「${group.name}」に、メンバーか外部ゲストが入っていません。先にグループへ追加してください` };
  }
  return { ok: true, group: { id: group.id, name: group.name, memberIds: active.map((r) => r.id), guests } };
}

/** グループの外部ゲストに、作成画面で追加指定されたゲストを重ねる（同じメールアドレス・同じ人脈の人は、1人として扱う） */
export function mergeGuestInputs(fromGroup: GuestInput[], extra: GuestInput[] | undefined): GuestInput[] {
  const emails = new Set(fromGroup.map((g) => g.email?.trim().toLowerCase()).filter((x): x is string => !!x));
  const contacts = new Set(fromGroup.map((g) => g.contactId).filter((x): x is string => !!x));
  const rest = (extra ?? []).filter((g) => !(g.contactId && contacts.has(g.contactId)) && !(g.email && emails.has(g.email.trim().toLowerCase())));
  return [...fromGroup, ...rest];
}
