// =============================================================
// 協働チームの「検討中のチーム案」（作った本人だけに見えるローカルな案。誰の承諾も得ていない段階）
// GET    /api/collab/team-drafts                          — 自分のチーム案の一覧
// POST   /api/collab/team-drafts                          — チーム案を作る（メンバーはあとから選ぶ）
// POST   /api/collab/team-drafts/create-from-members      — メンバーを選んで、チーム案のタイトル・協業内容・役割をAIに考えてもらう
// POST   /api/collab/team-drafts/create-from-idea         — タイトルと協業内容から、チームメンバー案（自分を含む）・協業内容・役割をAIに考えてもらう
// POST   /api/collab/team-drafts/:id/promote              — 緩いチーム／パワーチームにする（中核のメンバーを選ぶ。選ばなかった人は「候補」としてチームに残る）
// DELETE /api/collab/team-drafts/:id                      — チーム案を削除する
// チーム案の詳細・プロフィール・メンバーの追加／削除・AIによる再検討は、チーム育成の共通の画面用 API（/api/collab/workspace/draft/:id）で行う。
// 構成は、自分自身（常に含む）＋メンバー＋自分の外部人脈＋募集人材で、合計10名まで。他のユーザーには見えない。
// =============================================================
import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId } from "../services/auth.ts";
import { isMemberApproved, resolveEffectiveMemberId } from "../services/resolve-member.ts";
import { loadProfiles } from "../services/member-collab.ts";
import { generateTeamDraftIdeas, proposeTeamFromIdea, type DraftParticipant, type TeamDraftIdeas } from "../services/team-draft-ideas.ts";
import {
  MAX_PEOPLE, buildAiPeople, deleteTeamWorkspaceData, hasProfileContent, getProfile, loadRoster, loadSuggestionPool, onTeamCreated, resolveSubject, saveProfile,
} from "../services/team-workspace.ts";
import type { Env, Variables } from "../types.ts";

export const collabTeamDraftRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
collabTeamDraftRoutes.use("*", authMiddleware);

const TITLE_MAX = 60;
const GOAL_MAX = 1000;
const DEFAULT_DRAFT_TITLE = "新しいチーム案";

type Db = ReturnType<typeof createDb>;
const err = (code: string, message: string) => ({ error: { code, message } });
const nowSec = () => Math.floor(Date.now() / 1000);

async function resolveMe(c: { get: (k: "userId" | "userType") => never | string }, db: Db): Promise<string | null> {
  const meId = await resolveEffectiveMemberId(db, c.get("userId") as string, c.get("userType") as "member" | "admin");
  if (!meId || !(await isMemberApproved(db, meId))) return null;
  return meId;
}

const uniqueIds = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && x.length > 0))];

/** 指定されたメンバー・外部人脈が有効か確認する（メンバーは承認済みで本人以外、人脈は本人のもの）。問題があれば利用者向けのメッセージを返す */
async function validateSelection(db: Db, meId: string, memberIds: string[], contactIds: string[]): Promise<string | null> {
  if (1 + memberIds.length + contactIds.length > MAX_PEOPLE) return `チーム案は、自分を含めて最大${MAX_PEOPLE}名までです`;
  if (memberIds.length > 0) {
    const rows = await db.select({ id: schema.members.id }).from(schema.members)
      .where(and(inArray(schema.members.id, memberIds), eq(schema.members.status, "active"))).all();
    if (rows.length !== memberIds.length) return "選べないメンバーが含まれています。画面を開き直して、選び直してください";
  }
  if (contactIds.length > 0) {
    const rows = await db.select({ id: schema.externalContacts.id }).from(schema.externalContacts)
      .where(and(inArray(schema.externalContacts.id, contactIds), eq(schema.externalContacts.ownerMemberId, meId))).all();
    if (rows.length !== contactIds.length) return "選べない外部人脈が含まれています。画面を開き直して、選び直してください";
  }
  return null;
}

async function insertProspects(db: Db, draftId: string, meId: string, memberIds: string[], contactIds: string[], now: number): Promise<void> {
  const rows = [
    ...memberIds.map((refId) => ({ kind: "member" as const, refId, ownerMemberId: null as string | null })),
    ...contactIds.map((refId) => ({ kind: "contact" as const, refId, ownerMemberId: meId as string | null })),
  ];
  for (const r of rows) {
    await db.insert(schema.teamProspects).values({
      id: newId(), subjectType: "draft", subjectId: draftId, kind: r.kind, refId: r.refId, ownerMemberId: r.ownerMemberId, locked: 0, published: 0, addedBy: meId, createdAt: now,
    }).onConflictDoNothing();
  }
}

/**
 * AIの最初のまとめを、そのままプロフィール・役割・募集人材に反映する（チーム案を新しく作る依頼そのものなので、確認は求めない）。
 * 2回目以降の再検討は、提案として残り、リーダー（作成者）が情報ごとに反映を選ぶ。
 */
async function adoptInitialIdeas(db: Db, draftId: string, meId: string, ideas: TeamDraftIdeas, validKeys: Set<string>, now: number): Promise<void> {
  const roles = Object.fromEntries(ideas.roles.filter((r) => validKeys.has(r.key)).map((r) => [r.key, r.role]));
  const talents = (ideas.desiredTalents ?? []).slice(0, 3);
  const talentIds: string[] = [];
  for (const t of talents) {
    const id = newId();
    talentIds.push(id);
    await db.insert(schema.teamProspects).values({
      id, subjectType: "draft", subjectId: draftId, kind: "talent", refId: null, locked: 0, talentTitle: t.title, talentProfile: t.profile, talentReason: t.reason,
      published: 0, addedBy: meId, createdAt: now,
    });
    if (t.role) roles[`t:${id}`] = t.role;
  }
  await saveProfile(db, "draft", draftId, {
    businessTitle: ideas.businessTitle, summary: ideas.summary, targetCustomers: ideas.targetCustomers ?? "",
    firstStepsJson: JSON.stringify(ideas.firstSteps), rolesJson: JSON.stringify(roles), isProvisional: 0, confirmedAt: now,
  }, meId);
}

// ---- 一覧 ----
collabTeamDraftRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveMe(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const drafts = await db.select().from(schema.teamDrafts).where(eq(schema.teamDrafts.ownerMemberId, meId))
    .orderBy(desc(schema.teamDrafts.updatedAt)).all();
  const counts = new Map<string, number>();
  const withIdeas = new Set<string>();
  if (drafts.length > 0) {
    const ids = drafts.map((d) => d.id);
    const rows = await db.select({ subjectId: schema.teamProspects.subjectId }).from(schema.teamProspects)
      .where(and(eq(schema.teamProspects.subjectType, "draft"), inArray(schema.teamProspects.subjectId, ids))).all();
    for (const r of rows) counts.set(r.subjectId, (counts.get(r.subjectId) ?? 0) + 1);
    const profiles = await db.select().from(schema.teamProfiles).where(and(eq(schema.teamProfiles.subjectType, "draft"), inArray(schema.teamProfiles.subjectId, ids))).all();
    for (const p of profiles) if (hasProfileContent(p)) withIdeas.add(p.subjectId);
  }
  return c.json({ data: drafts.map((d) => ({
    id: d.id, title: d.title, memberCount: 1 + (counts.get(d.id) ?? 0), hasIdeas: withIdeas.has(d.id) || !!d.ideasJson, updatedAt: d.updatedAt,
  })) });
});

// ---- 作成 ----
collabTeamDraftRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveMe(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const body = await c.req.json<{ title?: string; goal?: string; memberIds?: unknown; contactIds?: unknown }>().catch(() => ({} as { title?: string; goal?: string; memberIds?: unknown; contactIds?: unknown }));
  const title = (body.title ?? "").trim();
  const goal = (body.goal ?? "").trim();
  if (!title) return c.json(err("invalid_input", "チーム案のタイトルを入力してください"), 400);
  if (title.length > TITLE_MAX) return c.json(err("invalid_input", `タイトルは${TITLE_MAX}文字以内で入力してください`), 400);
  if (goal.length > GOAL_MAX) return c.json(err("invalid_input", `考えたいことは${GOAL_MAX}文字以内で入力してください`), 400);
  const memberIds = uniqueIds(body.memberIds).filter((id) => id !== meId);
  const contactIds = uniqueIds(body.contactIds);
  const problem = await validateSelection(db, meId, memberIds, contactIds);
  if (problem) return c.json(err("invalid_input", problem), 400);

  const now = nowSec();
  const id = newId();
  await db.insert(schema.teamDrafts).values({ id, ownerMemberId: meId, title, goal, ideasJson: null, ideasGeneratedAt: null, createdAt: now, updatedAt: now });
  await insertProspects(db, id, meId, memberIds, contactIds, now);
  return c.json({ data: { id } }, 201);
});

// ---- (1) メンバーを選んで、チーム案のタイトル・協業内容・役割をAIに考えてもらう ----
collabTeamDraftRoutes.post("/create-from-members", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveMe(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const b = await c.req.json<{ memberIds?: unknown; contactIds?: unknown; goal?: string }>().catch(() => ({} as { memberIds?: unknown; contactIds?: unknown; goal?: string }));
  const goal = (b.goal ?? "").trim();
  if (goal.length > GOAL_MAX) return c.json(err("invalid_input", `考えたい方向性は${GOAL_MAX}文字以内で入力してください`), 400);
  const memberIds = uniqueIds(b.memberIds).filter((id) => id !== meId);
  const contactIds = uniqueIds(b.contactIds);
  if (memberIds.length + contactIds.length < 1) return c.json(err("invalid_input", "自分のほかに、メンバーまたは外部人脈を1名以上選んでください"), 400);
  const problem = await validateSelection(db, meId, memberIds, contactIds);
  if (problem) return c.json(err("invalid_input", problem), 400);

  const now = nowSec();
  const id = newId();
  await db.insert(schema.teamDrafts).values({ id, ownerMemberId: meId, title: DEFAULT_DRAFT_TITLE, goal, ideasJson: null, ideasGeneratedAt: null, createdAt: now, updatedAt: now });
  await insertProspects(db, id, meId, memberIds, contactIds, now);

  const resolved = (await resolveSubject(db, "draft", id, meId))!;
  const roster = await loadRoster(db, resolved.subject, resolved.access, meId);
  const people = await buildAiPeople(db, resolved.subject, roster);
  // タイトル・協業内容・役割はAIに考えてもらう。うまくいかなくてもチーム案は残し、画面から「再検討」ができる
  const ideas = await generateTeamDraftIdeas({
    apiKey: c.env.ANTHROPIC_API_KEY, isDev: c.env.ENVIRONMENT === "development", title: "", goal, people, maxTalents: Math.max(0, MAX_PEOPLE - people.length),
  });
  if (ideas) {
    await db.update(schema.teamDrafts).set({ title: (ideas.teamTitle || ideas.businessTitle || DEFAULT_DRAFT_TITLE).slice(0, TITLE_MAX), updatedAt: now }).where(eq(schema.teamDrafts.id, id));
    await adoptInitialIdeas(db, id, meId, ideas, new Set(people.map((p) => p.key)), now);
  }
  return c.json({ data: { id }, aiFailed: !ideas }, 201);
});

// ---- (2) タイトルと協業内容から、チームメンバー案（自分を含む）・協業内容・役割をAIに考えてもらう ----
collabTeamDraftRoutes.post("/create-from-idea", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveMe(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const body = await c.req.json<{ title?: string; goal?: string }>().catch(() => ({} as { title?: string; goal?: string }));
  const title = (body.title ?? "").trim();
  const goal = (body.goal ?? "").trim();
  if (!title) return c.json(err("invalid_input", "チーム案のタイトルを入力してください"), 400);
  if (title.length > TITLE_MAX) return c.json(err("invalid_input", `タイトルは${TITLE_MAX}文字以内で入力してください`), 400);
  if (!goal) return c.json(err("invalid_input", "どんな協業を考えたいかを入力してください"), 400);
  if (goal.length > GOAL_MAX) return c.json(err("invalid_input", `考えたい協業は${GOAL_MAX}文字以内で入力してください`), 400);

  const candidates = await loadSuggestionPool(db, meId, new Set([`m:${meId}`]));
  if (candidates.length === 0) return c.json(err("invalid_input", "候補になるメンバー・外部人脈がまだいません。外部人脈を登録するか、メンバーの登録を待ってからお試しください"), 400);
  const mine = (await loadProfiles(db, [meId]))[0];
  const me: DraftParticipant = {
    key: `m:${meId}`, kind: "member", name: mine?.name ?? "あなた", status: "active", locked: true,
    profile: [mine?.category && `職種: ${mine.category}`, mine?.businessDescription && `事業内容: ${mine.businessDescription}`,
      mine && mine.skills.length > 0 && `USP: ${mine.skills.map((s) => (s.description ? `${s.name}（${s.description}）` : s.name)).join(" ／ ")}`].filter(Boolean).join(" / ") || "（情報の登録なし）",
  };
  const proposal = await proposeTeamFromIdea({
    apiKey: c.env.ANTHROPIC_API_KEY, isDev: c.env.ENVIRONMENT === "development", title, goal, me, candidates, maxOthers: MAX_PEOPLE - 1,
  });
  if (!proposal) return c.json(err("ai_failed", "チームメンバー案を考えられませんでした。少し時間をおいて、もう一度お試しください"), 502);

  const memberIds = proposal.otherKeys.filter((k) => k.startsWith("m:")).map((k) => k.slice(2));
  const contactIds = proposal.otherKeys.filter((k) => k.startsWith("c:")).map((k) => k.slice(2));
  const problem = await validateSelection(db, meId, memberIds, contactIds);
  if (problem) return c.json(err("ai_failed", "チームメンバー案を考えられませんでした。もう一度お試しください"), 502);

  const now = nowSec();
  const id = newId();
  await db.insert(schema.teamDrafts).values({ id, ownerMemberId: meId, title, goal, ideasJson: null, ideasGeneratedAt: null, createdAt: now, updatedAt: now });
  await insertProspects(db, id, meId, memberIds, contactIds, now);
  await adoptInitialIdeas(db, id, meId, proposal.ideas, new Set([`m:${meId}`, ...proposal.otherKeys]), now);
  return c.json({ data: { id } }, 201);
});

// ---- 緩いチーム／パワーチームにする（中核のメンバーを選ぶ） ----
// ・中核に選んだメンバー：緩いチームは正式メンバー（承諾なし）、パワーチームは承諾待ち（従来どおり）
// ・選ばなかったメンバー・外部人脈：候補としてチームに残る。募集人材・プロフィール・役割・提案・アクションも、そのまま引き継ぐ
collabTeamDraftRoutes.post("/:id/promote", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveMe(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const draft = await db.select().from(schema.teamDrafts).where(and(eq(schema.teamDrafts.id, c.req.param("id")), eq(schema.teamDrafts.ownerMemberId, meId))).get();
  if (!draft) return c.json(err("not_found", "チーム案が見つかりません"), 404);
  const body = await c.req.json<{ type?: string; name?: string; coreMemberIds?: unknown }>().catch(() => ({} as { type?: string; name?: string; coreMemberIds?: unknown }));
  if (body.type !== "loose" && body.type !== "power") return c.json(err("invalid_input", "チームの種類（緩いチーム／パワーチーム）を選んでください"), 400);
  const name = (body.name ?? draft.title).trim();
  if (!name) return c.json(err("invalid_input", "チーム名を入力してください"), 400);

  const prospectRows = await db.select().from(schema.teamProspects)
    .where(and(eq(schema.teamProspects.subjectType, "draft"), eq(schema.teamProspects.subjectId, draft.id), eq(schema.teamProspects.kind, "member"))).all();
  const candidateIds = new Set(prospectRows.map((r) => r.refId).filter((x): x is string => !!x));
  const core = uniqueIds(body.coreMemberIds).filter((id) => id !== meId && candidateIds.has(id));
  if (core.length < 1) return c.json(err("invalid_input", "最初から参加する中核のメンバーを、自分のほかに1名以上選んでください（外部人脈の方は、正式なチームには入れません）"), 400);
  const active = (await db.select({ id: schema.members.id }).from(schema.members).where(and(inArray(schema.members.id, core), eq(schema.members.status, "active"))).all()).map((r) => r.id);
  if (active.length !== core.length) return c.json(err("invalid_input", "選べないメンバーが含まれています。画面を開き直して、選び直してください"), 400);

  const now = nowSec();
  const teamId = newId();
  await db.insert(schema.collabTeams).values({ id: teamId, name, type: body.type, createdBy: meId, createdAt: now, archived: 0 });
  if (body.type === "loose") {
    // 緩いチームは承諾なしですぐ成立する
    await db.insert(schema.collabTeamMembers).values([meId, ...active].map((memberId) => ({
      id: newId(), teamId, memberId, status: "active" as const, invitedBy: memberId === meId ? null : meId, respondedAt: now, createdAt: now,
    })));
  } else {
    // パワーチームは、他のメンバーに承諾の確認が届き、全員が承諾すると成立する
    await db.insert(schema.collabTeamMembers).values([
      { id: newId(), teamId, memberId: meId, status: "active" as const, invitedBy: null, respondedAt: now, createdAt: now },
      ...active.map((memberId) => ({ id: newId(), teamId, memberId, status: "pending" as const, invitedBy: meId, respondedAt: null, createdAt: now })),
    ]);
  }

  // 中核になった人は候補ではなくなる。残りの候補・募集人材・プロフィール・提案・アクションは、チームに付け替える
  await db.delete(schema.teamProspects).where(and(eq(schema.teamProspects.subjectType, "draft"), eq(schema.teamProspects.subjectId, draft.id), eq(schema.teamProspects.kind, "member"), inArray(schema.teamProspects.refId, active)));
  await db.update(schema.teamProspects).set({ subjectType: "team", subjectId: teamId }).where(and(eq(schema.teamProspects.subjectType, "draft"), eq(schema.teamProspects.subjectId, draft.id)));
  await db.update(schema.teamProfileProposals).set({ subjectType: "team", subjectId: teamId }).where(and(eq(schema.teamProfileProposals.subjectType, "draft"), eq(schema.teamProfileProposals.subjectId, draft.id)));
  await db.update(schema.collabTeamActionItems).set({ teamId }).where(eq(schema.collabTeamActionItems.teamId, draft.id));
  const profile = await getProfile(db, "draft", draft.id);
  if (profile) {
    await db.update(schema.teamProfiles).set({ subjectType: "team", subjectId: teamId, goal: draft.goal }).where(eq(schema.teamProfiles.id, profile.id));
  } else {
    await saveProfile(db, "team", teamId, { goal: draft.goal }, meId);
  }
  await onTeamCreated(db, teamId);
  await db.delete(schema.teamDraftMembers).where(eq(schema.teamDraftMembers.draftId, draft.id));
  await db.delete(schema.teamDrafts).where(eq(schema.teamDrafts.id, draft.id));

  const remaining = await db.select({ id: schema.teamProspects.id }).from(schema.teamProspects).where(and(eq(schema.teamProspects.subjectType, "team"), eq(schema.teamProspects.subjectId, teamId))).all();
  return c.json({ data: { teamId, type: body.type, memberCount: 1 + active.length, candidateCount: remaining.length } }, 201);
});

// ---- 削除 ----
collabTeamDraftRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveMe(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const draft = await db.select().from(schema.teamDrafts).where(and(eq(schema.teamDrafts.id, c.req.param("id")), eq(schema.teamDrafts.ownerMemberId, meId))).get();
  if (!draft) return c.json(err("not_found", "チーム案が見つかりません"), 404);
  await deleteTeamWorkspaceData(db, "draft", draft.id);
  await db.delete(schema.collabTeamActionItems).where(eq(schema.collabTeamActionItems.teamId, draft.id));
  await db.delete(schema.teamDraftMembers).where(eq(schema.teamDraftMembers.draftId, draft.id));
  await db.delete(schema.teamDrafts).where(eq(schema.teamDrafts.id, draft.id));
  return c.json({ ok: true });
});
