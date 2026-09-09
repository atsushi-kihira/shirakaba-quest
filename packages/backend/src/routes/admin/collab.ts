// =============================================================
// 管理者向け 協働ダッシュボード ルート
// GET    /api/admin/collab/graph        → 組織全体の協働マップ（俯瞰・自分中心ではない）
// GET    /api/admin/collab/members      → チーム作成用の全メンバー一覧
// POST   /api/admin/collab/teams        → 緩いチーム作成（リーダーを作成者扱いにする）
// POST   /api/admin/collab/teams/declare → パワーチーム作成（全員即active）
// DELETE /api/admin/collab/teams/:id    → チーム解散（作成者に関わらず可能）
// GET    /api/admin/collab/feed         → 活動タイムライン（モデレーション用、全件閲覧）
// DELETE /api/admin/collab/posts/:id    → 不適切な投稿を削除
// GET    /api/admin/collab/stories      → シェアストーリー一覧（モデレーション用、全件閲覧）
// DELETE /api/admin/collab/stories/:id  → 不適切なシェアストーリーを削除
// =============================================================
import { Hono } from "hono";
import { and, desc, eq, gte, inArray, isNull, ne, or, isNotNull } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { newId } from "../../services/auth.ts";
import { deriveStage, computeStalled } from "../../services/collab-stage.ts";
import { generateCompanySummary } from "../../services/company-summary.ts";
import type { Env, Variables } from "../../types.ts";

export const adminCollabRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function normalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

// ---- GET /api/admin/collab/graph ----
adminCollabRoutes.get("/graph", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  const [allLinks, allActiveMembers, allTeamMemberRows, allTeamRows, linkPostRows, contactRows] = await Promise.all([
    db.select().from(schema.collaborationLinks).all(),
    db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
      .from(schema.members).where(eq(schema.members.status, "active")).all(),
    db.select().from(schema.collabTeamMembers).all(),
    db.select().from(schema.collabTeams).all(),
    db.select({ linkId: schema.collaborationPosts.linkId })
      .from(schema.collaborationPosts)
      .where(and(eq(schema.collaborationPosts.contextType, "link"), isNull(schema.collaborationPosts.deletedAt)))
      .all(),
    db.select().from(schema.externalContacts).all(),
  ]);

  const memberMap = new Map(allActiveMembers.map((m) => [m.id, m]));
  const linkIdsWithPost = new Set(linkPostRows.map((r) => r.linkId).filter((id): id is string => !!id));

  const memberIdsWithLinkActivity = new Set<string>();
  for (const l of allLinks) {
    if (l.oneOnOneCount >= 1) {
      memberIdsWithLinkActivity.add(l.memberLowId);
      memberIdsWithLinkActivity.add(l.memberHighId);
    }
  }
  const memberIdsInTeam = new Set(
    allTeamMemberRows.filter((tm) => tm.status !== "declined").map((tm) => tm.memberId)
  );

  // 管理ダッシュボードでは可視性の絞り込みを行わず、全メンバーを俯瞰する
  const nodes = allActiveMembers.map((m) => ({
    ...m,
    isMe: false,
    hasActivity: memberIdsWithLinkActivity.has(m.id) || memberIdsInTeam.has(m.id),
  }));

  const loosePairKeys = new Set<string>();
  for (const t of allTeamRows) {
    if (t.type !== "loose" || t.archived === 1) continue; // 休止中のチームは関係線を表示しない
    const activeMemberIds = allTeamMemberRows
      .filter((tm) => tm.teamId === t.id && tm.status === "active")
      .map((tm) => tm.memberId);
    for (let i = 0; i < activeMemberIds.length; i++) {
      for (let j = i + 1; j < activeMemberIds.length; j++) {
        const [lo, hi] = normalizePair(activeMemberIds[i], activeMemberIds[j]);
        loosePairKeys.add(`${lo}:${hi}`);
      }
    }
  }

  const edgeMap = new Map<string, { memberAId: string; memberBId: string; stage: "one" | "seed" | "loose"; stalled: ReturnType<typeof computeStalled>; oneOnOneCount: number; lastActivityAt: number | null }>();
  for (const l of allLinks) {
    const key = `${l.memberLowId}:${l.memberHighId}`;
    const stage = loosePairKeys.has(key) ? "loose" : deriveStage(l, linkIdsWithPost.has(l.id));
    edgeMap.set(key, {
      memberAId: l.memberLowId,
      memberBId: l.memberHighId,
      stage,
      stalled: computeStalled(l.lastActivityAt, now),
      oneOnOneCount: l.oneOnOneCount,
      lastActivityAt: l.lastActivityAt,
    });
  }
  for (const key of loosePairKeys) {
    if (edgeMap.has(key)) continue;
    const [lo, hi] = key.split(":");
    edgeMap.set(key, { memberAId: lo, memberBId: hi, stage: "loose", stalled: "active", oneOnOneCount: 0, lastActivityAt: null });
  }
  const edges = [...edgeMap.values()];

  const teams = allTeamRows.map((t) => {
    const members = allTeamMemberRows
      .filter((tm) => tm.teamId === t.id && tm.status !== "declined")
      .map((tm) => {
        const m = memberMap.get(tm.memberId);
        return {
          id: tm.memberId,
          status: tm.status,
          invitedBy: tm.invitedBy,
          name: m?.name ?? "不明なメンバー",
          emoji: m?.emoji ?? "❓",
          bgColor: m?.bgColor ?? "bg-stone-100",
        };
      });
    return { id: t.id, name: t.name, type: t.type, createdBy: t.createdBy, archived: t.archived === 1, myStatus: null, members };
  }).filter((t) => t.members.length > 0);

  // 人脈レイヤー：管理者は全員分を対象に、公開範囲に応じて開示項目を絞る（本人扱いにはならない）
  const contacts = contactRows
    .filter((ct) => ct.visibility !== "private")
    .map((ct) => {
      const showDetail = ct.visibility === "full";
      return {
        id: ct.id,
        ownerId: ct.ownerMemberId,
        mine: false,
        visibility: ct.visibility,
        specialty: ct.specialty,
        name: showDetail ? ct.name : null,
        company: showDetail ? ct.company : null,
        note: showDetail ? ct.note : null,
      };
    });

  return c.json({
    data: {
      center: null,
      nodes,
      edges,
      myEdges: [],
      teams,
      noActivityMembers: [],
      pendingConfirmations: [],
      contacts,
    },
  });
});

// ---- GET /api/admin/collab/members ---- チーム作成用の全メンバー一覧
adminCollabRoutes.get("/members", async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db
    .select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
    .from(schema.members)
    .where(eq(schema.members.status, "active"))
    .orderBy(schema.members.name)
    .all();
  return c.json({ data: rows });
});

// ---- POST /api/admin/collab/teams ---- 緩いチーム作成（指定したリーダーを作成者扱いにする）
adminCollabRoutes.post("/teams", async (c) => {
  const db = createDb(c.env.DB);
  const { name, memberIds, leaderId } = await c.req.json<{ name: string; memberIds: string[]; leaderId: string }>();

  if (!name?.trim()) return c.json({ error: { code: "invalid_input", message: "チーム名を入力してください" } }, 400);
  if (!leaderId) return c.json({ error: { code: "invalid_input", message: "リーダーを選択してください" } }, 400);

  const uniqueIds = [...new Set([leaderId, ...(memberIds ?? [])])];
  if (uniqueIds.length < 2) {
    return c.json({ error: { code: "invalid_input", message: "緩いチームは2名以上で作成してください" } }, 400);
  }

  const validMembers = await db.select({ id: schema.members.id }).from(schema.members)
    .where(and(inArray(schema.members.id, uniqueIds), eq(schema.members.status, "active"))).all();
  if (validMembers.length !== uniqueIds.length) {
    return c.json({ error: { code: "invalid_input", message: "無効なメンバーが含まれています" } }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const teamId = newId();
  await db.insert(schema.collabTeams).values({
    id: teamId, name: name.trim(), type: "loose", createdBy: leaderId, createdAt: now, archived: 0,
  });
  await db.insert(schema.collabTeamMembers).values(
    uniqueIds.map((memberId) => ({
      id: newId(), teamId, memberId, status: "active" as const,
      invitedBy: memberId === leaderId ? null : leaderId, respondedAt: now, createdAt: now,
    }))
  );

  return c.json({ data: { id: teamId } }, 201);
});

// ---- POST /api/admin/collab/teams/declare ---- パワーチーム作成（管理者作成時は全員即active）
adminCollabRoutes.post("/teams/declare", async (c) => {
  const db = createDb(c.env.DB);
  const { name, memberIds, leaderId } = await c.req.json<{ name: string; memberIds: string[]; leaderId: string }>();

  if (!name?.trim()) return c.json({ error: { code: "invalid_input", message: "チーム名を入力してください" } }, 400);
  if (!leaderId) return c.json({ error: { code: "invalid_input", message: "リーダーを選択してください" } }, 400);

  const otherIds = [...new Set((memberIds ?? []).filter((id) => id !== leaderId))];
  if (otherIds.length === 0) {
    return c.json({ error: { code: "invalid_input", message: "他のメンバーを1名以上指定してください" } }, 400);
  }

  const allIds = [leaderId, ...otherIds];
  const validMembers = await db.select({ id: schema.members.id }).from(schema.members)
    .where(and(inArray(schema.members.id, allIds), eq(schema.members.status, "active"))).all();
  if (validMembers.length !== allIds.length) {
    return c.json({ error: { code: "invalid_input", message: "無効なメンバーが含まれています" } }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const teamId = newId();
  await db.insert(schema.collabTeams).values({
    id: teamId, name: name.trim(), type: "power", createdBy: leaderId, createdAt: now, archived: 0,
  });
  await db.insert(schema.collabTeamMembers).values([
    { id: newId(), teamId, memberId: leaderId, status: "active" as const, invitedBy: null, respondedAt: now, createdAt: now },
    ...otherIds.map((memberId) => ({
      id: newId(), teamId, memberId, status: "active" as const, invitedBy: leaderId, respondedAt: now, createdAt: now,
    })),
  ]);

  return c.json({ data: { id: teamId } }, 201);
});

// ---- DELETE /api/admin/collab/teams/:id ---- チーム解散（作成者に関わらず可能）
adminCollabRoutes.delete("/teams/:id", async (c) => {
  const db = createDb(c.env.DB);
  const teamId = c.req.param("id");
  const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, teamId)).get();
  if (!team) return c.json({ error: { code: "not_found", message: "チームが見つかりません" } }, 404);

  await db.delete(schema.collabTeamMembers).where(eq(schema.collabTeamMembers.teamId, teamId));
  await db.delete(schema.collabTeams).where(eq(schema.collabTeams.id, teamId));

  return c.json({ ok: true });
});

// ---- POST /api/admin/collab/teams/:id/members ---- メンバーを追加する（管理者権限のため承認ステップなしで即active）
adminCollabRoutes.post("/teams/:id/members", async (c) => {
  const db = createDb(c.env.DB);
  const teamId = c.req.param("id");
  const { memberIds } = await c.req.json<{ memberIds?: string[] }>().catch(() => ({ memberIds: undefined }));
  const targetIds = [...new Set(memberIds ?? [])];
  if (targetIds.length === 0) return c.json({ error: { code: "invalid_input", message: "追加するメンバーを選択してください" } }, 400);

  const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, teamId)).get();
  if (!team) return c.json({ error: { code: "not_found", message: "チームが見つかりません" } }, 404);

  const validMembers = await db.select({ id: schema.members.id }).from(schema.members)
    .where(and(inArray(schema.members.id, targetIds), eq(schema.members.status, "active"))).all();
  if (validMembers.length !== targetIds.length) {
    return c.json({ error: { code: "invalid_input", message: "無効なメンバーが含まれています" } }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const existingRows = await db.select().from(schema.collabTeamMembers)
    .where(and(eq(schema.collabTeamMembers.teamId, teamId), inArray(schema.collabTeamMembers.memberId, targetIds)))
    .all();
  const existingByMember = new Map(existingRows.map((r) => [r.memberId, r]));

  let added = 0;
  for (const memberId of targetIds) {
    const existing = existingByMember.get(memberId);
    if (existing) {
      if (existing.status === "active") continue;
      await db.update(schema.collabTeamMembers)
        .set({ status: "active", invitedBy: team.createdBy, respondedAt: now })
        .where(eq(schema.collabTeamMembers.id, existing.id));
    } else {
      await db.insert(schema.collabTeamMembers).values({
        id: newId(), teamId, memberId, status: "active", invitedBy: team.createdBy, respondedAt: now, createdAt: now,
      });
    }
    added += 1;
  }

  return c.json({ data: { added } }, 201);
});

// ---- POST /api/admin/collab/teams/:id/members/:memberId/remove ---- メンバーを除名する
adminCollabRoutes.post("/teams/:id/members/:memberId/remove", async (c) => {
  const db = createDb(c.env.DB);
  const teamId = c.req.param("id");
  const targetId = c.req.param("memberId");
  const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, teamId)).get();
  if (!team) return c.json({ error: { code: "not_found", message: "チームが見つかりません" } }, 404);

  const membership = await db.select().from(schema.collabTeamMembers)
    .where(and(eq(schema.collabTeamMembers.teamId, teamId), eq(schema.collabTeamMembers.memberId, targetId)))
    .get();
  if (!membership) return c.json({ error: { code: "not_found", message: "このメンバーは見つかりません" } }, 404);

  await db.delete(schema.collabTeamMembers).where(eq(schema.collabTeamMembers.id, membership.id));
  return c.json({ ok: true });
});

// ---- POST /api/admin/collab/teams/:id/promote ---- 緩いチームをパワーチームに昇格する
adminCollabRoutes.post("/teams/:id/promote", async (c) => {
  const db = createDb(c.env.DB);
  const teamId = c.req.param("id");
  const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, teamId)).get();
  if (!team) return c.json({ error: { code: "not_found", message: "チームが見つかりません" } }, 404);
  if (team.type !== "loose") return c.json({ error: { code: "invalid_input", message: "緩いチームのみパワーチームに昇格できます" } }, 400);

  await db.update(schema.collabTeams).set({ type: "power" }).where(eq(schema.collabTeams.id, teamId));
  return c.json({ ok: true });
});

// ---- POST /api/admin/collab/teams/:id/pause ---- チーム活動を休止する（解散はしない）
adminCollabRoutes.post("/teams/:id/pause", async (c) => {
  const db = createDb(c.env.DB);
  const teamId = c.req.param("id");
  const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, teamId)).get();
  if (!team) return c.json({ error: { code: "not_found", message: "チームが見つかりません" } }, 404);

  await db.update(schema.collabTeams).set({ archived: 1 }).where(eq(schema.collabTeams.id, teamId));
  return c.json({ ok: true });
});

// ---- POST /api/admin/collab/teams/:id/resume ---- 休止中のチーム活動を再開する
adminCollabRoutes.post("/teams/:id/resume", async (c) => {
  const db = createDb(c.env.DB);
  const teamId = c.req.param("id");
  const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, teamId)).get();
  if (!team) return c.json({ error: { code: "not_found", message: "チームが見つかりません" } }, 404);

  await db.update(schema.collabTeams).set({ archived: 0 }).where(eq(schema.collabTeams.id, teamId));
  return c.json({ ok: true });
});

// ---- POST /api/admin/collab/teams/:id/transfer-leader ---- リーダー（作成者）を変更する
adminCollabRoutes.post("/teams/:id/transfer-leader", async (c) => {
  const db = createDb(c.env.DB);
  const teamId = c.req.param("id");
  const { newLeaderId } = await c.req.json<{ newLeaderId?: string }>().catch(() => ({ newLeaderId: undefined }));
  const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, teamId)).get();
  if (!team) return c.json({ error: { code: "not_found", message: "チームが見つかりません" } }, 404);
  if (!newLeaderId) return c.json({ error: { code: "invalid_input", message: "新しいリーダーを選択してください" } }, 400);

  const target = await db.select().from(schema.collabTeamMembers)
    .where(and(
      eq(schema.collabTeamMembers.teamId, teamId),
      eq(schema.collabTeamMembers.memberId, newLeaderId),
      eq(schema.collabTeamMembers.status, "active")
    ))
    .get();
  if (!target) return c.json({ error: { code: "invalid_input", message: "アクティブなメンバーにのみ変更できます" } }, 400);

  await db.update(schema.collabTeams).set({ createdBy: newLeaderId }).where(eq(schema.collabTeams.id, teamId));
  return c.json({ ok: true });
});

// ---- PATCH /api/admin/collab/teams/:id ---- チーム名を変更する
adminCollabRoutes.patch("/teams/:id", async (c) => {
  const db = createDb(c.env.DB);
  const teamId = c.req.param("id");
  const { name } = await c.req.json<{ name?: string }>().catch(() => ({ name: undefined }));
  if (!name?.trim()) return c.json({ error: { code: "invalid_input", message: "チーム名を入力してください" } }, 400);

  const team = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, teamId)).get();
  if (!team) return c.json({ error: { code: "not_found", message: "チームが見つかりません" } }, 404);

  await db.update(schema.collabTeams).set({ name: name.trim() }).where(eq(schema.collabTeams.id, teamId));
  return c.json({ ok: true });
});

// ---- GET /api/admin/collab/feed ---- 活動タイムライン（モデレーション用、全件閲覧）
adminCollabRoutes.get("/feed", async (c) => {
  const db = createDb(c.env.DB);
  const team = c.req.query("team") ?? "all";
  const period = c.req.query("period") ?? "30";
  const now = Math.floor(Date.now() / 1000);
  const periodDays: Record<string, number | null> = { "30": 30, "90": 90, "180": 180, "365": 365, all: null };
  const days = periodDays[period] ?? 30;
  const cutoff = days ? now - days * 86400 : null;

  const conditions = [isNull(schema.collaborationPosts.deletedAt)];
  if (cutoff !== null) conditions.push(gte(schema.collaborationPosts.createdAt, cutoff));
  if (team !== "all") {
    conditions.push(eq(schema.collaborationPosts.contextType, "team"));
    conditions.push(eq(schema.collaborationPosts.teamId, team));
  }

  const posts = await db
    .select()
    .from(schema.collaborationPosts)
    .where(and(...conditions))
    .orderBy(desc(schema.collaborationPosts.createdAt))
    .all();

  if (posts.length === 0) return c.json({ data: [] });

  const postIds = posts.map((p) => p.id);
  const [postMembers, reactions] = await Promise.all([
    db.select().from(schema.collaborationPostMembers).where(inArray(schema.collaborationPostMembers.postId, postIds)).all(),
    db.select().from(schema.collaborationPostReactions).where(inArray(schema.collaborationPostReactions.postId, postIds)).all(),
  ]);

  const membersByPost = new Map<string, string[]>();
  for (const pm of postMembers) {
    const arr = membersByPost.get(pm.postId) ?? [];
    arr.push(pm.memberId);
    membersByPost.set(pm.postId, arr);
  }
  const reactionsByPost = new Map<string, typeof reactions>();
  for (const r of reactions) {
    const arr = reactionsByPost.get(r.postId) ?? [];
    arr.push(r);
    reactionsByPost.set(r.postId, arr);
  }

  const memberIds = [...new Set(postMembers.map((pm) => pm.memberId))];
  const memberRows = memberIds.length > 0
    ? await db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
        .from(schema.members).where(inArray(schema.members.id, memberIds)).all()
    : [];
  const memberMap = new Map(memberRows.map((m) => [m.id, m]));

  // モデレーション目的のため、非公開投稿も含め全件を返す
  const result = posts.map((p) => {
    const reactionCounts: Record<string, number> = {};
    for (const r of reactionsByPost.get(p.id) ?? []) reactionCounts[r.type] = (reactionCounts[r.type] ?? 0) + 1;
    return {
      id: p.id,
      authorId: p.authorId,
      contextType: p.contextType,
      linkId: p.linkId,
      teamId: p.teamId,
      visibility: p.visibility,
      isPrivate: !!p.isPrivate,
      stageAtPost: p.stageAtPost,
      source: p.source,
      body: p.body,
      createdAt: p.createdAt,
      members: (membersByPost.get(p.id) ?? []).map((id) => memberMap.get(id)).filter(Boolean),
      reactionCounts,
      myReactions: [] as string[],
      mine: false,
      canEdit: false,
      canDelete: true,
    };
  });

  return c.json({ data: result });
});

// ---- DELETE /api/admin/collab/posts/:id ---- 不適切な投稿を削除
adminCollabRoutes.delete("/posts/:id", async (c) => {
  const db = createDb(c.env.DB);
  const postId = c.req.param("id");
  const post = await db.select().from(schema.collaborationPosts).where(eq(schema.collaborationPosts.id, postId)).get();
  if (!post || post.deletedAt) return c.json({ error: { code: "not_found", message: "投稿が見つかりません" } }, 404);

  await db.update(schema.collaborationPosts)
    .set({ deletedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.collaborationPosts.id, postId));

  return c.json({ ok: true });
});

// ---- GET /api/admin/collab/stories ---- シェアストーリー一覧（モデレーション用、全件閲覧）
adminCollabRoutes.get("/stories", async (c) => {
  const db = createDb(c.env.DB);
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

  const result = stories.map((s) => ({
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
    mine: false,
    canEdit: false,
    canDelete: true,
    attachments: (attachmentsByStory.get(s.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
    members: (memberIdsByStory.get(s.id) ?? []).map((id) => memberMap.get(id)).filter(Boolean),
  }));

  return c.json({ data: result });
});

// ---- DELETE /api/admin/collab/stories/:id ---- 不適切なシェアストーリーを削除
adminCollabRoutes.delete("/stories/:id", async (c) => {
  const db = createDb(c.env.DB);
  const storyId = c.req.param("id");
  const story = await db.select().from(schema.shareStories).where(eq(schema.shareStories.id, storyId)).get();
  if (!story || story.deletedAt) return c.json({ error: { code: "not_found", message: "シェアストーリーが見つかりません" } }, 404);

  await db.update(schema.shareStories)
    .set({ deletedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.shareStories.id, storyId));

  return c.json({ ok: true });
});

// ---- POST /api/admin/collab/contacts/backfill-business-summary ----
// 既存の人脈データに会社概要（Web検索）を後付けで生成する。1回の呼び出しでbatchSize件だけ処理し、
// 呼び出し側（管理画面 or スクリプト）が remaining が 0 になるまで繰り返し呼ぶ想定。
adminCollabRoutes.post("/contacts/backfill-business-summary", async (c) => {
  const db = createDb(c.env.DB);
  const body = await c.req.json<{ batchSize?: number; retryErrors?: boolean }>().catch(() => ({ batchSize: undefined, retryErrors: undefined }));
  const batchSize = Math.min(Math.max(body.batchSize ?? 20, 1), 50);
  // 'not_found'（検索したが見つからなかった）は再検索しても結果が変わりにくいため既定では対象外にする。
  // 'error'（一時的なAPI障害等）は retryErrors:true を指定したときだけ再試行対象に含める。
  // これを分けないと、対象が尽きるたびに毎回同じ 'not_found'/'error' 行を再選択し続けてしまい、
  // 未処理の 'pending' 行がいつまで経っても処理されない無限ループになる（実際に発生した不具合）。
  const targetStatuses = body.retryErrors ? ["pending", "error"] : ["pending"];

  // 会社名が無い行、または非公開の人脈は生成の対象外なので、まとめて skipped にしておく（対象カウントから外れる）
  await db.update(schema.externalContacts)
    .set({ businessSummaryStatus: "skipped" })
    .where(and(
      or(isNull(schema.externalContacts.company), eq(schema.externalContacts.company, ""), eq(schema.externalContacts.visibility, "private")),
      ne(schema.externalContacts.businessSummaryStatus, "skipped")
    ));

  const targets = await db.select({ id: schema.externalContacts.id, company: schema.externalContacts.company })
    .from(schema.externalContacts)
    .where(and(
      isNotNull(schema.externalContacts.company),
      ne(schema.externalContacts.company, ""),
      ne(schema.externalContacts.visibility, "private"),
      inArray(schema.externalContacts.businessSummaryStatus, targetStatuses)
    ))
    .limit(batchSize)
    .all();

  const CONCURRENCY = 3;
  let processed = 0;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (t) => {
      if (!t.company) return;
      const result = await generateCompanySummary({
        company: t.company,
        apiKey: c.env.ANTHROPIC_API_KEY,
        isDev: c.env.ENVIRONMENT === "development",
      });
      await db.update(schema.externalContacts).set({
        businessSummary: result.summary,
        businessSummaryDetail: result.detail,
        businessSummaryStatus: result.status,
        businessSummaryGeneratedAt: Math.floor(Date.now() / 1000),
      }).where(eq(schema.externalContacts.id, t.id));
      processed++;
    }));
  }

  const remainingRows = await db.select({ id: schema.externalContacts.id })
    .from(schema.externalContacts)
    .where(and(
      isNotNull(schema.externalContacts.company),
      ne(schema.externalContacts.company, ""),
      ne(schema.externalContacts.visibility, "private"),
      inArray(schema.externalContacts.businessSummaryStatus, targetStatuses)
    ))
    .all();

  return c.json({ data: { processed, remaining: remainingRows.length } });
});
