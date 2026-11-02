// =============================================================
// 共有：チーム案（作った本人だけが見られる、検討中のチーム）
// 見せるのは、タイトル・事業のプロフィール・提案した人（役割つき）・募集したい人物像まで。
// 候補のメンバー・外部人脈は、まだ誰の承諾も得ていないので、共有しても見せない。
// =============================================================
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import type { ShareRow, ViewerLevel } from "./content-share.ts";
import { getProfile, parseRoles, parseSteps } from "./team-workspace.ts";

export type SharedDraftBody = {
  goal: string;
  profile: { businessTitle: string; summary: string; targetCustomers: string; firstSteps: string[]; isProvisional: boolean } | null;
  proposer: { id: string; name: string; emoji: string; bgColor: string; headline: string; role: string | null };
  talents: { title: string; profile: string; role: string | null }[];
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
  db: Db, share: ShareRow, _viewerId: string | null, _level: ViewerLevel,
): Promise<{ title: string; body: SharedDraftBody } | null> {
  const draft = await db.select().from(schema.teamDrafts).where(eq(schema.teamDrafts.id, share.subjectId)).get();
  if (!draft) return null;
  const [profile, owner, prospects] = await Promise.all([
    getProfile(db, "draft", draft.id),
    db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor, category: schema.members.category })
      .from(schema.members).where(eq(schema.members.id, draft.ownerMemberId)).get(),
    db.select().from(schema.teamProspects).where(and(eq(schema.teamProspects.subjectType, "draft"), eq(schema.teamProspects.subjectId, draft.id))).all(),
  ]);
  if (!owner) return null;
  const roles = parseRoles(profile?.rolesJson);
  return {
    title: draft.title,
    body: {
      goal: draft.goal,
      profile: profile ? {
        businessTitle: profile.businessTitle, summary: profile.summary, targetCustomers: profile.targetCustomers,
        firstSteps: parseSteps(profile.firstStepsJson), isProvisional: profile.isProvisional === 1,
      } : null,
      proposer: { id: owner.id, name: owner.name, emoji: owner.emoji, bgColor: owner.bgColor, headline: owner.category, role: roles[`m:${owner.id}`] ?? null },
      talents: prospects.filter((p) => p.kind === "talent").map((p) => ({ title: p.talentTitle ?? "", profile: p.talentProfile ?? "", role: roles[`t:${p.id}`] ?? null })),
    },
  };
}
