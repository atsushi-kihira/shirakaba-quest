// =============================================================
// 管理者イベントルート
// GET    /api/admin/events
// POST   /api/admin/events
// PATCH  /api/admin/events/:id
// DELETE /api/admin/events/:id  → status を "deleted" に設定（表示から非表示）
// =============================================================
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { newId } from "../../services/auth.ts";
import type { Env, Variables } from "../../types.ts";

export const adminEventRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/admin/events — deleted 以外を返す（active 先、ended 後）
adminEventRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const events = await db
    .select()
    .from(schema.eventCampaigns)
    .where(sql`${schema.eventCampaigns.status} != 'deleted'`)
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
    relatedMemberIds?: string[];
    multiplier?: number;
  }>();

  if (!body.title?.trim()) {
    return c.json({ error: { code: "invalid_input", message: "タイトルは必須です" } }, 400);
  }

  const memberIds = body.relatedMemberIds ?? (body.relatedMemberId ? [body.relatedMemberId] : []);

  const id = newId();
  await db.insert(schema.eventCampaigns).values({
    id,
    type: body.type ?? "special_quest_week",
    title: body.title.trim(),
    description: body.description?.trim() ?? "",
    startsAt: body.startsAt ?? now,
    endsAt: body.endsAt ?? null,
    relatedMemberId: memberIds[0] ?? null,
    relatedMemberIds: memberIds.length > 0 ? JSON.stringify(memberIds) : null,
    multiplier: body.multiplier ?? null,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  const event = await db.select().from(schema.eventCampaigns).where(eq(schema.eventCampaigns.id, id)).get();
  return c.json({ data: toPublic(event!) }, 201);
});

// PATCH /api/admin/events/:id — 全フィールド更新対応
adminEventRoutes.patch("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const body = await c.req.json<{
    title?: string;
    description?: string;
    type?: string;
    startsAt?: number;
    endsAt?: number | null;
    relatedMemberId?: string | null;
    relatedMemberIds?: string[];
    multiplier?: number | null;
    status?: string;
  }>().catch(() => ({}));

  const memberIdsUpdate = body.relatedMemberIds !== undefined ? {
    relatedMemberIds: body.relatedMemberIds.length > 0 ? JSON.stringify(body.relatedMemberIds) : null,
    relatedMemberId: body.relatedMemberIds[0] ?? null,
  } : {};

  await db.update(schema.eventCampaigns).set({
    ...(body.title        !== undefined && { title: body.title.trim() }),
    ...(body.description  !== undefined && { description: body.description.trim() }),
    ...(body.type         !== undefined && { type: body.type }),
    ...(body.startsAt     !== undefined && { startsAt: body.startsAt }),
    ...(body.endsAt       !== undefined && { endsAt: body.endsAt }),
    ...(body.multiplier   !== undefined && { multiplier: body.multiplier }),
    ...(body.status       !== undefined && { status: body.status }),
    ...memberIdsUpdate,
    updatedAt: now,
  }).where(eq(schema.eventCampaigns.id, c.req.param("id")));

  return c.json({ ok: true });
});

// DELETE /api/admin/events/:id — 表示上削除（status を "deleted" に）
adminEventRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  await db.update(schema.eventCampaigns)
    .set({ status: "deleted", updatedAt: now })
    .where(eq(schema.eventCampaigns.id, c.req.param("id")));

  return c.json({ ok: true });
});

function toPublic(e: typeof schema.eventCampaigns.$inferSelect) {
  const ids = parseIds(e.relatedMemberIds) ?? (e.relatedMemberId ? [e.relatedMemberId] : []);
  return {
    id: e.id,
    type: e.type,
    title: e.title,
    description: e.description,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    relatedMemberId: e.relatedMemberId,
    relatedMemberIds: ids,
    multiplier: e.multiplier,
    status: e.status,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

function parseIds(str: string | null | undefined): string[] | null {
  if (!str) return null;
  try { return JSON.parse(str) as string[]; } catch { return null; }
}
