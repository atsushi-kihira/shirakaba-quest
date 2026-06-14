// =============================================================
// 管理者向け USP 管理ルート
// GET    /api/admin/usps
// POST   /api/admin/usps
// PATCH  /api/admin/usps/:id
// DELETE /api/admin/usps/:id
// PUT    /api/admin/usps/reorder  — 並び順一括更新
// POST   /api/admin/usps/import   — 一括インポート（同名は上書き、新規は追加）
// =============================================================
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { newId } from "../../services/auth.ts";
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

// ---- POST /api/admin/usps/import ---- 一括インポート（同名は上書き、新規は追加）
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

  const existing = await db.select().from(schema.usps).all();
  const existingByName = new Map(existing.map((u) => [u.name, u]));
  let nextOrder = existing.reduce((max, u) => Math.max(max, u.sortOrder), 0) + 1;

  let created = 0;
  let updated = 0;

  for (const item of body.usps) {
    const name = item.name?.trim();
    if (!name) continue;

    const match = existingByName.get(name);
    if (match) {
      await db.update(schema.usps).set({
        emoji: item.emoji ?? match.emoji,
        description: item.description ?? match.description,
        ...(item.sortOrder !== undefined && { sortOrder: item.sortOrder }),
        updatedAt: now,
      }).where(eq(schema.usps.id, match.id));
      updated += 1;
    } else {
      await db.insert(schema.usps).values({
        id: newId(),
        name,
        emoji: item.emoji ?? "⭐",
        description: item.description ?? null,
        sortOrder: item.sortOrder ?? nextOrder++,
        createdAt: now,
        updatedAt: now,
      });
      created += 1;
    }
  }

  return c.json({ data: { created, updated } });
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
