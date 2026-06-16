// =============================================================
// 管理者イベントルート
// GET    /api/admin/events
// POST   /api/admin/events
// PATCH  /api/admin/events/:id
// DELETE /api/admin/events/:id
// =============================================================
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { newId } from "../../services/auth.ts";
import type { Env, Variables } from "../../types.ts";

export const adminEventRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/admin/events
adminEventRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const events = await db
    .select()
    .from(schema.eventCampaigns)
    .orderBy(sql`${schema.eventCampaigns.createdAt} DESC`)
    .all();
  return c.json({ data: events.map(toPublic) });
});

// POST /api/admin/events
adminEventRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const body = await c.req.json<{
    type: string;
    title: string;
    description?: string;
    startsAt?: number;
    endsAt?: number;
    relatedMemberId?: string;
    multiplier?: number;
  }>();

  if (!body.title?.trim()) {
    return c.json({ error: { code: "invalid_input", message: "タイトルは必須です" } }, 400);
  }

  const id = newId();
  await db.insert(schema.eventCampaigns).values({
    id,
    type: body.type ?? "special_quest_week",
    title: body.title.trim(),
    description: body.description?.trim() ?? "",
    startsAt: body.startsAt ?? now,
    endsAt: body.endsAt ?? null,
    relatedMemberId: body.relatedMemberId ?? null,
    multiplier: body.multiplier ?? null,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  const event = await db.select().from(schema.eventCampaigns).where(eq(schema.eventCampaigns.id, id)).get();
  return c.json({ data: toPublic(event!) }, 201);
});

// PATCH /api/admin/events/:id
adminEventRoutes.patch("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const body = await c.req.json<{
    title?: string;
    description?: string;
    endsAt?: number | null;
    relatedMemberId?: string | null;
    status?: string;
  }>().catch(() => ({} as { title?: string; description?: string; endsAt?: number | null; relatedMemberId?: string | null; status?: string }));

  await db.update(schema.eventCampaigns).set({
    ...(body.title       !== undefined && { title: body.title.trim() }),
    ...(body.description !== undefined && { description: body.description.trim() }),
    ...(body.endsAt      !== undefined && { endsAt: body.endsAt }),
    ...(body.relatedMemberId !== undefined && { relatedMemberId: body.relatedMemberId }),
    ...(body.status      !== undefined && { status: body.status }),
    updatedAt: now,
  }).where(eq(schema.eventCampaigns.id, c.req.param("id")));

  return c.json({ ok: true });
});

// DELETE /api/admin/events/:id
adminEventRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  await db.update(schema.eventCampaigns)
    .set({ status: "ended", updatedAt: now })
    .where(eq(schema.eventCampaigns.id, c.req.param("id")));

  return c.json({ ok: true });
});

function toPublic(e: typeof schema.eventCampaigns.$inferSelect) {
  return {
    id: e.id,
    type: e.type,
    title: e.title,
    description: e.description,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    relatedMemberId: e.relatedMemberId,
    multiplier: e.multiplier,
    status: e.status,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}
