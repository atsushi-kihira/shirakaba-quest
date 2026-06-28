// =============================================================
// 管理者イベントルート
// GET    /api/admin/events              — deleted を含む全件（typeDefId クエリで絞り込み可）
// POST   /api/admin/events              — 管理者がインスタンス作成
// PATCH  /api/admin/events/:id          — 更新（status='active' で再開も可）
// DELETE /api/admin/events/:id          — status を "deleted" に
// =============================================================
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { newId } from "../../services/auth.ts";
import type { Env, Variables } from "../../types.ts";

export const adminEventRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/admin/events — 全ステータス（deleted 含む）を返す
adminEventRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const typeDefId = c.req.query("typeDefId");

  const events = typeDefId
    ? await db.select().from(schema.eventCampaigns)
        .where(eq(schema.eventCampaigns.eventTypeDefId, typeDefId))
        .orderBy(sql`${schema.eventCampaigns.createdAt} DESC`)
        .all()
    : await db.select().from(schema.eventCampaigns)
        .orderBy(sql`${schema.eventCampaigns.createdAt} DESC`)
        .all();

  return c.json({ data: events.map(toPublic) });
});

// POST /api/admin/events — typeDefId または type(slug) で種別を解決
adminEventRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const body = await c.req.json<{
    typeDefId?: string;
    type?: string;
    title: string;
    description?: string;
    startsAt?: number;
    endsAt?: number;
    relatedMemberId?: string;
    relatedMemberIds?: string[];
    multiplier?: number;
    pointAwardTiming?: string | null;
  }>();

  if (!body.title?.trim()) {
    return c.json({ error: { code: "invalid_input", message: "タイトルは必須です" } }, 400);
  }

  // type def を解決: typeDefId 優先、なければ slug で検索
  let typeDef = null;
  if (body.typeDefId) {
    typeDef = await db.select().from(schema.eventTypeDefinitions)
      .where(eq(schema.eventTypeDefinitions.id, body.typeDefId)).get();
  } else if (body.type) {
    typeDef = await db.select().from(schema.eventTypeDefinitions)
      .where(eq(schema.eventTypeDefinitions.slug, body.type)).get();
  }

  const memberIds = body.relatedMemberIds ?? (body.relatedMemberId ? [body.relatedMemberId] : []);
  const id = newId();

  await db.insert(schema.eventCampaigns).values({
    id,
    type: typeDef?.slug ?? body.type ?? "visitor_invite_quest",
    eventTypeDefId: typeDef?.id ?? null,
    title: body.title.trim(),
    description: body.description?.trim() ?? "",
    startsAt: body.startsAt ?? now,
    endsAt: body.endsAt ?? null,
    relatedMemberId: memberIds[0] ?? null,
    relatedMemberIds: memberIds.length > 0 ? JSON.stringify(memberIds) : null,
    multiplier: body.multiplier ?? null,
    pointAwardTiming: body.pointAwardTiming ?? null,
    status: "active",
    createdByMemberId: null,
    createdAt: now,
    updatedAt: now,
  });

  const event = await db.select().from(schema.eventCampaigns).where(eq(schema.eventCampaigns.id, id)).get();
  return c.json({ data: toPublic(event!) }, 201);
});

// PATCH /api/admin/events/:id — status='active' で再開・typeDefId で種別変更も可
adminEventRoutes.patch("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  type PatchEventBody = {
    typeDefId?: string;
    title?: string;
    description?: string;
    startsAt?: number;
    endsAt?: number | null;
    relatedMemberId?: string | null;
    relatedMemberIds?: string[];
    multiplier?: number | null;
    pointAwardTiming?: string | null;
    status?: string;
  };
  const body = await c.req.json<PatchEventBody>().catch(() => ({} as PatchEventBody));

  // 種別変更: typeDefId が指定された場合は type と event_type_def_id を両方更新
  let typeUpdate: { type?: string; eventTypeDefId?: string | null } = {};
  if (body.typeDefId !== undefined) {
    const typeDef = await db.select().from(schema.eventTypeDefinitions)
      .where(eq(schema.eventTypeDefinitions.id, body.typeDefId)).get();
    if (typeDef) {
      typeUpdate = { type: typeDef.slug, eventTypeDefId: typeDef.id };
    }
  }

  const memberIdsUpdate = body.relatedMemberIds !== undefined ? {
    relatedMemberIds: body.relatedMemberIds.length > 0 ? JSON.stringify(body.relatedMemberIds) : null,
    relatedMemberId: body.relatedMemberIds[0] ?? null,
  } : {};

  await db.update(schema.eventCampaigns).set({
    ...typeUpdate,
    ...(body.title       !== undefined && { title: body.title.trim() }),
    ...(body.description !== undefined && { description: body.description.trim() }),
    ...(body.startsAt    !== undefined && { startsAt: body.startsAt }),
    ...(body.endsAt      !== undefined && { endsAt: body.endsAt }),
    ...(body.multiplier        !== undefined && { multiplier: body.multiplier }),
    ...(body.pointAwardTiming  !== undefined && { pointAwardTiming: body.pointAwardTiming }),
    ...(body.status            !== undefined && { status: body.status }),
    ...memberIdsUpdate,
    updatedAt: now,
  }).where(eq(schema.eventCampaigns.id, c.req.param("id")));

  return c.json({ ok: true });
});

// DELETE /api/admin/events/:id — status を "deleted" に
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
    eventTypeDefId: e.eventTypeDefId ?? null,
    title: e.title,
    description: e.description,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    relatedMemberId: e.relatedMemberId,
    relatedMemberIds: ids,
    multiplier: e.multiplier,
    pointAwardTiming: e.pointAwardTiming ?? null,
    status: e.status,
    createdByMemberId: e.createdByMemberId ?? null,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

function parseIds(str: string | null | undefined): string[] | null {
  if (!str) return null;
  try { return JSON.parse(str) as string[]; } catch { return null; }
}
