// =============================================================
// Web Push ルート
// GET    /api/push/vapid-public-key → 公開鍵の取得（認証不要）
// POST   /api/push/subscribe        → 購読の登録
// DELETE /api/push/subscribe        → 購読の解除
// =============================================================
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId } from "../services/auth.ts";
import { resolveEffectiveMemberId } from "../services/resolve-member.ts";
import type { Env, Variables } from "../types.ts";

export const pushRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- GET /api/push/vapid-public-key ---- 認証不要（購読前にフロントが取得する）
pushRoutes.get("/vapid-public-key", async (c) => {
  if (!c.env.VAPID_PUBLIC_KEY) {
    return c.json({ error: { code: "not_configured", message: "プッシュ通知は現在ご利用いただけません" } }, 503);
  }
  return c.json({ data: { publicKey: c.env.VAPID_PUBLIC_KEY } });
});

pushRoutes.use("*", authMiddleware);

// ---- POST /api/push/subscribe ----
pushRoutes.post("/subscribe", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const body = await c.req.json<{ endpoint: string; keys: { p256dh: string; auth: string } }>();
  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return c.json({ error: { code: "invalid_input", message: "購読情報が不正です" } }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const userAgent = c.req.header("user-agent") ?? null;

  const existing = await db.select({ id: schema.pushSubscriptions.id }).from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.endpoint, body.endpoint)).get();

  if (existing) {
    await db.update(schema.pushSubscriptions)
      .set({ memberId: meId, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent, createdAt: now })
      .where(eq(schema.pushSubscriptions.id, existing.id));
  } else {
    await db.insert(schema.pushSubscriptions).values({
      id: newId(), memberId: meId, endpoint: body.endpoint,
      p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent, createdAt: now,
    });
  }

  return c.json({ ok: true }, 201);
});

// ---- DELETE /api/push/subscribe ----
pushRoutes.delete("/subscribe", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const body = await c.req.json<{ endpoint: string }>();
  if (!body.endpoint) return c.json({ error: { code: "invalid_input", message: "endpointが必要です" } }, 400);

  await db.delete(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.endpoint, body.endpoint));

  return c.json({ ok: true });
});
