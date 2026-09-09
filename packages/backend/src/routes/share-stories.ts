// =============================================================
// シェアストーリー（棚）ルート
// GET    /api/share-stories             → 一覧
// POST   /api/share-stories             → 登録
// PATCH  /api/share-stories/:id         → 編集（authorのみ）
// DELETE /api/share-stories/:id         → 削除（authorのみ）
// =============================================================
import { Hono } from "hono";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId } from "../services/auth.ts";
import { resolveEffectiveMemberId } from "../services/resolve-member.ts";
import type { Env, Variables } from "../types.ts";

export const shareStoryRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
shareStoryRoutes.use("*", authMiddleware);

// ---- GET /api/share-stories ----
shareStoryRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const team = c.req.query("team") ?? "all";

  const conditions = [isNull(schema.shareStories.deletedAt)];
  if (team !== "all") conditions.push(eq(schema.shareStories.teamId, team));

  const stories = await db
    .select()
    .from(schema.shareStories)
    .where(and(...conditions))
    .orderBy(desc(schema.shareStories.createdAt))
    .all();

  if (stories.length === 0) return c.json({ data: [] });

  const storyIds = stories.map((s) => s.id);
  const myTeamRows = await db
    .select({ teamId: schema.collabTeamMembers.teamId })
    .from(schema.collabTeamMembers)
    .where(and(eq(schema.collabTeamMembers.memberId, meId), eq(schema.collabTeamMembers.status, "active")))
    .all();
  const myActiveTeamIds = new Set(myTeamRows.map((t) => t.teamId));

  const [attachments, storyMembers, teamRows] = await Promise.all([
    db.select().from(schema.shareStoryAttachments).where(inArray(schema.shareStoryAttachments.storyId, storyIds)).all(),
    db.select().from(schema.shareStoryMembers).where(inArray(schema.shareStoryMembers.storyId, storyIds)).all(),
    db.select().from(schema.collabTeams).all(),
  ]);

  const teamMap = new Map(teamRows.map((t) => [t.id, t]));
  const attachmentsByStory = new Map<string, typeof attachments>();
  for (const a of attachments) {
    const arr = attachmentsByStory.get(a.storyId) ?? [];
    arr.push(a);
    attachmentsByStory.set(a.storyId, arr);
  }
  const memberIdsByStory = new Map<string, string[]>();
  for (const sm of storyMembers) {
    const arr = memberIdsByStory.get(sm.storyId) ?? [];
    arr.push(sm.memberId);
    memberIdsByStory.set(sm.storyId, arr);
  }

  const allMemberIds = [...new Set(storyMembers.map((sm) => sm.memberId))];
  const memberRows = allMemberIds.length > 0
    ? await db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
        .from(schema.members).where(inArray(schema.members.id, allMemberIds)).all()
    : [];
  const memberMap = new Map(memberRows.map((m) => [m.id, m]));

  const visible = stories.filter((s) => {
    if (s.authorId === meId) return true;
    if ((memberIdsByStory.get(s.id) ?? []).includes(meId)) return true;
    if (s.visibility === "private") return false;
    if (s.visibility === "chapter") return true;
    if (s.visibility === "team" && s.teamId) return myActiveTeamIds.has(s.teamId);
    return false;
  });

  const result = visible.map((s) => ({
    id: s.id,
    teamId: s.teamId,
    teamName: s.teamId ? teamMap.get(s.teamId)?.name ?? null : null,
    seasonId: s.seasonId,
    authorId: s.authorId,
    title: s.title,
    summary: s.summary,
    presentedOn: s.presentedOn,
    visibility: s.visibility,
    createdAt: s.createdAt,
    mine: s.authorId === meId,
    canEdit: s.authorId === meId,
    canDelete: s.authorId === meId,
    attachments: (attachmentsByStory.get(s.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
    members: (memberIdsByStory.get(s.id) ?? []).map((id) => memberMap.get(id)).filter(Boolean),
  }));

  return c.json({ data: result });
});

// ---- POST /api/share-stories ----
shareStoryRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const body = await c.req.json<{
    teamId?: string;
    seasonId?: string;
    title: string;
    summary?: string;
    presentedOn?: number;
    visibility?: "team" | "chapter" | "private";
    memberIds?: string[];
    attachments?: { kind: string; label: string; url?: string }[];
  }>();

  if (!body.title?.trim()) {
    return c.json({ error: { code: "invalid_input", message: "タイトルを入力してください" } }, 400);
  }

  if (body.teamId) {
    const membership = await db.select().from(schema.collabTeamMembers)
      .where(and(eq(schema.collabTeamMembers.teamId, body.teamId), eq(schema.collabTeamMembers.memberId, meId), eq(schema.collabTeamMembers.status, "active")))
      .get();
    if (!membership) return c.json({ error: { code: "forbidden", message: "このチームのメンバーではありません" } }, 403);
  }

  const now = Math.floor(Date.now() / 1000);
  const storyId = newId();

  await db.insert(schema.shareStories).values({
    id: storyId,
    teamId: body.teamId ?? null,
    seasonId: body.seasonId ?? null,
    authorId: meId,
    title: body.title.trim(),
    summary: body.summary?.trim() || null,
    presentedOn: body.presentedOn ?? null,
    visibility: body.visibility ?? "chapter",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  const memberIds = [...new Set([meId, ...(body.memberIds ?? [])])];
  await db.insert(schema.shareStoryMembers).values(
    memberIds.map((memberId) => ({ storyId, memberId }))
  );

  if (body.attachments && body.attachments.length > 0) {
    await db.insert(schema.shareStoryAttachments).values(
      body.attachments.map((a, idx) => ({
        id: newId(), storyId, kind: a.kind, label: a.label, url: a.url ?? null, fileKey: null, sortOrder: idx,
      }))
    );
  }

  // 活動タイムラインへ要約を1件流す（source='system'、編集/削除・リアクション対象外）
  const systemPostId = newId();
  await db.insert(schema.collaborationPosts).values({
    id: systemPostId,
    authorId: meId,
    contextType: body.teamId ? "team" : "link",
    linkId: null,
    teamId: body.teamId ?? null,
    visibility: body.visibility ?? "chapter",
    isPrivate: 0,
    stageAtPost: null,
    source: "system",
    body: `⭐ シェアストーリー「${body.title.trim()}」を登録しました`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.collaborationPostMembers).values(
    memberIds.map((memberId) => ({ postId: systemPostId, memberId }))
  );

  return c.json({ data: { id: storyId } }, 201);
});

// ---- PATCH /api/share-stories/:id ----
shareStoryRoutes.patch("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const storyId = c.req.param("id");
  const story = await db.select().from(schema.shareStories).where(eq(schema.shareStories.id, storyId)).get();
  if (!story || story.deletedAt) return c.json({ error: { code: "not_found", message: "シェアストーリーが見つかりません" } }, 404);
  if (story.authorId !== meId) return c.json({ error: { code: "forbidden", message: "自分のシェアストーリーのみ編集できます" } }, 403);

  const body = await c.req.json<{ title?: string; summary?: string; presentedOn?: number; visibility?: "team" | "chapter" | "private" }>();
  const now = Math.floor(Date.now() / 1000);

  await db.update(schema.shareStories).set({
    ...(body.title !== undefined && { title: body.title.trim() }),
    ...(body.summary !== undefined && { summary: body.summary?.trim() || null }),
    ...(body.presentedOn !== undefined && { presentedOn: body.presentedOn }),
    ...(body.visibility !== undefined && { visibility: body.visibility }),
    updatedAt: now,
  }).where(eq(schema.shareStories.id, storyId));

  return c.json({ ok: true });
});

// ---- DELETE /api/share-stories/:id ----
shareStoryRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const storyId = c.req.param("id");
  const story = await db.select().from(schema.shareStories).where(eq(schema.shareStories.id, storyId)).get();
  if (!story || story.deletedAt) return c.json({ error: { code: "not_found", message: "シェアストーリーが見つかりません" } }, 404);
  if (story.authorId !== meId) return c.json({ error: { code: "forbidden", message: "自分のシェアストーリーのみ削除できます" } }, 403);

  await db.update(schema.shareStories)
    .set({ deletedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.shareStories.id, storyId));

  return c.json({ ok: true });
});
