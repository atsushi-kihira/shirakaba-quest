// =============================================================
// 管理者チームルート
// GET    /api/admin/teams
// POST   /api/admin/teams
// POST   /api/admin/teams/auto-assign
// PUT    /api/admin/teams/reorder
// PATCH  /api/admin/teams/:id
// DELETE /api/admin/teams/:id
// POST   /api/admin/teams/:id/members
// DELETE /api/admin/teams/:id/members/:memberId
// PATCH  /api/admin/teams/:id/members/:memberId/leader
// =============================================================
import { Hono } from "hono";
import { eq, and, sql } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { newId } from "../../services/auth.ts";
import { randomAssign, aiAssign } from "../../services/team-assign.ts";
import type { Env, Variables } from "../../types.ts";
import type { Skill } from "@shared/types";

// ギルド作成時に選べる絵文字の既定セット（手動作成・自動振り分けの両方で使う）
export const DEFAULT_TEAM_EMOJIS = [
  "🦊", "🐻", "🐝", "🦉", "🐢", "🐧", "🦁", "🐯",
  "🐺", "🦅", "🐬", "🐙", "🦄", "🐨", "🐼", "🦔",
];

export const adminTeamRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

async function nextSortOrder(db: ReturnType<typeof createDb>): Promise<number> {
  const row = await db.select({ max: sql<number>`max(${schema.teams.sortOrder})` }).from(schema.teams).get();
  return (row?.max ?? -1) + 1;
}

// GET /api/admin/teams
adminTeamRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const teams = await db.select().from(schema.teams).orderBy(schema.teams.sortOrder).all();
  const allTeamMembers = await db.select().from(schema.teamMembers).all();

  const members = await db.select({
    id: schema.members.id, name: schema.members.name, furigana: schema.members.furigana,
    emoji: schema.members.emoji, bgColor: schema.members.bgColor, category: schema.members.category,
  }).from(schema.members).where(eq(schema.members.status, "active")).all();
  const memberMap = new Map(members.map((m) => [m.id, m]));

  return c.json({
    data: teams.map((t) => {
      const tms = allTeamMembers.filter((tm) => tm.teamId === t.id);
      return {
        id: t.id, name: t.name, emblemEmoji: t.emblemEmoji, seasonId: t.seasonId,
        createdAt: t.createdAt, updatedAt: t.updatedAt,
        members: tms.map((tm) => ({
          id: tm.id, memberId: tm.memberId, teamId: tm.teamId,
          isLeader: !!tm.isLeader, joinedAt: tm.joinedAt,
          member: memberMap.get(tm.memberId),
        })),
      };
    }),
  });
});

// POST /api/admin/teams
adminTeamRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const body = await c.req.json<{ name: string; emblemEmoji?: string; seasonId?: string }>();
  if (!body.name?.trim()) return c.json({ error: { code: "invalid_input", message: "チーム名は必須です" } }, 400);

  const id = newId();
  await db.insert(schema.teams).values({
    id,
    name: body.name.trim(),
    emblemEmoji: body.emblemEmoji ?? "🦊",
    seasonId: body.seasonId ?? null,
    sortOrder: await nextSortOrder(db),
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ data: { id } }, 201);
});

// PUT /api/admin/teams/reorder — ギルドの表示順を一括更新する
adminTeamRoutes.put("/reorder", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const { order } = await c.req.json<{ order: string[] }>();

  await Promise.all(
    (order ?? []).map((id, idx) =>
      db.update(schema.teams).set({ sortOrder: idx, updatedAt: now }).where(eq(schema.teams.id, id))
    )
  );

  return c.json({ ok: true });
});

// POST /api/admin/teams/auto-assign
adminTeamRoutes.post("/auto-assign", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const body = await c.req.json<{
    teamSize: number;
    mode: "random" | "ai";
    leaderIds?: string[];
    prompt?: string;
    seasonId?: string;
    teamNames?: string[];
    teamEmojis?: string[];
  }>();

  const activeMembers = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.status, "active"))
    .all();

  const membersForAssign = activeMembers.map((m) => ({
    id: m.id,
    name: m.name,
    category: m.category,
    businessDescription: m.businessDescription,
    skills: parseJson<Skill[]>(m.skills, []),
  }));

  let assignments;
  if (body.mode === "ai") {
    if (!body.prompt) return c.json({ error: { code: "invalid_input", message: "AIプロンプトが必要です" } }, 400);
    assignments = await aiAssign(membersForAssign, body.teamSize, body.prompt, c.env.ANTHROPIC_API_KEY);
  } else {
    assignments = randomAssign(membersForAssign, body.teamSize, body.leaderIds ?? []);
  }

  const createdTeams = [];
  let sortOrder = await nextSortOrder(db);

  for (const assignment of assignments) {
    const teamId = newId();
    const emoji = body.teamEmojis?.[assignment.teamIndex] ?? DEFAULT_TEAM_EMOJIS[assignment.teamIndex % DEFAULT_TEAM_EMOJIS.length];
    const name  = body.teamNames?.[assignment.teamIndex] ?? `チーム ${assignment.teamIndex + 1}`;

    await db.insert(schema.teams).values({
      id: teamId,
      name,
      emblemEmoji: emoji,
      seasonId: body.seasonId ?? null,
      sortOrder: sortOrder++,
      createdAt: now,
      updatedAt: now,
    });

    for (const memberId of assignment.memberIds) {
      await db.insert(schema.teamMembers).values({
        id: newId(),
        teamId,
        memberId,
        isLeader: assignment.leaderId === memberId ? 1 : 0,
        joinedAt: now,
      }).onConflictDoNothing();
    }

    createdTeams.push({ teamId, name, emoji, memberCount: assignment.memberIds.length });
  }

  return c.json({ ok: true, teams: createdTeams });
});

// PATCH /api/admin/teams/:id
adminTeamRoutes.patch("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const body = await c.req.json<{ name?: string; emblemEmoji?: string }>()
    .catch(() => ({} as { name?: string; emblemEmoji?: string }));

  await db.update(schema.teams).set({
    ...(body.name        !== undefined && { name: body.name.trim() }),
    ...(body.emblemEmoji !== undefined && { emblemEmoji: body.emblemEmoji }),
    updatedAt: now,
  }).where(eq(schema.teams.id, c.req.param("id")));

  return c.json({ ok: true });
});

// DELETE /api/admin/teams/:id
adminTeamRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  await db.delete(schema.teamMembers).where(eq(schema.teamMembers.teamId, id));
  await db.delete(schema.teams).where(eq(schema.teams.id, id));
  return c.json({ ok: true });
});

// POST /api/admin/teams/:id/members
adminTeamRoutes.post("/:id/members", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const { memberId, isLeader } = await c.req.json<{ memberId: string; isLeader?: boolean }>();

  await db.insert(schema.teamMembers).values({
    id: newId(),
    teamId: c.req.param("id"),
    memberId,
    isLeader: isLeader ? 1 : 0,
    joinedAt: now,
  }).onConflictDoNothing();

  return c.json({ ok: true });
});

// DELETE /api/admin/teams/:id/members/:memberId
adminTeamRoutes.delete("/:id/members/:memberId", async (c) => {
  const db = createDb(c.env.DB);
  await db.delete(schema.teamMembers).where(
    and(
      eq(schema.teamMembers.teamId, c.req.param("id")),
      eq(schema.teamMembers.memberId, c.req.param("memberId"))
    )
  );
  return c.json({ ok: true });
});

// PATCH /api/admin/teams/:id/members/:memberId/leader
adminTeamRoutes.patch("/:id/members/:memberId/leader", async (c) => {
  const db = createDb(c.env.DB);
  const { isLeader } = await c.req.json<{ isLeader: boolean }>();

  await db.update(schema.teamMembers).set({ isLeader: isLeader ? 1 : 0 }).where(
    and(
      eq(schema.teamMembers.teamId, c.req.param("id")),
      eq(schema.teamMembers.memberId, c.req.param("memberId"))
    )
  );
  return c.json({ ok: true });
});

function parseJson<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str) as T; } catch { return fallback; }
}
