// =============================================================
// 共有：チーム案（作った本人だけが見られる、検討中のチーム）
// 一緒にチーム化を検討する人と話し合えるよう、次のものを見せる（見るだけ）。
//   ・タイトル・ねらい・事業のプロフィール・提案した人（役割つき）
//   ・メンバー案（候補）・次の一歩の提案・アクション（content-share-plan.ts。個人情報の絞り込みもそちら）
// =============================================================
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import type { ShareRow, ViewerLevel } from "./content-share.ts";
import { buildPlanContext, type SharedPlan } from "./content-share-plan.ts";
import { parseSteps } from "./team-workspace.ts";

export type SharedDraftBody = {
  goal: string;
  profile: { businessTitle: string; summary: string; targetCustomers: string; firstSteps: string[]; isProvisional: boolean } | null;
  proposer: { id: string; name: string; emoji: string; bgColor: string; headline: string; role: string | null };
} & SharedPlan;

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
  const ctx = await buildPlanContext(db, "draft", draft.id, owner.id, level);
  if (!ctx) return null;
  const profile = ctx.profile;
  return {
    title: draft.title,
    body: {
      goal: draft.goal,
      profile: profile ? {
        businessTitle: profile.businessTitle, summary: profile.summary, targetCustomers: profile.targetCustomers,
        firstSteps: parseSteps(profile.firstStepsJson), isProvisional: profile.isProvisional === 1,
      } : null,
      proposer: { id: owner.id, name: owner.name, emoji: owner.emoji, bgColor: owner.bgColor, headline: owner.category, role: ctx.roles[`m:${owner.id}`] ?? null },
      ...ctx.plan,
    },
  };
}
