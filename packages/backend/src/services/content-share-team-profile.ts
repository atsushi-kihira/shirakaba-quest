// =============================================================
// 共有：実チーム（緩いチーム・パワーチーム）のプロフィール・役割
// 共有を設定できるのは、チームのリーダー（リーダーが退会しているときは参加中のメンバー）。
// 見せるのは、チーム名・事業のプロフィール・メンバーの役割・メンバー案（候補・招待中・来てほしい人）・次の一歩の提案・アクション。
// 提案の履歴・役割変更の申請などは、共有しても見せない。個人情報の絞り込みは content-share-plan.ts。
// =============================================================
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import type { ShareRow, ViewerLevel } from "./content-share.ts";
import { buildPlanContext, type SharedPlan } from "./content-share-plan.ts";
import { parseSteps, resolveSubject } from "./team-workspace.ts";

export type SharedTeamProfileBody = {
  stage: "loose" | "power";
  archived: boolean;
  profile: { businessTitle: string; summary: string; targetCustomers: string; goal: string; firstSteps: string[]; isProvisional: boolean } | null;
  members: { id: string; name: string; emoji: string; bgColor: string; headline: string; isLeader: boolean; role: string | null }[];
} & SharedPlan;

export async function manageTeamProfile(db: Db, teamId: string, meId: string): Promise<{ title: string } | null> {
  const r = await resolveSubject(db, "team", teamId, meId);
  if (!r || !r.access.isLeader) return null;
  return { title: r.subject.title };
}

export async function titlesForTeamProfiles(db: Db, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 80) {
    const rows = await db.select({ id: schema.collabTeams.id, name: schema.collabTeams.name }).from(schema.collabTeams).where(inArray(schema.collabTeams.id, ids.slice(i, i + 80))).all();
    for (const r of rows) out.set(r.id, r.name);
  }
  return out;
}

export async function buildTeamProfileView(
  db: Db, share: ShareRow, _viewerId: string | null, level: ViewerLevel,
): Promise<{ title: string; body: SharedTeamProfileBody } | null> {
  const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, share.subjectId)).get();
  if (!team) return null;
  // 共有を設定した人（リーダー）の立場で組み立てる
  const ctx = await buildPlanContext(db, "team", team.id, share.ownerMemberId, level);
  if (!ctx) return null;
  const profile = ctx.profile;
  return {
    title: team.name,
    body: {
      stage: team.type === "power" ? "power" : "loose",
      archived: team.archived === 1,
      profile: profile ? {
        businessTitle: profile.businessTitle, summary: profile.summary, targetCustomers: profile.targetCustomers,
        goal: profile.goal, firstSteps: parseSteps(profile.firstStepsJson), isProvisional: profile.isProvisional === 1,
      } : null,
      members: ctx.roster.members.filter((m) => m.status === "active").map((m) => ({
        id: m.id, name: m.name, emoji: m.emoji, bgColor: m.bgColor, headline: m.headline, isLeader: m.isLeader, role: ctx.roles[m.key] ?? null,
      })),
      ...ctx.plan,
    },
  };
}
