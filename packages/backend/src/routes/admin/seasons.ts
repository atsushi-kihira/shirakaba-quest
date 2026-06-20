// =============================================================
// 管理者シーズンルート
// GET    /api/admin/seasons
// POST   /api/admin/seasons
// PATCH  /api/admin/seasons/:id
// PATCH  /api/admin/seasons/:id/activate
// PATCH  /api/admin/seasons/:id/end
// =============================================================
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { newId } from "../../services/auth.ts";
import type { Env, Variables } from "../../types.ts";

export const adminSeasonRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/admin/seasons
adminSeasonRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const seasons = await db
    .select()
    .from(schema.seasons)
    .orderBy(sql`${schema.seasons.createdAt} DESC`)
    .all();
  return c.json({ data: seasons.map(toPublic) });
});

// POST /api/admin/seasons
adminSeasonRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  type CreateBody = { name: string; theme?: string; startsAt?: number; endsAt?: number; pointOneOnOne?: number; pointRealCard?: number; pointQuestNormal?: number; pointQuestHard?: number; pointWelcomeQuestBonus?: number };
  const body = await c.req.json<CreateBody>();

  if (!body.name?.trim()) {
    return c.json({ error: { code: "invalid_input", message: "シーズン名は必須です" } }, 400);
  }

  const id = newId();
  await db.insert(schema.seasons).values({
    id,
    name: body.name.trim(),
    theme: body.theme?.trim() ?? "",
    startsAt: body.startsAt ?? now,
    endsAt: body.endsAt ?? null,
    isActive: 0,
    createdAt: now,
    updatedAt: now,
    pointOneOnOne:          body.pointOneOnOne          ?? null,
    pointRealCard:          body.pointRealCard           ?? null,
    pointQuestNormal:       body.pointQuestNormal        ?? null,
    pointQuestHard:         body.pointQuestHard          ?? null,
    pointWelcomeQuestBonus: body.pointWelcomeQuestBonus  ?? null,
  });

  const season = await db.select().from(schema.seasons).where(eq(schema.seasons.id, id)).get();
  return c.json({ data: toPublic(season!) }, 201);
});

// PATCH /api/admin/seasons/:id
adminSeasonRoutes.patch("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  type PatchBody = { name?: string; theme?: string; endsAt?: number | null; pointOneOnOne?: number | null; pointRealCard?: number | null; pointQuestNormal?: number | null; pointQuestHard?: number | null; pointWelcomeQuestBonus?: number | null };
  const body = await c.req.json<PatchBody>().catch(() => ({} as PatchBody));

  await db.update(schema.seasons).set({
    ...(body.name  !== undefined && { name: body.name!.trim() }),
    ...(body.theme !== undefined && { theme: body.theme!.trim() }),
    ...(body.endsAt !== undefined && { endsAt: body.endsAt }),
    ...(body.pointOneOnOne          !== undefined && { pointOneOnOne: body.pointOneOnOne }),
    ...(body.pointRealCard           !== undefined && { pointRealCard: body.pointRealCard }),
    ...(body.pointQuestNormal        !== undefined && { pointQuestNormal: body.pointQuestNormal }),
    ...(body.pointQuestHard          !== undefined && { pointQuestHard: body.pointQuestHard }),
    ...(body.pointWelcomeQuestBonus  !== undefined && { pointWelcomeQuestBonus: body.pointWelcomeQuestBonus }),
    updatedAt: now,
  }).where(eq(schema.seasons.id, c.req.param("id")));

  return c.json({ ok: true });
});

// PATCH /api/admin/seasons/:id/activate
adminSeasonRoutes.patch("/:id/activate", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  // 他のシーズンを非アクティブに
  await db.update(schema.seasons).set({ isActive: 0, updatedAt: now });

  // 対象をアクティブに
  await db.update(schema.seasons)
    .set({ isActive: 1, updatedAt: now })
    .where(eq(schema.seasons.id, c.req.param("id")));

  return c.json({ ok: true });
});

// PATCH /api/admin/seasons/:id/end
adminSeasonRoutes.patch("/:id/end", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  await db.update(schema.seasons)
    .set({ isActive: 0, endsAt: now, updatedAt: now })
    .where(eq(schema.seasons.id, c.req.param("id")));

  return c.json({ ok: true });
});

function toPublic(s: typeof schema.seasons.$inferSelect) {
  return {
    id: s.id,
    name: s.name,
    theme: s.theme,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    isActive: !!s.isActive,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    pointOneOnOne:          s.pointOneOnOne          ?? null,
    pointRealCard:          s.pointRealCard           ?? null,
    pointQuestNormal:       s.pointQuestNormal        ?? null,
    pointQuestHard:         s.pointQuestHard          ?? null,
    pointWelcomeQuestBonus: s.pointWelcomeQuestBonus  ?? null,
  };
}
