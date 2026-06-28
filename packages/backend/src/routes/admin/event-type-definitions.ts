// =============================================================
// 管理者 — イベント種別定義 CRUD
// GET    /api/admin/event-type-definitions
// POST   /api/admin/event-type-definitions
// PATCH  /api/admin/event-type-definitions/:id
// DELETE /api/admin/event-type-definitions/:id （is_system=1 は削除不可）
// =============================================================
import { Hono } from "hono";
import { eq, asc } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { newId } from "../../services/auth.ts";
import type { Env, Variables } from "../../types.ts";

export const adminEventTypeDefinitionRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

adminEventTypeDefinitionRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.eventTypeDefinitions)
    .orderBy(asc(schema.eventTypeDefinitions.sortOrder), asc(schema.eventTypeDefinitions.createdAt))
    .all();
  return c.json({ data: rows });
});

adminEventTypeDefinitionRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const body = await c.req.json<{
    slug?: string;
    name: string;
    description?: string;
    emoji?: string;
    triggerType: "one_on_one" | "meeting_attendance" | "display_only" | "on_action";
    pointValue?: number;
    rewardTarget?: "participant" | "partner_of_related" | "none";
    requiresTargetMember?: boolean;
    creatorRole?: "admin" | "member";
    linksToMeeting?: boolean;
    sortOrder?: number;
  }>();

  if (!body.name?.trim()) {
    return c.json({ error: { code: "invalid_input", message: "種別名は必須です" } }, 400);
  }

  const id = newId();
  const slug = body.slug?.trim() || id;

  await db.insert(schema.eventTypeDefinitions).values({
    id,
    slug,
    name: body.name.trim(),
    description: body.description?.trim() ?? "",
    emoji: body.emoji ?? "🎉",
    triggerType: body.triggerType ?? "on_action",
    pointValue: body.pointValue ?? 0,
    rewardTarget: body.rewardTarget ?? "participant",
    requiresTargetMember: body.requiresTargetMember ? 1 : 0,
    creatorRole: body.creatorRole ?? "admin",
    linksToMeeting: body.linksToMeeting ? 1 : 0,
    isSystem: 0,
    isActive: 1,
    sortOrder: body.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
  });

  const row = await db.select().from(schema.eventTypeDefinitions).where(eq(schema.eventTypeDefinitions.id, id)).get();
  return c.json({ data: row }, 201);
});

adminEventTypeDefinitionRoutes.patch("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const { id } = c.req.param();
  const body = await c.req.json<{
    name?: string;
    description?: string;
    emoji?: string;
    triggerType?: "one_on_one" | "meeting_attendance" | "display_only";
    pointValue?: number;
    rewardTarget?: "participant" | "partner_of_related" | "none";
    requiresTargetMember?: boolean;
    creatorRole?: "admin" | "member";
    linksToMeeting?: boolean;
    isActive?: boolean;
    sortOrder?: number;
  }>();

  const existing = await db.select().from(schema.eventTypeDefinitions)
    .where(eq(schema.eventTypeDefinitions.id, id)).get();
  if (!existing) return c.json({ error: { code: "not_found", message: "見つかりません" } }, 404);

  await db.update(schema.eventTypeDefinitions).set({
    ...(body.name      !== undefined && { name: body.name.trim() }),
    ...(body.description !== undefined && { description: body.description.trim() }),
    ...(body.emoji     !== undefined && { emoji: body.emoji }),
    ...(body.pointValue !== undefined && { pointValue: body.pointValue }),
    ...(body.isActive  !== undefined && { isActive: body.isActive ? 1 : 0 }),
    ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
    ...(body.triggerType           !== undefined && { triggerType: body.triggerType }),
    ...(body.rewardTarget          !== undefined && { rewardTarget: body.rewardTarget }),
    ...(body.requiresTargetMember  !== undefined && { requiresTargetMember: body.requiresTargetMember ? 1 : 0 }),
    ...(body.creatorRole           !== undefined && { creatorRole: body.creatorRole }),
    ...(body.linksToMeeting        !== undefined && { linksToMeeting: body.linksToMeeting ? 1 : 0 }),
    updatedAt: now,
  }).where(eq(schema.eventTypeDefinitions.id, id));

  const row = await db.select().from(schema.eventTypeDefinitions).where(eq(schema.eventTypeDefinitions.id, id)).get();
  return c.json({ data: row });
});

adminEventTypeDefinitionRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const { id } = c.req.param();

  const existing = await db.select().from(schema.eventTypeDefinitions)
    .where(eq(schema.eventTypeDefinitions.id, id)).get();
  if (!existing) return c.json({ error: { code: "not_found", message: "見つかりません" } }, 404);
  if (existing.isSystem === 1) {
    return c.json({ error: { code: "system_type", message: "システム組込み種別は削除できません" } }, 403);
  }

  await db.update(schema.eventTypeDefinitions)
    .set({ isActive: 0, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.eventTypeDefinitions.id, id));

  return c.json({ ok: true });
});
