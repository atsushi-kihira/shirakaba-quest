// =============================================================
// チームルート（公開・認証必要）
// GET /api/teams     — チーム一覧（自分の所属チーム含む）
// GET /api/teams/:id — チーム詳細
// =============================================================
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { resolveEffectiveMemberId } from "../services/resolve-member.ts";
import type { Env, Variables } from "../types.ts";

export const teamRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
teamRoutes.use("*", authMiddleware);

// GET /api/teams
teamRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const rawUserId = c.get("userId");
  const userType  = c.get("userType");
  const viewerId  = (await resolveEffectiveMemberId(db, rawUserId, userType)) ?? rawUserId;

  const teams = await db.select().from(schema.teams).all();
  const allTeamMembers = await db
    .select()
    .from(schema.teamMembers)
    .all();

  const memberIds = [...new Set(allTeamMembers.map((tm) => tm.memberId))];
  const members = memberIds.length > 0
    ? await db.select({
        id: schema.members.id, name: schema.members.name, furigana: schema.members.furigana,
        emoji: schema.members.emoji, bgColor: schema.members.bgColor, category: schema.members.category,
      }).from(schema.members).all()
    : [];
  const memberMap = new Map(members.map((m) => [m.id, m]));

  const result = teams.map((t) => {
    const tms = allTeamMembers.filter((tm) => tm.teamId === t.id);
    return {
      id: t.id,
      name: t.name,
      emblemEmoji: t.emblemEmoji,
      seasonId: t.seasonId,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      members: tms.map((tm) => ({
        id: tm.id,
        memberId: tm.memberId,
        teamId: tm.teamId,
        isLeader: !!tm.isLeader,
        joinedAt: tm.joinedAt,
        member: memberMap.get(tm.memberId),
      })),
      isMine: tms.some((tm) => tm.memberId === viewerId),
    };
  });

  return c.json({ data: result });
});

// GET /api/teams/:id
teamRoutes.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const team = await db.select().from(schema.teams).where(eq(schema.teams.id, c.req.param("id"))).get();
  if (!team) return c.json({ error: { code: "not_found", message: "チームが見つかりません" } }, 404);

  const tms = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.teamId, team.id)).all();
  const members = tms.length > 0
    ? await db.select({
        id: schema.members.id, name: schema.members.name, furigana: schema.members.furigana,
        emoji: schema.members.emoji, bgColor: schema.members.bgColor, category: schema.members.category,
      }).from(schema.members).all()
    : [];
  const memberMap = new Map(members.map((m) => [m.id, m]));

  return c.json({
    data: {
      id: team.id,
      name: team.name,
      emblemEmoji: team.emblemEmoji,
      seasonId: team.seasonId,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
      members: tms.map((tm) => ({
        id: tm.id,
        memberId: tm.memberId,
        teamId: tm.teamId,
        isLeader: !!tm.isLeader,
        joinedAt: tm.joinedAt,
        member: memberMap.get(tm.memberId),
      })),
    },
  });
});

// GET /api/teams/ranking
teamRoutes.get("/ranking", async (c) => {
  const db = createDb(c.env.DB);
  const teams = await db.select().from(schema.teams).all();
  const allTeamMembers = await db.select().from(schema.teamMembers).all();

  const pointRows = await db
    .select({
      memberId: schema.pointTransactions.memberId,
      total: sql<number>`sum(${schema.pointTransactions.delta})`.as("total"),
    })
    .from(schema.pointTransactions)
    .where(sql`${schema.pointTransactions.delta} > 0`)
    .groupBy(schema.pointTransactions.memberId)
    .all();

  const pointMap = new Map(pointRows.map((r) => [r.memberId, r.total ?? 0]));

  const teamPoints = teams.map((t) => {
    const tms = allTeamMembers.filter((tm) => tm.teamId === t.id);
    const total = tms.reduce((sum, tm) => sum + (pointMap.get(tm.memberId) ?? 0), 0);
    return { team: { id: t.id, name: t.name, emblemEmoji: t.emblemEmoji }, totalPoints: total };
  });

  teamPoints.sort((a, b) => b.totalPoints - a.totalPoints);

  return c.json({
    data: teamPoints.map((tp, i) => ({ rank: i + 1, ...tp })),
  });
});
