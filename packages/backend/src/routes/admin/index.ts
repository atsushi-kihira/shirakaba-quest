// =============================================================
// 管理者ルート集約
// =============================================================
import { Hono } from "hono";
import { eq, and, gte, lte, inArray, sql } from "drizzle-orm";
import { VALID_THEMES } from "../../services/theme.ts";
import { adminMemberRoutes } from "./members.ts";
import { adminQuestRoutes } from "./quests.ts";
import { adminUspRoutes } from "./usps.ts";
import { adminBadgeRoutes } from "./badges.ts";
import { adminSeasonRoutes } from "./seasons.ts";
import { adminEventRoutes } from "./events.ts";
import { adminEventTypeDefinitionRoutes } from "./event-type-definitions.ts";
import { adminTeamRoutes } from "./teams.ts";
import { adminMeetingRoutes } from "./meetings.ts";
import { adminCardPrintRoutes } from "./card-print.ts";
import { adminUsageReportRoutes } from "./usage-report.ts";
import { adminEmailTemplateRoutes } from "./email-templates.ts";
import { adminCollabRoutes } from "./collab.ts";
import { adminOneOnOneRoutes } from "./oneonone.ts";
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
adminRoutes.route("/event-type-definitions", adminEventTypeDefinitionRoutes);
adminRoutes.route("/teams", adminTeamRoutes);
adminRoutes.route("/meetings", adminMeetingRoutes);
adminRoutes.route("/card-print", adminCardPrintRoutes);
adminRoutes.route("/usage-report", adminUsageReportRoutes);
adminRoutes.route("/email-templates", adminEmailTemplateRoutes);
adminRoutes.route("/collab", adminCollabRoutes);
adminRoutes.route("/oneonone", adminOneOnOneRoutes);

// D1のバインド変数上限を避けるため、IN句に渡すID件数を安全な単位に分割するヘルパー
const POINTS_ID_CHUNK_SIZE = 50;
function chunkPointIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += POINTS_ID_CHUNK_SIZE) chunks.push(ids.slice(i, i + POINTS_ID_CHUNK_SIZE));
  return chunks;
}

// ---- POST /api/admin/points/reset-season ----
// 特定シーズンの期間に記録されたポイント履歴を削除する（全員 or 指定メンバーのみ）。
// 履歴を残したままマイナスの取引を積むのではなく、対象期間の履歴そのものを削除する。
adminRoutes.post("/points/reset-season", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const { seasonId, memberIds } = await c.req.json<{ seasonId?: string; memberIds?: string[] }>()
    .catch(() => ({ seasonId: undefined, memberIds: undefined }));

  if (!seasonId) return c.json({ error: { code: "invalid_input", message: "シーズンを指定してください" } }, 400);

  const season = await db.select().from(schema.seasons).where(eq(schema.seasons.id, seasonId)).get();
  if (!season) return c.json({ error: { code: "not_found", message: "シーズンが見つかりません" } }, 404);

  const endTs = season.endsAt ?? Math.floor(Date.now() / 1000);
  const conditions = [
    gte(schema.pointTransactions.createdAt, season.startsAt),
    lte(schema.pointTransactions.createdAt, endTs),
  ];
  if (memberIds && memberIds.length > 0) {
    conditions.push(inArray(schema.pointTransactions.memberId, memberIds));
  }

  const targets = await db.select({ id: schema.pointTransactions.id })
    .from(schema.pointTransactions).where(and(...conditions)).all();

  for (const chunk of chunkPointIds(targets.map((t) => t.id))) {
    await db.delete(schema.pointTransactions).where(inArray(schema.pointTransactions.id, chunk));
  }

  console.log(`[ADMIN] Season point reset by ${adminId}, season=${seasonId}, ${targets.length} transactions deleted`);
  return c.json({ ok: true, deletedCount: targets.length });
});

// ---- DELETE /api/admin/points/transactions ----
// 選択したポイント履歴（複数）を一括削除する
adminRoutes.delete("/points/transactions", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const { ids } = await c.req.json<{ ids?: string[] }>().catch(() => ({ ids: undefined }));
  const uniqueIds = [...new Set(ids ?? [])];

  if (uniqueIds.length === 0) {
    return c.json({ error: { code: "invalid_input", message: "削除する履歴を選択してください" } }, 400);
  }

  for (const chunk of chunkPointIds(uniqueIds)) {
    await db.delete(schema.pointTransactions).where(inArray(schema.pointTransactions.id, chunk));
  }

  console.log(`[ADMIN] Point transactions deleted by ${adminId}: ${uniqueIds.length}`);
  return c.json({ ok: true, deletedCount: uniqueIds.length });
});

// ---- POST /api/admin/points/reset-all ----
// 過去累計のポイント履歴をすべて削除する（全員 or 指定メンバーのみ）。マイナス取引の追加ではなく削除。
adminRoutes.post("/points/reset-all", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const { memberIds } = await c.req.json<{ memberIds?: string[] }>().catch(() => ({ memberIds: undefined }));

  const targets = memberIds && memberIds.length > 0
    ? await db.select({ id: schema.pointTransactions.id }).from(schema.pointTransactions)
        .where(inArray(schema.pointTransactions.memberId, memberIds)).all()
    : await db.select({ id: schema.pointTransactions.id }).from(schema.pointTransactions).all();

  for (const chunk of chunkPointIds(targets.map((t) => t.id))) {
    await db.delete(schema.pointTransactions).where(inArray(schema.pointTransactions.id, chunk));
  }

  console.log(`[ADMIN] All-time point reset by ${adminId}, ${targets.length} transactions deleted`);
  return c.json({ ok: true, deletedCount: targets.length });
});

// ---- GET /api/admin/points/member-summary/:id ----
// ポイント調整パネルで、調整前に現在の得点を確認するための要約
adminRoutes.get("/points/member-summary/:id", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.req.param("id");

  const member = await db.select({ id: schema.members.id, name: schema.members.name })
    .from(schema.members).where(eq(schema.members.id, memberId)).get();
  if (!member) return c.json({ error: { code: "not_found", message: "メンバーが見つかりません" } }, 404);

  const allTimeRow = await db
    .select({ total: sql<number>`sum(${schema.pointTransactions.delta})`.as("total") })
    .from(schema.pointTransactions)
    .where(eq(schema.pointTransactions.memberId, memberId))
    .get();
  const allTimePoints = allTimeRow?.total ?? 0;

  const activeSeason = await db.select().from(schema.seasons).where(eq(schema.seasons.isActive, 1)).get();

  let seasonPoints = 0;
  if (activeSeason) {
    const endTs = activeSeason.endsAt ?? Math.floor(Date.now() / 1000);
    // シーズンランキング（/api/seasons/ranking）と同じ集計式に揃える（delta>0のみ合算）。
    // 管理画面で見せる「現在のシーズン得点」を、メンバーが実際に見るランキング数値と一致させるため。
    const seasonRow = await db
      .select({ total: sql<number>`sum(${schema.pointTransactions.delta})`.as("total") })
      .from(schema.pointTransactions)
      .where(
        sql`${schema.pointTransactions.memberId} = ${memberId} AND ${schema.pointTransactions.delta} > 0 AND ${schema.pointTransactions.createdAt} >= ${activeSeason.startsAt} AND ${schema.pointTransactions.createdAt} <= ${endTs}`
      )
      .get();
    seasonPoints = seasonRow?.total ?? 0;
  }

  return c.json({
    data: {
      memberId, memberName: member.name,
      allTimePoints, seasonPoints,
      activeSeasonName: activeSeason?.name ?? null,
    },
  });
});

// ---- POST /api/admin/points/adjust ----
// 特定メンバーのポイントを加算・減算する（累計・現在シーズンの両方に反映される単一の取引を記録する）
adminRoutes.post("/points/adjust", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);
  const { memberId, delta, note } = await c.req.json<{ memberId?: string; delta?: number; note?: string }>()
    .catch(() => ({ memberId: undefined, delta: undefined, note: undefined }));

  if (!memberId) return c.json({ error: { code: "invalid_input", message: "メンバーを指定してください" } }, 400);
  if (!Number.isInteger(delta) || delta === 0) {
    return c.json({ error: { code: "invalid_input", message: "0以外の整数で調整量を指定してください" } }, 400);
  }

  const member = await db.select({ id: schema.members.id }).from(schema.members).where(eq(schema.members.id, memberId)).get();
  if (!member) return c.json({ error: { code: "not_found", message: "メンバーが見つかりません" } }, 404);

  await db.insert(schema.pointTransactions).values({
    id: newId(),
    memberId,
    delta: delta as number,
    reason: "admin_adjust",
    relatedId: note?.trim() || null,
    createdAt: now,
  });

  console.log(`[ADMIN] Point adjust by ${adminId}: member=${memberId}, delta=${delta}`);
  return c.json({ ok: true });
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
    termQuest: string; termUsp: string; termOneOnOne: string; termExternalGuest: string; termEnishi: string; termBusinessCommunity: string;
    timezone: string; theme: string;
    schedulerLinkValidityHours: number;
  }>>();

  const { eq } = await import("drizzle-orm");

  if (body.theme !== undefined && !VALID_THEMES.includes(body.theme as (typeof VALID_THEMES)[number])) {
    return c.json({ error: { code: "invalid_theme", message: "不正なテーマが指定されました" } }, 400);
  }
  if (body.schedulerLinkValidityHours !== undefined && (body.schedulerLinkValidityHours < 6 || body.schedulerLinkValidityHours > 336)) {
    return c.json({ error: { code: "invalid_input", message: "公開URLの有効期間は6時間〜336時間（2週間）で指定してください" } }, 400);
  }

  await db.update(schema.cardDesigns).set({
    ...(body.appTitle     !== undefined && { appTitle: body.appTitle }),
    ...(body.appLogo      !== undefined && { appLogo: body.appLogo }),
    ...(body.appPointName !== undefined && { appPointName: body.appPointName }),
    ...(body.termQuest    !== undefined && { termQuest: body.termQuest }),
    ...(body.termUsp      !== undefined && { termUsp: body.termUsp }),
    ...(body.termOneOnOne !== undefined && { termOneOnOne: body.termOneOnOne }),
    ...(body.termExternalGuest !== undefined && { termExternalGuest: body.termExternalGuest }),
    ...(body.termEnishi    !== undefined && { termEnishi: body.termEnishi }),
    ...(body.termBusinessCommunity !== undefined && { termBusinessCommunity: body.termBusinessCommunity }),
    ...(body.timezone     !== undefined && { timezone: body.timezone }),
    ...(body.theme        !== undefined && { theme: body.theme }),
    ...(body.schedulerLinkValidityHours !== undefined && { schedulerLinkValidityHours: body.schedulerLinkValidityHours }),
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
  const mimeType = body.mimeType ?? "image/jpeg";
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/gif" ? "gif" : "jpg";
  const key = `system/character-image.${ext}`;

  // 拡張子が変わった場合に古い画像を削除
  const existing = await db.select({ characterImageKey: schema.cardDesigns.characterImageKey }).from(schema.cardDesigns).get();
  if (existing?.characterImageKey && existing.characterImageKey !== key) {
    await c.env.R2.delete(existing.characterImageKey).catch(() => {});
  }

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

// ---- GET /api/admin/admins — 管理者一覧 ----
adminRoutes.get("/admins", async (c) => {
  const db = createDb(c.env.DB);
  const admins = await db.select({
    id: schema.admins.id,
    email: schema.admins.email,
    name: schema.admins.name,
    role: schema.admins.role,
    createdAt: schema.admins.createdAt,
  }).from(schema.admins).all();
  return c.json({ data: admins });
});

// ---- POST /api/admin/admins — 管理者追加 ----
adminRoutes.post("/admins", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const { eq } = await import("drizzle-orm");

  const body = await c.req.json<{ email: string; name: string; role?: string }>().catch(() => null);
  if (!body?.email || !body?.name) {
    return c.json({ error: { code: "bad_request", message: "メールアドレスと名前は必須です" } }, 400);
  }

  const email = body.email.trim().toLowerCase();
  const existing = await db.select({ id: schema.admins.id }).from(schema.admins).where(eq(schema.admins.email, email)).get();
  if (existing) {
    return c.json({ error: { code: "conflict", message: "このメールアドレスはすでに登録されています" } }, 409);
  }

  const id = newId();
  await db.insert(schema.admins).values({
    id,
    email,
    name: body.name.trim(),
    role: body.role === "super_admin" ? "super_admin" : "admin",
    createdAt: now,
  });

  return c.json({ data: { id, email, name: body.name.trim(), role: body.role ?? "admin", createdAt: now } });
});

// ---- DELETE /api/admin/admins/:id — 管理者削除 ----
adminRoutes.delete("/admins/:id", async (c) => {
  const db = createDb(c.env.DB);
  const { eq } = await import("drizzle-orm");

  const id = c.req.param("id");
  const currentAdminId = c.get("userId");

  if (id === currentAdminId) {
    return c.json({ error: { code: "forbidden", message: "自分自身は削除できません" } }, 403);
  }

  const target = await db.select({ id: schema.admins.id }).from(schema.admins).where(eq(schema.admins.id, id)).get();
  if (!target) {
    return c.json({ error: { code: "not_found", message: "管理者が見つかりません" } }, 404);
  }

  await db.delete(schema.admins).where(eq(schema.admins.id, id));
  return c.json({ ok: true });
});
