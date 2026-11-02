// =============================================================
// 共有：チーム案・実チームに共通の「メンバー案（候補）・次の一歩の提案・アクション」
// 一緒にチーム化を検討する人と話し合えるよう、確定していなくても、見るだけの形で見せる。
// 個人情報は、見る人に応じて絞り込む。
//   ・メンバー：名前・絵文字・職種・役割（メンバー一覧で公開されている範囲）
//   ・外部人脈：共有した人の人脈は、人脈ごとの公開設定のとおり（非公開は出さない／存在のみは名前・会社名を伏せる／全公開は名前・会社名も出す）。
//     ほかの方の人脈は、名前・会社名を伏せ、専門分野・事業の概要だけ（URLで見る人には出さない）
// =============================================================
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import type { ViewerLevel } from "./content-share.ts";
import { buildNextSteps, getProfile, loadRoster, parseRoles, resolveSubject, type ProfileRow, type Roster, type Subject, type SubjectType } from "./team-workspace.ts";

export type SharedCandidate =
  | { kind: "member"; id: string; name: string; emoji: string; bgColor: string; headline: string; role: string | null; invited?: boolean }
  | { kind: "contact"; name: string | null; company: string | null; specialty: string | null; summary: string | null; relationships: string[]; role: string | null; isSharersContact: boolean }
  | { kind: "talent"; title: string; profile: string; role: string | null; filled?: boolean };

export type SharedPlan = {
  candidates: SharedCandidate[];
  nextSteps: { kind: string; title: string; detail: string }[];
  actions: { task: string; assigneeName: string | null; dueDate: string | null; completed: boolean }[];
};

export type PlanContext = { subject: Subject; profile: ProfileRow | null; roster: Roster; roles: Record<string, string>; plan: SharedPlan };

/**
 * 共有した人（ownerId）の立場で、候補・次の一歩・アクションを組み立て、見る人（level）に応じて絞る。
 * type='draft'：subjectId はチーム案のID（ownerId は作成者）／type='team'：subjectId はチームのID（ownerId は共有を設定したリーダー）
 */
export async function buildPlanContext(db: Db, type: SubjectType, subjectId: string, ownerId: string, level: ViewerLevel): Promise<PlanContext | null> {
  const resolved = await resolveSubject(db, type, subjectId, ownerId);
  if (!resolved) return null;
  const ownerAccess = { isActive: true, isPending: false, isLeader: true, leaderGone: false };
  const [profile, roster, prospectRows, actionRows, meeting, owner] = await Promise.all([
    getProfile(db, type, subjectId),
    loadRoster(db, resolved.subject, ownerAccess, ownerId),
    db.select().from(schema.teamProspects).where(and(eq(schema.teamProspects.subjectType, type), eq(schema.teamProspects.subjectId, subjectId))).all(),
    db.select().from(schema.collabTeamActionItems).where(eq(schema.collabTeamActionItems.teamId, subjectId)).orderBy(asc(schema.collabTeamActionItems.createdAt)).all(),
    type === "team" ? db.select({ id: schema.meetings.id }).from(schema.meetings).where(eq(schema.meetings.collabTeamId, subjectId)).limit(1).get() : Promise.resolve(undefined),
    db.select({ id: schema.members.id, name: schema.members.name }).from(schema.members).where(eq(schema.members.id, ownerId)).get(),
  ]);
  const roles = parseRoles(profile?.rolesJson);

  // 外部人脈の候補
  const contactIds = roster.prospects.filter((p) => p.kind === "contact").map((p) => p.key.slice(2));
  const contacts = new Map<string, typeof schema.externalContacts.$inferSelect>();
  for (let i = 0; i < contactIds.length; i += 80) {
    for (const c of await db.select().from(schema.externalContacts).where(inArray(schema.externalContacts.id, contactIds.slice(i, i + 80))).all()) contacts.set(c.id, c);
  }

  const candidates: SharedCandidate[] = [];
  // 実チームでは、招待中（まだ返事のない）人も、メンバー案として見せる。参加中の人は「メンバー」の欄に出る
  if (type === "team") {
    for (const m of roster.members) {
      if (m.status === "pending") candidates.push({ kind: "member", id: m.id, name: m.name, emoji: m.emoji, bgColor: m.bgColor, headline: m.headline, role: m.role, invited: true });
    }
  }
  for (const p of roster.prospects) {
    if (p.kind === "member") {
      candidates.push({ kind: "member", id: p.memberId ?? "", name: p.name ?? "", emoji: p.emoji ?? "👤", bgColor: p.bgColor ?? "bg-stone-100", headline: p.headline ?? "", role: p.role });
    } else if (p.kind === "talent") {
      candidates.push({ kind: "talent", title: p.title ?? "", profile: p.profile ?? "", role: p.role, filled: p.filled });
    } else {
      const c = contacts.get(p.key.slice(2));
      if (!c || c.visibility === "private") continue;
      const sharers = c.ownerMemberId === ownerId;
      if (level === "public" && !sharers) continue; // URLで見る人には、ほかの方の人脈を出さない
      const showName = sharers && c.visibility === "full";
      candidates.push({
        kind: "contact", name: showName ? c.name : null, company: showName ? c.company : null,
        specialty: c.specialty, summary: p.summary ?? null, relationships: p.relationships ?? [], role: p.role, isSharersContact: sharers,
      });
    }
  }

  const added = new Map(prospectRows.map((r) => [r.id, r.createdAt]));
  const steps = buildNextSteps(resolved.subject, profile, roster, actionRows.map((a) => a.task), !!meeting, added);

  // アクションの担当者は、共有した人だけ名前を出す（ほかの人は、名前を出さない）
  return {
    subject: resolved.subject, profile, roster, roles,
    plan: {
      candidates,
      // 内部の参照（refKey・text）は出さない
      nextSteps: steps.map((s) => ({ kind: s.kind, title: s.title, detail: s.detail })),
      actions: actionRows.filter((a) => a.visibility !== "private").map((a) => ({
        task: a.task, assigneeName: owner && a.assigneeMemberId === owner.id ? owner.name : null, dueDate: a.dueDate, completed: a.completed === 1,
      })),
    },
  };
}
