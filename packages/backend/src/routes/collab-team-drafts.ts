// =============================================================
// 協働チームの「検討中のチーム案」（作った本人だけに見えるローカルな案）
// GET    /api/collab/team-drafts              — 自分のチーム案の一覧
// POST   /api/collab/team-drafts              — チーム案を作る
// GET    /api/collab/team-drafts/:id          — チーム案の詳細（構成メンバー・協働事業と役割のまとめ）
// PATCH  /api/collab/team-drafts/:id          — タイトル・目的・構成メンバー（追加・削除）の更新
// POST   /api/collab/team-drafts/:id/generate — 協働事業と役割をまとめる（まとめ直し）
// POST   /api/collab/team-drafts/:id/promote  — 緩いチーム／パワーチームとして正式に昇格させる
// DELETE /api/collab/team-drafts/:id          — チーム案を削除する
// 構成は、自分自身（常に含む）＋メンバー＋自分の外部人脈で、合計10名まで。他のユーザーには見えない。
// =============================================================
import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId } from "../services/auth.ts";
import { isMemberApproved, resolveEffectiveMemberId } from "../services/resolve-member.ts";
import { loadProfiles } from "../services/member-collab.ts";
import { generateTeamDraftIdeas, type DraftParticipant, type TeamDraftIdeas } from "../services/team-draft-ideas.ts";
import type { Env, Variables } from "../types.ts";

export const collabTeamDraftRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
collabTeamDraftRoutes.use("*", authMiddleware);

export const MAX_TEAM_DRAFT_MEMBERS = 10; // 自分を含む
const TITLE_MAX = 60;
const GOAL_MAX = 1000;

type Db = ReturnType<typeof createDb>;
const err = (code: string, message: string) => ({ error: { code, message } });

async function resolveMe(c: { get: (k: "userId" | "userType") => never | string }, db: Db): Promise<string | null> {
  const meId = await resolveEffectiveMemberId(db, c.get("userId") as string, c.get("userType") as "member" | "admin");
  if (!meId || !(await isMemberApproved(db, meId))) return null;
  return meId;
}

async function ownDraft(db: Db, id: string, meId: string) {
  return (await db.select().from(schema.teamDrafts)
    .where(and(eq(schema.teamDrafts.id, id), eq(schema.teamDrafts.ownerMemberId, meId))).get()) ?? null;
}

const uniqueIds = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && x.length > 0))];

/** 指定されたメンバー・外部人脈が有効か確認する（メンバーは承認済みで本人以外、人脈は本人のもの）。問題があれば利用者向けのメッセージを返す */
async function validateSelection(db: Db, meId: string, memberIds: string[], contactIds: string[]): Promise<string | null> {
  if (1 + memberIds.length + contactIds.length > MAX_TEAM_DRAFT_MEMBERS) {
    return `チーム案は、自分を含めて最大${MAX_TEAM_DRAFT_MEMBERS}名までです`;
  }
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

type DraftMemberView = { kind: "member" | "contact"; id: string; name: string; emoji: string; bgColor: string; headline: string; isMe: boolean };

/** 構成メンバーの表示用情報と、AIに渡す情報（自分が先頭） */
async function loadParticipants(db: Db, meId: string, draftId: string): Promise<{ views: DraftMemberView[]; people: DraftParticipant[] }> {
  const rows = await db.select().from(schema.teamDraftMembers).where(eq(schema.teamDraftMembers.draftId, draftId))
    .orderBy(schema.teamDraftMembers.createdAt).all();
  const memberIds = [meId, ...rows.filter((r) => r.kind === "member").map((r) => r.refId)];
  const contactIds = rows.filter((r) => r.kind === "contact").map((r) => r.refId);
  const profiles = await loadProfiles(db, memberIds);
  const contacts = contactIds.length > 0
    ? await db.select().from(schema.externalContacts).where(and(inArray(schema.externalContacts.id, contactIds), eq(schema.externalContacts.ownerMemberId, meId))).all()
    : [];
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  const views: DraftMemberView[] = [];
  const people: DraftParticipant[] = [];
  for (const p of profiles) {
    const parts = [p.category && `職種: ${p.category}`, p.businessDescription && `事業内容: ${p.businessDescription}`,
      p.skills.length > 0 && `USP: ${p.skills.map((s) => (s.description ? `${s.name}（${s.description}）` : s.name)).join(" ／ ")}`].filter(Boolean);
    views.push({ kind: "member", id: p.id, name: p.name, emoji: p.emoji, bgColor: p.bgColor, headline: p.category, isMe: p.id === meId });
    people.push({ key: `m:${p.id}`, kind: "member", name: p.name, profile: parts.join(" / ") || "（情報の登録なし）" });
  }
  // 自分が先頭、そのあとは追加した順
  const meIdx = views.findIndex((v) => v.isMe);
  if (meIdx > 0) { views.unshift(...views.splice(meIdx, 1)); people.unshift(...people.splice(meIdx, 1)); }
  for (const id of contactIds) {
    const c = contactById.get(id);
    if (!c) continue;
    const parts = [c.specialty && `専門分野: ${c.specialty}`, c.company && `会社・屋号: ${c.company}`, c.businessSummary && `事業概要: ${c.businessSummary}`, c.note && `備考: ${c.note}`].filter(Boolean);
    views.push({ kind: "contact", id: c.id, name: c.name, emoji: "👤", bgColor: "bg-stone-100", headline: c.specialty ?? c.company ?? "", isMe: false });
    people.push({ key: `c:${c.id}`, kind: "contact", name: c.name, profile: parts.join(" / ") || "（情報の登録なし）" });
  }
  return { views, people };
}

async function buildDetail(db: Db, meId: string, draft: typeof schema.teamDrafts.$inferSelect) {
  const { views, people } = await loadParticipants(db, meId, draft.id);
  let ideas: TeamDraftIdeas | null = null;
  try { ideas = draft.ideasJson ? (JSON.parse(draft.ideasJson) as TeamDraftIdeas) : null; } catch { ideas = null; }
  const currentKeys = people.map((p) => p.key).sort().join("|");
  const ideasStale = !!ideas && (ideas.participantKeys.join("|") !== currentKeys || ideas.goal !== draft.goal);
  return {
    id: draft.id, title: draft.title, goal: draft.goal, createdAt: draft.createdAt, updatedAt: draft.updatedAt,
    members: views, ideas, ideasStale, maxMembers: MAX_TEAM_DRAFT_MEMBERS,
  };
}

async function replaceMembers(db: Db, draftId: string, memberIds: string[], contactIds: string[], now: number) {
  await db.delete(schema.teamDraftMembers).where(eq(schema.teamDraftMembers.draftId, draftId));
  const rows = [
    ...memberIds.map((refId) => ({ id: newId(), draftId, kind: "member" as const, refId, createdAt: now })),
    ...contactIds.map((refId) => ({ id: newId(), draftId, kind: "contact" as const, refId, createdAt: now })),
  ];
  if (rows.length > 0) await db.insert(schema.teamDraftMembers).values(rows);
}

// ---- 一覧 ----
collabTeamDraftRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveMe(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const drafts = await db.select().from(schema.teamDrafts).where(eq(schema.teamDrafts.ownerMemberId, meId))
    .orderBy(desc(schema.teamDrafts.updatedAt)).all();
  const counts = new Map<string, number>();
  if (drafts.length > 0) {
    const rows = await db.select({ draftId: schema.teamDraftMembers.draftId }).from(schema.teamDraftMembers)
      .where(inArray(schema.teamDraftMembers.draftId, drafts.map((d) => d.id))).all();
    for (const r of rows) counts.set(r.draftId, (counts.get(r.draftId) ?? 0) + 1);
  }
  return c.json({ data: drafts.map((d) => ({
    id: d.id, title: d.title, memberCount: 1 + (counts.get(d.id) ?? 0), hasIdeas: !!d.ideasJson, updatedAt: d.updatedAt,
  })) });
});

// ---- 作成 ----
collabTeamDraftRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveMe(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const body = await c.req.json<{ title?: string; goal?: string; memberIds?: string[]; contactIds?: string[] }>().catch(() => ({} as { title?: string }));
  const title = (body.title ?? "").trim();
  const goal = ((body as { goal?: string }).goal ?? "").trim();
  if (!title) return c.json(err("invalid_input", "チーム案のタイトルを入力してください"), 400);
  if (title.length > TITLE_MAX) return c.json(err("invalid_input", `タイトルは${TITLE_MAX}文字以内で入力してください`), 400);
  if (goal.length > GOAL_MAX) return c.json(err("invalid_input", `考えたいことは${GOAL_MAX}文字以内で入力してください`), 400);
  const memberIds = uniqueIds((body as { memberIds?: unknown }).memberIds).filter((id) => id !== meId);
  const contactIds = uniqueIds((body as { contactIds?: unknown }).contactIds);
  const problem = await validateSelection(db, meId, memberIds, contactIds);
  if (problem) return c.json(err("invalid_input", problem), 400);

  const now = Math.floor(Date.now() / 1000);
  const id = newId();
  await db.insert(schema.teamDrafts).values({ id, ownerMemberId: meId, title, goal, ideasJson: null, ideasGeneratedAt: null, createdAt: now, updatedAt: now });
  await replaceMembers(db, id, memberIds, contactIds, now);
  return c.json({ data: { id } }, 201);
});

// ---- 詳細 ----
collabTeamDraftRoutes.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveMe(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const draft = await ownDraft(db, c.req.param("id"), meId);
  if (!draft) return c.json(err("not_found", "チーム案が見つかりません"), 404);
  return c.json({ data: await buildDetail(db, meId, draft) });
});

// ---- 更新（タイトル・目的・構成メンバーの追加／削除） ----
collabTeamDraftRoutes.patch("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveMe(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const draft = await ownDraft(db, c.req.param("id"), meId);
  if (!draft) return c.json(err("not_found", "チーム案が見つかりません"), 404);
  const body = await c.req.json<{ title?: string; goal?: string; memberIds?: unknown; contactIds?: unknown }>().catch(() => ({} as { title?: string }));

  const patch: Partial<typeof schema.teamDrafts.$inferInsert> = {};
  const b = body as { title?: string; goal?: string; memberIds?: unknown; contactIds?: unknown };
  if (b.title !== undefined) {
    const title = b.title.trim();
    if (!title) return c.json(err("invalid_input", "チーム案のタイトルを入力してください"), 400);
    if (title.length > TITLE_MAX) return c.json(err("invalid_input", `タイトルは${TITLE_MAX}文字以内で入力してください`), 400);
    patch.title = title;
  }
  if (b.goal !== undefined) {
    const goal = b.goal.trim();
    if (goal.length > GOAL_MAX) return c.json(err("invalid_input", `考えたいことは${GOAL_MAX}文字以内で入力してください`), 400);
    patch.goal = goal;
  }
  const now = Math.floor(Date.now() / 1000);
  if (b.memberIds !== undefined || b.contactIds !== undefined) {
    const current = await db.select().from(schema.teamDraftMembers).where(eq(schema.teamDraftMembers.draftId, draft.id)).all();
    const memberIds = (b.memberIds !== undefined ? uniqueIds(b.memberIds) : current.filter((r) => r.kind === "member").map((r) => r.refId)).filter((id) => id !== meId);
    const contactIds = b.contactIds !== undefined ? uniqueIds(b.contactIds) : current.filter((r) => r.kind === "contact").map((r) => r.refId);
    const problem = await validateSelection(db, meId, memberIds, contactIds);
    if (problem) return c.json(err("invalid_input", problem), 400);
    await replaceMembers(db, draft.id, memberIds, contactIds, now);
  }
  await db.update(schema.teamDrafts).set({ ...patch, updatedAt: now }).where(eq(schema.teamDrafts.id, draft.id));
  const updated = (await ownDraft(db, draft.id, meId))!;
  return c.json({ data: await buildDetail(db, meId, updated) });
});

// ---- 協働事業と役割をまとめる（まとめ直し） ----
collabTeamDraftRoutes.post("/:id/generate", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveMe(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const draft = await ownDraft(db, c.req.param("id"), meId);
  if (!draft) return c.json(err("not_found", "チーム案が見つかりません"), 404);
  const { people } = await loadParticipants(db, meId, draft.id);
  if (people.length < 2) return c.json(err("invalid_input", "自分のほかに、メンバーまたは外部人脈を1名以上選んでください"), 400);

  const ideas = await generateTeamDraftIdeas({
    apiKey: c.env.ANTHROPIC_API_KEY, isDev: c.env.ENVIRONMENT === "development", title: draft.title, goal: draft.goal, people,
  });
  if (!ideas) return c.json(err("ai_failed", "協働事業をまとめられませんでした。少し時間をおいて、もう一度お試しください"), 502);
  const now = Math.floor(Date.now() / 1000);
  await db.update(schema.teamDrafts).set({ ideasJson: JSON.stringify(ideas), ideasGeneratedAt: now, updatedAt: now }).where(eq(schema.teamDrafts.id, draft.id));
  return c.json({ data: await buildDetail(db, meId, (await ownDraft(db, draft.id, meId))!) });
});

// ---- 正式なチームへの昇格（緩いチーム／パワーチーム） ----
// 外部人脈の人は、正式なチームのメンバーにはなれないため含めない（メンバーだけで結成する）。
collabTeamDraftRoutes.post("/:id/promote", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveMe(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const draft = await ownDraft(db, c.req.param("id"), meId);
  if (!draft) return c.json(err("not_found", "チーム案が見つかりません"), 404);
  const body = await c.req.json<{ type?: string; name?: string }>().catch(() => ({} as { type?: string; name?: string }));
  if (body.type !== "loose" && body.type !== "power") return c.json(err("invalid_input", "チームの種類（緩いチーム／パワーチーム）を選んでください"), 400);
  const name = (body.name ?? draft.title).trim();
  if (!name) return c.json(err("invalid_input", "チーム名を入力してください"), 400);

  const rows = await db.select().from(schema.teamDraftMembers).where(eq(schema.teamDraftMembers.draftId, draft.id)).all();
  const memberIds = rows.filter((r) => r.kind === "member").map((r) => r.refId);
  const excludedContacts = rows.filter((r) => r.kind === "contact").length;
  const active = memberIds.length > 0
    ? (await db.select({ id: schema.members.id }).from(schema.members)
        .where(and(inArray(schema.members.id, memberIds), eq(schema.members.status, "active"))).all()).map((r) => r.id)
    : [];
  if (active.length < 1) {
    return c.json(err("invalid_input", "正式なチームにするには、自分のほかにメンバーが1名以上必要です（外部人脈の方は、正式なチームには入れません）"), 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const teamId = newId();
  await db.insert(schema.collabTeams).values({ id: teamId, name, type: body.type, createdBy: meId, createdAt: now, archived: 0 });
  if (body.type === "loose") {
    // 緩いチームは承諾なしですぐ成立する
    await db.insert(schema.collabTeamMembers).values([meId, ...active].map((memberId) => ({
      id: newId(), teamId, memberId, status: "active" as const,
      invitedBy: memberId === meId ? null : meId, respondedAt: now, createdAt: now,
    })));
  } else {
    // パワーチームは、他のメンバーに承諾の確認が届き、全員が承諾すると成立する
    await db.insert(schema.collabTeamMembers).values([
      { id: newId(), teamId, memberId: meId, status: "active" as const, invitedBy: null, respondedAt: now, createdAt: now },
      ...active.map((memberId) => ({ id: newId(), teamId, memberId, status: "pending" as const, invitedBy: meId, respondedAt: null, createdAt: now })),
    ]);
  }
  // 昇格したので、検討中のチーム案は削除する
  await db.delete(schema.teamDraftMembers).where(eq(schema.teamDraftMembers.draftId, draft.id));
  await db.delete(schema.teamDrafts).where(eq(schema.teamDrafts.id, draft.id));
  return c.json({ data: { teamId, type: body.type, memberCount: 1 + active.length, excludedContacts } }, 201);
});

// ---- 削除 ----
collabTeamDraftRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveMe(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const draft = await ownDraft(db, c.req.param("id"), meId);
  if (!draft) return c.json(err("not_found", "チーム案が見つかりません"), 404);
  await db.delete(schema.teamDraftMembers).where(eq(schema.teamDraftMembers.draftId, draft.id));
  await db.delete(schema.teamDrafts).where(eq(schema.teamDrafts.id, draft.id));
  return c.json({ ok: true });
});
