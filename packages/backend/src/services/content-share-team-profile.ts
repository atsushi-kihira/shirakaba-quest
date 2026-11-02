// =============================================================
// 共有：実チーム（緩いチーム・パワーチーム）のプロフィール・役割
// 共有を設定できるのは、チームのリーダー（リーダーが退会しているときは参加中のメンバー）。
// 見せるのは、チーム名・事業のプロフィール・メンバーの役割・公開中の募集人材まで。
// 招待中の人、候補（メンバー・外部人脈）、アクション、提案の履歴は、共有しても見せない。
// =============================================================
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import type { ShareRow, ViewerLevel } from "./content-share.ts";
import { getProfile, loadRoster, parseRoles, parseSteps, resolveSubject } from "./team-workspace.ts";

export type SharedTeamProfileBody = {
  stage: "loose" | "power";
  archived: boolean;
  profile: { businessTitle: string; summary: string; targetCustomers: string; goal: string; firstSteps: string[]; isProvisional: boolean } | null;
  members: { id: string; name: string; emoji: string; bgColor: string; headline: string; isLeader: boolean; role: string | null }[];
  talents: { title: string; profile: string; role: string | null; filled: boolean }[];
};

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
  db: Db, share: ShareRow, _viewerId: string | null, _level: ViewerLevel,
): Promise<{ title: string; body: SharedTeamProfileBody } | null> {
  const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, share.subjectId)).get();
  if (!team) return null;
  // 参加者ではない人の立場で組み立てる：招待中・候補・非公開の募集人材は出ない
  const r = await resolveSubject(db, "team", team.id, "");
  if (!r) return null;
  const [profile, roster] = await Promise.all([
    getProfile(db, "team", team.id),
    loadRoster(db, r.subject, { isActive: false, isPending: false, isLeader: false, leaderGone: false }, ""),
  ]);
  const roles = parseRoles(profile?.rolesJson);

  const body: SharedTeamProfileBody = {
    stage: team.type === "power" ? "power" : "loose",
    archived: team.archived === 1,
    profile: profile ? {
      businessTitle: profile.businessTitle, summary: profile.summary, targetCustomers: profile.targetCustomers,
      goal: profile.goal, firstSteps: parseSteps(profile.firstStepsJson), isProvisional: profile.isProvisional === 1,
    } : null,
    members: roster.members.filter((m) => m.status === "active").map((m) => ({
      id: m.id, name: m.name, emoji: m.emoji, bgColor: m.bgColor, headline: m.headline, isLeader: m.isLeader, role: roles[m.key] ?? null,
    })),
    talents: roster.prospects.filter((p) => p.kind === "talent").map((p) => ({
      title: p.title ?? "", profile: p.profile ?? "", role: roles[p.key] ?? null, filled: p.filled,
    })),
  };
  return { title: team.name, body };
}
