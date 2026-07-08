// =============================================================
// 管理者向け カード作成設定 & 発注管理ルート
// GET    /api/admin/card-print          — 設定取得
// PUT    /api/admin/card-print          — 設定更新
// GET    /api/admin/card-print/orders   — 発注一覧
// PATCH  /api/admin/card-print/orders/:id — ステータス更新
// =============================================================
import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import type { Env, Variables } from "../../types.ts";

export const adminCardPrintRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- GET /api/admin/card-print ----
adminCardPrintRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const design = await db.select({
    cardPrintEnabled:         schema.cardDesigns.cardPrintEnabled,
    cardPrintCompanyName:     schema.cardDesigns.cardPrintCompanyName,
    cardPrintCompanyUrl:      schema.cardDesigns.cardPrintCompanyUrl,
    cardPrintContactPerson:   schema.cardDesigns.cardPrintContactPerson,
    cardPrintContactEmail:    schema.cardDesigns.cardPrintContactEmail,
    cardPrintContactPhone:    schema.cardDesigns.cardPrintContactPhone,
    cardPrintImageOnlyPrice:  schema.cardDesigns.cardPrintImageOnlyPrice,
    cardPrintImageOnlyName:   schema.cardDesigns.cardPrintImageOnlyName,
    cardPrintPlans:           schema.cardDesigns.cardPrintPlans,
    cardPrintThankYouMessage: schema.cardDesigns.cardPrintThankYouMessage,
  }).from(schema.cardDesigns).get();

  if (!design) return c.json({ data: null });

  return c.json({
    data: {
      ...design,
      cardPrintPlans: JSON.parse(design.cardPrintPlans || "[]"),
    },
  });
});

// ---- PUT /api/admin/card-print ----
adminCardPrintRoutes.put("/", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const adminId = c.get("userId");

  const body = await c.req.json<{
    cardPrintEnabled?: boolean;
    cardPrintCompanyName?: string;
    cardPrintCompanyUrl?: string;
    cardPrintContactPerson?: string;
    cardPrintContactEmail?: string;
    cardPrintContactPhone?: string;
    cardPrintImageOnlyPrice?: number | null;
    cardPrintImageOnlyName?: string;
    cardPrintPlans?: Array<{ name: string; price: number }>;
    cardPrintThankYouMessage?: string;
  }>();

  await db.update(schema.cardDesigns).set({
    ...(body.cardPrintEnabled         !== undefined && { cardPrintEnabled: body.cardPrintEnabled ? 1 : 0 }),
    ...(body.cardPrintCompanyName     !== undefined && { cardPrintCompanyName: body.cardPrintCompanyName }),
    ...(body.cardPrintCompanyUrl      !== undefined && { cardPrintCompanyUrl: body.cardPrintCompanyUrl }),
    ...(body.cardPrintContactPerson   !== undefined && { cardPrintContactPerson: body.cardPrintContactPerson }),
    ...(body.cardPrintContactEmail    !== undefined && { cardPrintContactEmail: body.cardPrintContactEmail }),
    ...(body.cardPrintContactPhone    !== undefined && { cardPrintContactPhone: body.cardPrintContactPhone }),
    ...(body.cardPrintImageOnlyPrice  !== undefined && { cardPrintImageOnlyPrice: body.cardPrintImageOnlyPrice }),
    ...(body.cardPrintImageOnlyName   !== undefined && { cardPrintImageOnlyName: body.cardPrintImageOnlyName }),
    ...(body.cardPrintPlans           !== undefined && { cardPrintPlans: JSON.stringify(body.cardPrintPlans) }),
    ...(body.cardPrintThankYouMessage !== undefined && { cardPrintThankYouMessage: body.cardPrintThankYouMessage }),
    updatedAt: now,
    updatedBy: adminId,
  }).where(eq(schema.cardDesigns.id, "default"));

  return c.json({ ok: true });
});

// ---- GET /api/admin/card-print/orders ----
adminCardPrintRoutes.get("/orders", async (c) => {
  const db = createDb(c.env.DB);
  const orders = await db
    .select()
    .from(schema.cardOrders)
    .orderBy(desc(schema.cardOrders.createdAt))
    .all();

  return c.json({
    data: orders.map((o) => ({
      ...o,
      memberSnapshot: JSON.parse(o.memberSnapshot || "{}"),
    })),
  });
});

// ---- PATCH /api/admin/card-print/orders/:id ----
adminCardPrintRoutes.patch("/orders/:id", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const { status } = await c.req.json<{ status: string }>();

  await db.update(schema.cardOrders).set({
    status,
    updatedAt: now,
  }).where(eq(schema.cardOrders.id, c.req.param("id")));

  return c.json({ ok: true });
});

// ---- DELETE /api/admin/card-print/orders/:id ----
// 完了・キャンセルのみ削除可能
adminCardPrintRoutes.delete("/orders/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");

  const order = await db.select({ id: schema.cardOrders.id, status: schema.cardOrders.status })
    .from(schema.cardOrders)
    .where(eq(schema.cardOrders.id, id))
    .get();

  if (!order) {
    return c.json({ error: { code: "not_found", message: "発注データが見つかりません" } }, 404);
  }

  if (order.status !== "completed" && order.status !== "cancelled") {
    return c.json({ error: { code: "forbidden", message: "完了またはキャンセルの発注のみ削除できます" } }, 403);
  }

  await db.delete(schema.cardOrders).where(eq(schema.cardOrders.id, id));
  return c.json({ ok: true });
});
