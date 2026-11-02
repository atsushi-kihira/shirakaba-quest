// =============================================================
// 共有：チーム案（作った本人だけが見られる、検討中のチーム）
// 一緒にチーム化を検討する人と話し合えるよう、次のものを見せる（見るだけ）。
//   ・タイトル・ねらい・事業のプロフィール・提案した人（役割つき）
//   ・メンバー案（参加してほしい人の候補：メンバー・外部人脈・来てほしい人のイメージ）。確定していなくても見せる
//   ・次の一歩の提案
//   ・アクション（「本人だけ」にしたものは除く）
// 個人情報は、見る人に応じて絞り込む。
//   ・メンバー：名前・絵文字・職種・役割（メンバー一覧で公開されている範囲）
//   ・外部人脈：共有した人の人脈は、人脈ごとの公開設定のとおり（非公開は出さない／存在のみは名前・会社名を伏せる／全公開は名前・会社名も出す）。
//     ほかの方の人脈は、名前・会社名を伏せ、専門分野・事業の概要だけ（URLで見る人には出さない）
// =============================================================
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import type { ShareRow, ViewerLevel } from "./content-share.ts";
import { buildNextSteps, getProfile, loadRoster, parseRoles, parseSteps, resolveSubject } from "./team-workspace.ts";

export type SharedCandidate =
  | { kind: "member"; id: string; name: string; emoji: string; bgColor: string; headline: string; role: string | null }
  | { kind: "contact"; name: string | null; company: string | null; specialty: string | null; summary: string | null; relationships: string[]; role: string | null; isSharersContact: boolean }
  | { kind: "talent"; title: string; profile: string; role: string | null };

export type SharedDraftBody = {
  goal: string;
  profile: { businessTitle: string; summary: string; targetCustomers: string; firstSteps: string[]; isProvisional: boolean } | null;
  proposer: { id: string; name: string; emoji: string; bgColor: string; headline: string; role: string | null };
  candidates: SharedCandidate[];
  nextSteps: { kind: string; title: string; detail: string }[];
  actions: { task: string; assigneeName: string | null; dueDate: string | null; completed: boolean }[];
};

export async function manageDraft(db: Db, subjectId: string, meId: string): Promise<{ title: string } | null> {
  const d = await db.select({ title: schema.teamDrafts.title }).from(schema.teamDrafts)
    .where(and(eq(schema.teamDrafts.id, subjectId), eq(schema.teamDrafts.ownerMemberId, meId))).get();
  return d ? { title: d.title } : null;
}

export async function titlesForDrafts(db: Db, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 80) {
    const rows = await db.select({ id: schema.teamDrafts.id, title: schema.teamDrafts.title }).from(schema.teamDrafts).where(inArray(schema.teamDrafts.id, ids.slice(i, i + 80))).all();
    for (const r of rows) out.set(r.id, r.title);
  }
  return out;
}

export async function buildDraftView(
  db: Db, share: ShareRow, _viewerId: string | null, level: ViewerLevel,
): Promise<{ title: string; body: SharedDraftBody } | null> {
  const draft = await db.select().from(schema.teamDrafts).where(eq(schema.teamDrafts.id, share.subjectId)).get();
  if (!draft) return null;
  const owner = await db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor, category: schema.members.category })
    .from(schema.members).where(eq(schema.members.id, draft.ownerMemberId)).get();
  if (!owner) return null;
  // 作った本人の立場で、候補・役割・次の一歩を組み立てる（そのうえで、共有する範囲に絞る）
  const resolved = await resolveSubject(db, "draft", draft.id, owner.id);
  if (!resolved) return null;
  const ownerAccess = { isActive: true, isPending: false, isLeader: true, leaderGone: false };
  const [profile, roster, prospectRows, actionRows] = await Promise.all([
    getProfile(db, "draft", draft.id),
    loadRoster(db, resolved.subject, ownerAccess, owner.id),
    db.select().from(schema.teamProspects).where(and(eq(schema.teamProspects.subjectType, "draft"), eq(schema.teamProspects.subjectId, draft.id))).all(),
    db.select().from(schema.collabTeamActionItems).where(eq(schema.collabTeamActionItems.teamId, draft.id)).orderBy(asc(schema.collabTeamActionItems.createdAt)).all(),
  ]);
  const roles = parseRoles(profile?.rolesJson);

  // 外部人脈の候補：公開の設定と、見る人に応じて、名前・会社名を出すかを決める
  const contactIds = roster.prospects.filter((p) => p.kind === "contact").map((p) => p.key.slice(2));
  const contacts = new Map<string, typeof schema.externalContacts.$inferSelect>();
  for (let i = 0; i < contactIds.length; i += 80) {
    for (const c of await db.select().from(schema.externalContacts).where(inArray(schema.externalContacts.id, contactIds.slice(i, i + 80))).all()) contacts.set(c.id, c);
  }

  const candidates: SharedCandidate[] = [];
  for (const p of roster.prospects) {
    if (p.kind === "member") {
      candidates.push({ kind: "member", id: p.memberId ?? "", name: p.name ?? "", emoji: p.emoji ?? "👤", bgColor: p.bgColor ?? "bg-stone-100", headline: p.headline ?? "", role: p.role });
    } else if (p.kind === "talent") {
      candidates.push({ kind: "talent", title: p.title ?? "", profile: p.profile ?? "", role: p.role });
    } else {
      const c = contacts.get(p.key.slice(2));
      if (!c || c.visibility === "private") continue;
      const sharers = c.ownerMemberId === owner.id;
      if (level === "public" && !sharers) continue; // URLで見る人には、ほかの方の人脈を出さない
      const showName = sharers && c.visibility === "full";
      candidates.push({
        kind: "contact", name: showName ? c.name : null, company: showName ? c.company : null,
        specialty: c.specialty, summary: p.summary ?? null, relationships: p.relationships ?? [], role: p.role, isSharersContact: sharers,
      });
    }
  }

  const added = new Map(prospectRows.map((r) => [r.id, r.createdAt]));
  const steps = buildNextSteps(resolved.subject, profile, roster, actionRows.map((a) => a.task), false, added);

  return {
    title: draft.title,
    body: {
      goal: draft.goal,
      profile: profile ? {
        businessTitle: profile.businessTitle, summary: profile.summary, targetCustomers: profile.targetCustomers,
        firstSteps: parseSteps(profile.firstStepsJson), isProvisional: profile.isProvisional === 1,
      } : null,
      proposer: { id: owner.id, name: owner.name, emoji: owner.emoji, bgColor: owner.bgColor, headline: owner.category, role: roles[`m:${owner.id}`] ?? null },
      candidates,
      // 内部の参照（refKey・text）は出さない
      nextSteps: steps.map((s) => ({ kind: s.kind, title: s.title, detail: s.detail })),
      actions: actionRows.filter((a) => a.visibility !== "private").map((a) => ({
        task: a.task, assigneeName: a.assigneeMemberId === owner.id ? owner.name : null, dueDate: a.dueDate, completed: a.completed === 1,
      })),
    },
  };
}
