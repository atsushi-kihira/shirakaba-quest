// 自分の調整カレンダー設定 CRUD
// GET    /api/scheduler/me/settings
// PUT    /api/scheduler/me/settings
// GET    /api/scheduler/me/availability-rules
// PUT    /api/scheduler/me/availability-rules
// GET    /api/scheduler/me/overrides
// POST   /api/scheduler/me/overrides
// DELETE /api/scheduler/me/overrides/:id
// GET    /api/scheduler/me/public-url

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { newId } from "../../services/auth.ts";
import type { Env, Variables } from "../../types.ts";

export const schedulerSettingsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- settings ----

schedulerSettingsRoutes.get("/settings", async (c) => {
  const memberId = c.get("userId");
  const db = createDb(c.env.DB);

  const settings = await db
    .select()
    .from(schema.memberSchedulingSettings)
    .where(eq(schema.memberSchedulingSettings.memberId, memberId))
    .get();

  return c.json({ data: settings ?? null });
});

schedulerSettingsRoutes.put("/settings", async (c) => {
  const memberId = c.get("userId");
  const db = createDb(c.env.DB);
  const body = await c.req.json<{
    slug?: string;
    displayTitle?: string;
    description?: string;
    durationMinutes?: number;
    bufferBeforeMinutes?: number;
    bufferAfterMinutes?: number;
    minNoticeMinutes?: number;
    maxAdvanceDays?: number;
    dailyMaxBookings?: number | null;
    slotIntervalMinutes?: number;
    locationNote?: string | null;
    isPublic?: boolean;
  }>();

  const now = new Date().toISOString();
  const existing = await db
    .select()
    .from(schema.memberSchedulingSettings)
    .where(eq(schema.memberSchedulingSettings.memberId, memberId))
    .get();

  // slug の重複チェック
  if (body.slug && body.slug !== existing?.slug) {
    const conflict = await db
      .select({ memberId: schema.memberSchedulingSettings.memberId })
      .from(schema.memberSchedulingSettings)
      .where(eq(schema.memberSchedulingSettings.slug, body.slug))
      .get();
    if (conflict) {
      return c.json({ error: { code: "slug_taken", message: "その URL スラッグは既に使用されています" } }, 409);
    }
  }

  if (!existing) {
    // メールから自動 slug 生成（未設定時）
    const member = await db
      .select({ email: schema.members.email })
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .get();
    const autoSlug = body.slug ?? (member?.email.split("@")[0] ?? memberId.slice(0, 8));

    await db.insert(schema.memberSchedulingSettings).values({
      memberId,
      slug: autoSlug,
      displayTitle: body.displayTitle ?? "1on1 ミーティング",
      description: body.description ?? null,
      durationMinutes: body.durationMinutes ?? 30,
      bufferBeforeMinutes: body.bufferBeforeMinutes ?? 0,
      bufferAfterMinutes: body.bufferAfterMinutes ?? 10,
      minNoticeMinutes: body.minNoticeMinutes ?? 1440,
      maxAdvanceDays: body.maxAdvanceDays ?? 60,
      dailyMaxBookings: body.dailyMaxBookings ?? null,
      slotIntervalMinutes: body.slotIntervalMinutes ?? 30,
      locationNote: body.locationNote ?? null,
      isPublic: body.isPublic !== false ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db
      .update(schema.memberSchedulingSettings)
      .set({
        ...(body.slug !== undefined && { slug: body.slug }),
        ...(body.displayTitle !== undefined && { displayTitle: body.displayTitle }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.durationMinutes !== undefined && { durationMinutes: body.durationMinutes }),
        ...(body.bufferBeforeMinutes !== undefined && { bufferBeforeMinutes: body.bufferBeforeMinutes }),
        ...(body.bufferAfterMinutes !== undefined && { bufferAfterMinutes: body.bufferAfterMinutes }),
        ...(body.minNoticeMinutes !== undefined && { minNoticeMinutes: body.minNoticeMinutes }),
        ...(body.maxAdvanceDays !== undefined && { maxAdvanceDays: body.maxAdvanceDays }),
        ...(body.dailyMaxBookings !== undefined && { dailyMaxBookings: body.dailyMaxBookings }),
        ...(body.slotIntervalMinutes !== undefined && { slotIntervalMinutes: body.slotIntervalMinutes }),
        ...(body.locationNote !== undefined && { locationNote: body.locationNote }),
        ...(body.isPublic !== undefined && { isPublic: body.isPublic ? 1 : 0 }),
        updatedAt: now,
      })
      .where(eq(schema.memberSchedulingSettings.memberId, memberId));
  }

  const updated = await db
    .select()
    .from(schema.memberSchedulingSettings)
    .where(eq(schema.memberSchedulingSettings.memberId, memberId))
    .get();

  return c.json({ data: updated });
});

// ---- availability-rules ----

schedulerSettingsRoutes.get("/availability-rules", async (c) => {
  const memberId = c.get("userId");
  const db = createDb(c.env.DB);

  const rules = await db
    .select()
    .from(schema.availabilityRules)
    .where(eq(schema.availabilityRules.memberId, memberId))
    .all();

  return c.json({ data: rules });
});

schedulerSettingsRoutes.put("/availability-rules", async (c) => {
  const memberId = c.get("userId");
  const db = createDb(c.env.DB);
  const body = await c.req.json<{
    rules: {
      dayOfWeek: number;
      startTimeLocal: string;
      endTimeLocal: string;
      timezone?: string;
    }[];
  }>();

  // 既存ルールを全削除してから再挿入
  await db.delete(schema.availabilityRules).where(eq(schema.availabilityRules.memberId, memberId));

  if (body.rules.length > 0) {
    await db.insert(schema.availabilityRules).values(
      body.rules.map((r) => ({
        id: newId(),
        memberId,
        dayOfWeek: r.dayOfWeek,
        startTimeLocal: r.startTimeLocal,
        endTimeLocal: r.endTimeLocal,
        timezone: r.timezone ?? "Asia/Tokyo",
      }))
    );
  }

  const rules = await db
    .select()
    .from(schema.availabilityRules)
    .where(eq(schema.availabilityRules.memberId, memberId))
    .all();

  return c.json({ data: rules });
});

// ---- overrides ----

schedulerSettingsRoutes.get("/overrides", async (c) => {
  const memberId = c.get("userId");
  const db = createDb(c.env.DB);

  const overrides = await db
    .select()
    .from(schema.availabilityOverrides)
    .where(eq(schema.availabilityOverrides.memberId, memberId))
    .all();

  return c.json({ data: overrides });
});

schedulerSettingsRoutes.post("/overrides", async (c) => {
  const memberId = c.get("userId");
  const db = createDb(c.env.DB);
  const body = await c.req.json<{
    dateLocal: string;
    isBlocked?: boolean;
    startTimeLocal?: string;
    endTimeLocal?: string;
    note?: string;
  }>();

  const id = newId();
  await db.insert(schema.availabilityOverrides).values({
    id,
    memberId,
    dateLocal: body.dateLocal,
    isBlocked: body.isBlocked ? 1 : 0,
    startTimeLocal: body.startTimeLocal ?? null,
    endTimeLocal: body.endTimeLocal ?? null,
    note: body.note ?? null,
  });

  return c.json({ data: { id } }, 201);
});

schedulerSettingsRoutes.delete("/overrides/:id", async (c) => {
  const memberId = c.get("userId");
  const overrideId = c.req.param("id");
  const db = createDb(c.env.DB);

  const existing = await db
    .select({ memberId: schema.availabilityOverrides.memberId })
    .from(schema.availabilityOverrides)
    .where(eq(schema.availabilityOverrides.id, overrideId))
    .get();

  if (!existing || existing.memberId !== memberId) {
    return c.json({ error: { code: "not_found", message: "見つかりません" } }, 404);
  }

  await db.delete(schema.availabilityOverrides).where(eq(schema.availabilityOverrides.id, overrideId));
  return c.json({ data: { deleted: true } });
});

// ---- public-url ----

schedulerSettingsRoutes.get("/public-url", async (c) => {
  const memberId = c.get("userId");
  const db = createDb(c.env.DB);

  const settings = await db
    .select({ slug: schema.memberSchedulingSettings.slug })
    .from(schema.memberSchedulingSettings)
    .where(eq(schema.memberSchedulingSettings.memberId, memberId))
    .get();

  const frontendUrl = c.env.FRONTEND_URL ?? "https://shirakaba-quest.pages.dev";
  const url = settings ? `${frontendUrl}/book/${settings.slug}` : null;

  return c.json({ data: { slug: settings?.slug ?? null, publicUrl: url } });
});
