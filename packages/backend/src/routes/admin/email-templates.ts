// =============================================================
// 管理者向けメールテンプレートCRUDルート
// GET    /api/admin/email-templates          — 全テンプレート一覧
// GET    /api/admin/email-templates/:key     — 1件取得
// PATCH  /api/admin/email-templates/:key     — 上書き設定保存
// DELETE /api/admin/email-templates/:key     — 上書きをリセット（デフォルトに戻す）
// GET    /api/admin/email-templates/system-from — システム既定送信元アドレス取得
// PATCH  /api/admin/email-templates/system-from — システム既定送信元アドレス更新
// =============================================================
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { adminMiddleware } from "../../middleware/auth.ts";
import { EMAIL_DEFAULTS, CATEGORY_LABELS } from "../../services/email-defaults.ts";
import { newId } from "../../services/auth.ts";
import type { Env, Variables } from "../../types.ts";

export const adminEmailTemplateRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
adminEmailTemplateRoutes.use("*", adminMiddleware);

// ---- GET /api/admin/email-templates/system-from ----
adminEmailTemplateRoutes.get("/system-from", async (c) => {
  const db = createDb(c.env.DB);
  const design = await db.select({ systemFromEmail: schema.cardDesigns.systemFromEmail }).from(schema.cardDesigns).get();
  return c.json({ systemFromEmail: design?.systemFromEmail ?? null });
});

// ---- PATCH /api/admin/email-templates/system-from ----
adminEmailTemplateRoutes.patch("/system-from", async (c) => {
  const body = await c.req.json<{ systemFromEmail: string | null }>();
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);

  const existing = await db.select({ id: schema.cardDesigns.id }).from(schema.cardDesigns).get();
  if (existing) {
    await db.update(schema.cardDesigns)
      .set({ systemFromEmail: body.systemFromEmail || null, updatedAt: now, updatedBy: adminId })
      .where(eq(schema.cardDesigns.id, existing.id));
  }
  return c.json({ ok: true });
});

// ---- GET /api/admin/email-templates/common-layout ----
adminEmailTemplateRoutes.get("/common-layout", async (c) => {
  const db = createDb(c.env.DB);
  const design = await db.select({
    emailCommonHeader: schema.cardDesigns.emailCommonHeader,
    emailCommonFooter: schema.cardDesigns.emailCommonFooter,
  }).from(schema.cardDesigns).get();
  return c.json({
    emailCommonHeader: design?.emailCommonHeader ?? null,
    emailCommonFooter: design?.emailCommonFooter ?? null,
  });
});

// ---- PATCH /api/admin/email-templates/common-layout ----
adminEmailTemplateRoutes.patch("/common-layout", async (c) => {
  const body = await c.req.json<{ emailCommonHeader?: string | null; emailCommonFooter?: string | null }>();
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);

  const existing = await db.select({ id: schema.cardDesigns.id }).from(schema.cardDesigns).get();
  if (existing) {
    await db.update(schema.cardDesigns)
      .set({
        emailCommonHeader: body.emailCommonHeader !== undefined ? (body.emailCommonHeader || null) : undefined,
        emailCommonFooter: body.emailCommonFooter !== undefined ? (body.emailCommonFooter || null) : undefined,
        updatedAt: now,
        updatedBy: adminId,
      })
      .where(eq(schema.cardDesigns.id, existing.id));
  }
  return c.json({ ok: true });
});

// ---- GET /api/admin/email-templates ----
adminEmailTemplateRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const dbRows = await db.select().from(schema.emailTemplates).all();
  const dbMap = new Map(dbRows.map((r) => [r.emailKey, r]));

  const list = EMAIL_DEFAULTS.map((def) => {
    const override = dbMap.get(def.emailKey);
    return {
      emailKey: def.emailKey,
      label: def.label,
      category: def.category,
      categoryLabel: CATEGORY_LABELS[def.category],
      triggerDescription: def.triggerDescription,
      availableVars: def.availableVars,
      enabled: override ? !!override.enabled : def.enabled,
      fromEmail: override?.fromEmail ?? null,
      subject: override?.subject ?? def.subject,
      bodyText: override?.bodyHtml ?? def.bodyText,
      disableCommonHeader: override ? !!override.disableCommonHeader : false,
      disableCommonFooter: override ? !!override.disableCommonFooter : false,
      defaultEnabled: def.enabled,
      defaultSubject: def.subject,
      defaultBodyText: def.bodyText,
      isCustomized: !!override,
    };
  });

  return c.json({ data: list });
});

// ---- GET /api/admin/email-templates/:key ----
adminEmailTemplateRoutes.get("/:key", async (c) => {
  const key = c.req.param("key");
  const def = EMAIL_DEFAULTS.find((d) => d.emailKey === key);
  if (!def) return c.json({ error: { code: "not_found", message: "テンプレートが見つかりません" } }, 404);

  const db = createDb(c.env.DB);
  const override = await db.select().from(schema.emailTemplates)
    .where(eq(schema.emailTemplates.emailKey, key)).get();

  return c.json({
    data: {
      emailKey: def.emailKey,
      label: def.label,
      category: def.category,
      categoryLabel: CATEGORY_LABELS[def.category],
      triggerDescription: def.triggerDescription,
      availableVars: def.availableVars,
      enabled: override ? !!override.enabled : def.enabled,
      fromEmail: override?.fromEmail ?? null,
      subject: override?.subject ?? def.subject,
      bodyText: override?.bodyHtml ?? def.bodyText,
      disableCommonHeader: override ? !!override.disableCommonHeader : false,
      disableCommonFooter: override ? !!override.disableCommonFooter : false,
      defaultEnabled: def.enabled,
      defaultSubject: def.subject,
      defaultBodyText: def.bodyText,
      isCustomized: !!override,
    },
  });
});

// ---- PATCH /api/admin/email-templates/:key ----
adminEmailTemplateRoutes.patch("/:key", async (c) => {
  const key = c.req.param("key");
  const def = EMAIL_DEFAULTS.find((d) => d.emailKey === key);
  if (!def) return c.json({ error: { code: "not_found", message: "テンプレートが見つかりません" } }, 404);

  const body = await c.req.json<{
    enabled?: boolean;
    fromEmail?: string | null;
    subject?: string;
    bodyText?: string;
    disableCommonHeader?: boolean;
    disableCommonFooter?: boolean;
  }>();

  const db = createDb(c.env.DB);
  const existing = await db.select().from(schema.emailTemplates)
    .where(eq(schema.emailTemplates.emailKey, key)).get();

  const now = Math.floor(Date.now() / 1000);

  if (existing) {
    await db.update(schema.emailTemplates).set({
      enabled: body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
      fromEmail: body.fromEmail !== undefined ? (body.fromEmail || null) : existing.fromEmail,
      subject: body.subject ?? existing.subject,
      bodyHtml: body.bodyText ?? existing.bodyHtml,
      disableCommonHeader: body.disableCommonHeader !== undefined ? (body.disableCommonHeader ? 1 : 0) : existing.disableCommonHeader,
      disableCommonFooter: body.disableCommonFooter !== undefined ? (body.disableCommonFooter ? 1 : 0) : existing.disableCommonFooter,
      updatedAt: now,
    }).where(eq(schema.emailTemplates.emailKey, key));
  } else {
    await db.insert(schema.emailTemplates).values({
      id: newId(),
      emailKey: key,
      enabled: body.enabled !== undefined ? (body.enabled ? 1 : 0) : (def.enabled ? 1 : 0),
      fromEmail: body.fromEmail || null,
      subject: body.subject ?? def.subject,
      bodyHtml: body.bodyText ?? def.bodyText,
      disableCommonHeader: body.disableCommonHeader ? 1 : 0,
      disableCommonFooter: body.disableCommonFooter ? 1 : 0,
      updatedAt: now,
    });
  }

  return c.json({ ok: true });
});

// ---- DELETE /api/admin/email-templates/:key — デフォルトにリセット ----
adminEmailTemplateRoutes.delete("/:key", async (c) => {
  const key = c.req.param("key");
  const db = createDb(c.env.DB);
  await db.delete(schema.emailTemplates).where(eq(schema.emailTemplates.emailKey, key));
  return c.json({ ok: true });
});
