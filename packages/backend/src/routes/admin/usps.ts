// =============================================================
// 管理者向け USP 管理ルート
// GET    /api/admin/usps
// POST   /api/admin/usps
// PATCH  /api/admin/usps/:id
// DELETE /api/admin/usps/:id
// PUT    /api/admin/usps/reorder  — 並び順一括更新
// POST   /api/admin/usps/import   — 一括インポート（既存を全削除し、インポート内容に置き換える）
// =============================================================
import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { newId } from "../../services/auth.ts";
import { sendUspRequestResultMail } from "../../services/mailer.ts";
import type { Env, Variables } from "../../types.ts";

export const adminUspRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- GET /api/admin/usps ----
adminUspRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const usps = await db
    .select()
    .from(schema.usps)
    .orderBy(schema.usps.sortOrder)
    .all();
  return c.json({ data: usps });
});

// ---- POST /api/admin/usps ----
adminUspRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    name: string;
    emoji?: string;
    description?: string;
    sortOrder?: number;
  }>();

  if (!body.name?.trim()) {
    return c.json({ error: { code: "invalid_input", message: "名前は必須です" } }, 400);
  }

  // 重複チェック
  const existing = await db
    .select({ id: schema.usps.id })
    .from(schema.usps)
    .where(eq(schema.usps.name, body.name.trim()))
    .get();
  if (existing) {
    return c.json({ error: { code: "duplicate", message: "同じ名前のUSPがすでに存在します" } }, 409);
  }

  // sortOrder 未指定なら末尾に追加
  const maxOrder = await db
    .select({ sortOrder: schema.usps.sortOrder })
    .from(schema.usps)
    .orderBy(schema.usps.sortOrder)
    .all();
  const nextOrder = body.sortOrder ?? ((maxOrder.at(-1)?.sortOrder ?? 0) + 1);

  const id = newId();
  await db.insert(schema.usps).values({
    id,
    name: body.name.trim(),
    emoji: body.emoji ?? "⭐",
    description: body.description ?? null,
    sortOrder: nextOrder,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ data: { id } }, 201);
});

// ---- PATCH /api/admin/usps/:id ----
adminUspRoutes.patch("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    name?: string;
    emoji?: string;
    description?: string;
    sortOrder?: number;
  }>();

  // 名前変更時の重複チェック
  if (body.name) {
    const existing = await db
      .select({ id: schema.usps.id })
      .from(schema.usps)
      .where(eq(schema.usps.name, body.name.trim()))
      .get();
    if (existing && existing.id !== id) {
      return c.json({ error: { code: "duplicate", message: "同じ名前のUSPがすでに存在します" } }, 409);
    }
  }

  await db.update(schema.usps).set({
    ...(body.name        !== undefined && { name: body.name.trim() }),
    ...(body.emoji       !== undefined && { emoji: body.emoji }),
    ...(body.description !== undefined && { description: body.description }),
    ...(body.sortOrder   !== undefined && { sortOrder: body.sortOrder }),
    updatedAt: now,
  }).where(eq(schema.usps.id, id));

  return c.json({ ok: true });
});

// ---- DELETE /api/admin/usps/:id ----
adminUspRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  await db.delete(schema.usps).where(eq(schema.usps.id, c.req.param("id")));
  return c.json({ ok: true });
});

// ---- POST /api/admin/usps/import ---- 一括インポート（既存USPを全て削除し、インポート内容に置き換える）
adminUspRoutes.post("/import", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    usps: Array<{
      name: string;
      emoji?: string;
      description?: string;
      sortOrder?: number;
    }>;
  }>();

  if (!Array.isArray(body.usps) || body.usps.length === 0) {
    return c.json({ error: { code: "invalid_input", message: "インポートするUSPがありません" } }, 400);
  }

  const items = body.usps
    .map((item) => ({ ...item, name: item.name?.trim() }))
    .filter((item): item is { name: string; emoji?: string; description?: string; sortOrder?: number } => !!item.name);

  if (items.length === 0) {
    return c.json({ error: { code: "invalid_input", message: "インポートするUSPがありません" } }, 400);
  }

  // 既存のUSPを全削除してから、インポート内容で置き換える
  await db.delete(schema.usps);

  await db.insert(schema.usps).values(
    items.map((item, idx) => ({
      id: newId(),
      name: item.name,
      emoji: item.emoji ?? "⭐",
      description: item.description ?? null,
      sortOrder: item.sortOrder ?? idx + 1,
      createdAt: now,
      updatedAt: now,
    }))
  );

  return c.json({ data: { count: items.length } });
});

// ============================================================
// USP承認申請 — 管理者向け
// ============================================================

// ---- GET /api/admin/usp-requests ----
adminUspRoutes.get("/requests", async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.uspRequests)
    .orderBy(desc(schema.uspRequests.createdAt))
    .all();
  return c.json({ data: rows });
});

// ---- POST /api/admin/usp-requests/:id/approve ----
adminUspRoutes.post("/requests/:id/approve", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const reqId = c.req.param("id");
  const now = Math.floor(Date.now() / 1000);
  const isDev = c.env.ENVIRONMENT === "development";
  const { reviewNote } = await c.req.json<{ reviewNote?: string }>().catch(() => ({ reviewNote: undefined }));

  const req = await db.select().from(schema.uspRequests).where(eq(schema.uspRequests.id, reqId)).get();
  if (!req) return c.json({ error: { code: "not_found", message: "申請が見つかりません" } }, 404);
  if (req.status !== "pending") return c.json({ error: { code: "already_reviewed", message: "すでに審査済みです" } }, 409);

  // USPを追加（重複チェック込み）
  const existing = await db.select({ id: schema.usps.id }).from(schema.usps).where(eq(schema.usps.name, req.uspName)).get();
  if (!existing) {
    const maxOrder = await db.select({ sortOrder: schema.usps.sortOrder }).from(schema.usps).orderBy(schema.usps.sortOrder).all();
    await db.insert(schema.usps).values({
      id: newId(),
      name: req.uspName,
      emoji: req.emoji,
      description: req.description ?? null,
      sortOrder: (maxOrder.at(-1)?.sortOrder ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  await db.update(schema.uspRequests).set({
    status: "approved",
    reviewNote: reviewNote ?? null,
    reviewedBy: adminId,
    reviewedAt: now,
  }).where(eq(schema.uspRequests.id, reqId));

  // 申請者へメール通知
  const appDesign = await db.select({ appTitle: schema.cardDesigns.appTitle }).from(schema.cardDesigns).get();
  sendUspRequestResultMail({
    to: req.requesterEmail,
    requesterName: req.requesterName,
    uspName: req.uspName,
    emoji: req.emoji,
    approved: true,
    reviewNote,
    appTitle: appDesign?.appTitle ?? "白樺クエスト",
    apiKey: c.env.SENDGRID_API_KEY,
    isDev,
    fromEmail: c.env.SENDGRID_FROM_EMAIL,
  }).catch((e) => console.error("[usp-approve-mail]", e));

  return c.json({ ok: true });
});

// ---- POST /api/admin/usp-requests/:id/reject ----
adminUspRoutes.post("/requests/:id/reject", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const reqId = c.req.param("id");
  const now = Math.floor(Date.now() / 1000);
  const isDev = c.env.ENVIRONMENT === "development";
  const { reviewNote } = await c.req.json<{ reviewNote?: string }>().catch(() => ({ reviewNote: undefined }));

  const req = await db.select().from(schema.uspRequests).where(eq(schema.uspRequests.id, reqId)).get();
  if (!req) return c.json({ error: { code: "not_found", message: "申請が見つかりません" } }, 404);
  if (req.status !== "pending") return c.json({ error: { code: "already_reviewed", message: "すでに審査済みです" } }, 409);

  await db.update(schema.uspRequests).set({
    status: "rejected",
    reviewNote: reviewNote ?? null,
    reviewedBy: adminId,
    reviewedAt: now,
  }).where(eq(schema.uspRequests.id, reqId));

  const appDesign = await db.select({ appTitle: schema.cardDesigns.appTitle }).from(schema.cardDesigns).get();
  sendUspRequestResultMail({
    to: req.requesterEmail,
    requesterName: req.requesterName,
    uspName: req.uspName,
    emoji: req.emoji,
    approved: false,
    reviewNote,
    appTitle: appDesign?.appTitle ?? "白樺クエスト",
    apiKey: c.env.SENDGRID_API_KEY,
    isDev,
    fromEmail: c.env.SENDGRID_FROM_EMAIL,
  }).catch((e) => console.error("[usp-reject-mail]", e));

  return c.json({ ok: true });
});

// ---- PUT /api/admin/usps/reorder ---- 並び順一括更新
adminUspRoutes.put("/reorder", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const { order } = await c.req.json<{ order: string[] }>(); // USP id の配列

  await Promise.all(
    order.map((id, idx) =>
      db.update(schema.usps)
        .set({ sortOrder: idx + 1, updatedAt: now })
        .where(eq(schema.usps.id, id))
    )
  );

  return c.json({ ok: true });
});
