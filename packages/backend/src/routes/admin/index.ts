// =============================================================
// 管理者ルート集約
// =============================================================
import { Hono } from "hono";
import { sum } from "drizzle-orm";
import { adminMemberRoutes } from "./members.ts";
import { adminQuestRoutes } from "./quests.ts";
import { adminUspRoutes } from "./usps.ts";
import { adminBadgeRoutes } from "./badges.ts";
import { adminSeasonRoutes } from "./seasons.ts";
import { adminEventRoutes } from "./events.ts";
import { adminTeamRoutes } from "./teams.ts";
import { createDb, schema } from "../../db/index.ts";
import { newId } from "../../services/auth.ts";
import type { Env, Variables } from "../../types.ts";

export const adminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

adminRoutes.route("/members", adminMemberRoutes);
adminRoutes.route("/quests", adminQuestRoutes);
adminRoutes.route("/usps", adminUspRoutes);
adminRoutes.route("/badges", adminBadgeRoutes);
adminRoutes.route("/seasons", adminSeasonRoutes);
adminRoutes.route("/events", adminEventRoutes);
adminRoutes.route("/teams", adminTeamRoutes);

// ---- POST /api/admin/points/reset ----
adminRoutes.post("/points/reset", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);
  const { label } = await c.req.json<{ label?: string }>().catch(() => ({ label: undefined }));

  const { eq } = await import("drizzle-orm");

  const activeMembers = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(eq(schema.members.status, "active"))
    .all();

  const pointRows = await db
    .select({
      memberId: schema.pointTransactions.memberId,
      total: sum(schema.pointTransactions.delta).as("total"),
    })
    .from(schema.pointTransactions)
    .groupBy(schema.pointTransactions.memberId)
    .all();

  const pointMap = new Map(pointRows.map((r) => [r.memberId, Number(r.total ?? 0)]));

  const inserts = activeMembers
    .filter((m) => (pointMap.get(m.id) ?? 0) > 0)
    .map((m) => ({
      id: newId(),
      memberId: m.id,
      delta: -(pointMap.get(m.id)!),
      reason: "admin_reset" as const,
      relatedId: label ?? null,
      createdAt: now,
    }));

  if (inserts.length > 0) {
    await db.insert(schema.pointTransactions).values(inserts);
  }

  console.log(`[ADMIN] Point reset by ${adminId}, ${inserts.length} members affected`);
  return c.json({ ok: true, affectedMembers: inserts.length });
});

// ---- GET /api/admin/my-member ----
// 管理者が自分のメールアドレスと一致するメンバーレコードを取得する
adminRoutes.get("/my-member", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const { eq } = await import("drizzle-orm");

  // 管理者レコードからメールを取得
  const admin = await db.select({ email: schema.admins.email })
    .from(schema.admins)
    .where(eq(schema.admins.id, adminId))
    .get();

  if (!admin) return c.json({ data: null });

  // 同じメールのメンバーレコードを検索
  const member = await db.select()
    .from(schema.members)
    .where(eq(schema.members.email, admin.email))
    .get();

  if (!member) return c.json({ data: null });

  return c.json({
    data: {
      id: member.id,
      name: member.name,
      furigana: member.furigana,
      emoji: member.emoji,
      bgColor: member.bgColor,
      category: member.category,
      businessDescription: member.businessDescription,
      skills: JSON.parse(member.skills || "[]"),
      company: member.company,
      role: member.role,
      status: member.status,
    },
  });
});

// ---- GET /api/admin/app-settings ----
adminRoutes.get("/app-settings", async (c) => {
  const db = createDb(c.env.DB);
  const design = await db.select().from(schema.cardDesigns).get();
  return c.json({ data: design });
});

// ---- PATCH /api/admin/app-settings ----
adminRoutes.patch("/app-settings", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);
  const body = await c.req.json<Partial<{
    appTitle: string; appLogo: string; appPointName: string;
    termQuest: string; termUsp: string; termOneOnOne: string;
  }>>();

  const { eq } = await import("drizzle-orm");

  await db.update(schema.cardDesigns).set({
    ...(body.appTitle     !== undefined && { appTitle: body.appTitle }),
    ...(body.appLogo      !== undefined && { appLogo: body.appLogo }),
    ...(body.appPointName !== undefined && { appPointName: body.appPointName }),
    ...(body.termQuest    !== undefined && { termQuest: body.termQuest }),
    ...(body.termUsp      !== undefined && { termUsp: body.termUsp }),
    ...(body.termOneOnOne !== undefined && { termOneOnOne: body.termOneOnOne }),
    updatedAt: now,
    updatedBy: adminId,
  }).where(eq(schema.cardDesigns.id, "default"));

  return c.json({ ok: true });
});

// ---- POST /api/admin/app-settings/character — キャラクター画像アップロード ----
adminRoutes.post("/app-settings/character", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);
  const { eq } = await import("drizzle-orm");

  const body = await c.req.json<{ imageBase64: string; mimeType?: string }>();
  if (!body.imageBase64) {
    return c.json({ error: { code: "bad_request", message: "画像データが必要です" } }, 400);
  }

  const base64 = body.imageBase64.includes(",") ? body.imageBase64.split(",")[1] : body.imageBase64;
  const mimeType = body.mimeType ?? (body.imageBase64.startsWith("data:image/png") ? "image/png" : "image/jpeg");
  const ext = mimeType === "image/png" ? "png" : "jpg";
  const key = `system/character-image.${ext}`;

  const binary = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  await c.env.R2.put(key, binary, { httpMetadata: { contentType: mimeType } });

  await db.update(schema.cardDesigns)
    .set({ characterImageKey: key, updatedAt: now, updatedBy: adminId })
    .where(eq(schema.cardDesigns.id, "default"));

  return c.json({ ok: true, key });
});

// ---- DELETE /api/admin/app-settings/character — デフォルトに戻す ----
adminRoutes.delete("/app-settings/character", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);
  const { eq } = await import("drizzle-orm");

  // R2から削除（存在しなくてもエラーにしない）
  const design = await db.select({ characterImageKey: schema.cardDesigns.characterImageKey })
    .from(schema.cardDesigns).get();
  if (design?.characterImageKey) {
    await c.env.R2.delete(design.characterImageKey).catch(() => {});
  }

  await db.update(schema.cardDesigns)
    .set({ characterImageKey: null, updatedAt: now, updatedBy: adminId })
    .where(eq(schema.cardDesigns.id, "default"));

  return c.json({ ok: true });
});
