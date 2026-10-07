// =============================================================
// 管理者: お知らせ配信（アプリ内通知＋メール）
// GET    /api/admin/broadcasts/templates          — テンプレート一覧
// POST   /api/admin/broadcasts/templates          — テンプレート作成
// PATCH  /api/admin/broadcasts/templates/:id      — テンプレート更新
// DELETE /api/admin/broadcasts/templates/:id      — テンプレート削除
// GET    /api/admin/broadcasts/options            — 宛先の選択肢（ギルド・チーム・メンバー）と機能一覧
// POST   /api/admin/broadcasts/recipients         — 宛先の確認（人数・メンバーごとの利用状況）
// POST   /api/admin/broadcasts/preview            — 指定メンバーに届く文面のプレビュー
// POST   /api/admin/broadcasts/send               — 配信（アプリ内通知＋メール）
// GET    /api/admin/broadcasts/history            — 配信履歴
// =============================================================
import { Hono } from "hono";
import { desc, eq, sql } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { newId } from "../../services/auth.ts";
import { computeFeatureUsage, FEATURES } from "../../services/feature-usage.ts";
import { resolveRecipients, type RecipientQuery, type RecipientScope } from "../../services/resolve-recipients.ts";
import { getRenderBase, renderBroadcast, sendBroadcast, type BroadcastContent } from "../../services/broadcast.ts";
import type { Env, Variables } from "../../types.ts";

export const adminBroadcastRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const SCOPES: RecipientScope[] = ["all", "team", "collab_team", "selected"];
const MAX_TITLE = 200;
const MAX_BODY = 20000;

type TemplateBody = { name?: string; title?: string; body?: string; includeUsage?: boolean; includeRecommendations?: boolean };

function badRequest(c: { json: (b: unknown, s: 400) => Response }, message: string) {
  return c.json({ error: { code: "invalid_input", message } }, 400);
}

// ---- テンプレート ----
adminBroadcastRoutes.get("/templates", async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db.select().from(schema.broadcastTemplates).orderBy(schema.broadcastTemplates.createdAt).all();
  return c.json({
    data: rows.map((t) => ({
      id: t.id, name: t.name, title: t.title, body: t.body,
      includeUsage: !!t.includeUsage, includeRecommendations: !!t.includeRecommendations, updatedAt: t.updatedAt,
    })),
  });
});

adminBroadcastRoutes.post("/templates", async (c) => {
  const db = createDb(c.env.DB);
  const b = await c.req.json<TemplateBody>().catch(() => ({} as TemplateBody));
  const name = b.name?.trim(); const title = b.title?.trim(); const body = b.body?.trim();
  if (!name || !title || !body) return badRequest(c, "テンプレート名・件名・本文を入力してください");
  if (title.length > MAX_TITLE || body.length > MAX_BODY) return badRequest(c, "件名または本文が長すぎます");
  const now = Math.floor(Date.now() / 1000);
  const id = newId();
  await db.insert(schema.broadcastTemplates).values({
    id, name, title, body,
    includeUsage: b.includeUsage ? 1 : 0, includeRecommendations: b.includeRecommendations ? 1 : 0,
    createdAt: now, updatedAt: now,
  });
  return c.json({ data: { id } }, 201);
});

adminBroadcastRoutes.patch("/templates/:id", async (c) => {
  const db = createDb(c.env.DB);
  const b = await c.req.json<TemplateBody>().catch(() => ({} as TemplateBody));
  const name = b.name?.trim(); const title = b.title?.trim(); const body = b.body?.trim();
  if (!name || !title || !body) return badRequest(c, "テンプレート名・件名・本文を入力してください");
  if (title.length > MAX_TITLE || body.length > MAX_BODY) return badRequest(c, "件名または本文が長すぎます");
  await db.update(schema.broadcastTemplates).set({
    name, title, body,
    includeUsage: b.includeUsage ? 1 : 0, includeRecommendations: b.includeRecommendations ? 1 : 0,
    updatedAt: Math.floor(Date.now() / 1000),
  }).where(eq(schema.broadcastTemplates.id, c.req.param("id")));
  return c.json({ ok: true });
});

adminBroadcastRoutes.delete("/templates/:id", async (c) => {
  const db = createDb(c.env.DB);
  await db.delete(schema.broadcastTemplates).where(eq(schema.broadcastTemplates.id, c.req.param("id")));
  return c.json({ ok: true });
});

// ---- 宛先の選択肢 ----
adminBroadcastRoutes.get("/options", async (c) => {
  const db = createDb(c.env.DB);
  const [teams, teamMembers, collabTeams, collabMembers, members] = await Promise.all([
    db.select().from(schema.teams).orderBy(schema.teams.sortOrder).all(),
    db.select({ teamId: schema.teamMembers.teamId }).from(schema.teamMembers).all(),
    db.select().from(schema.collabTeams).where(eq(schema.collabTeams.archived, 0)).all(),
    db.select({ teamId: schema.collabTeamMembers.teamId }).from(schema.collabTeamMembers).where(eq(schema.collabTeamMembers.status, "active")).all(),
    db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji })
      .from(schema.members).where(eq(schema.members.status, "active")).all(),
  ]);
  const countBy = (rows: { teamId: string }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.teamId, (m.get(r.teamId) ?? 0) + 1);
    return m;
  };
  const tc = countBy(teamMembers); const cc = countBy(collabMembers);
  return c.json({
    data: {
      teams: teams.map((t) => ({ id: t.id, name: t.name, emblemEmoji: t.emblemEmoji, memberCount: tc.get(t.id) ?? 0 })),
      collabTeams: collabTeams.map((t) => ({ id: t.id, name: t.name, type: t.type, memberCount: cc.get(t.id) ?? 0 })),
      members: members.sort((a, b) => a.name.localeCompare(b.name, "ja")),
      features: FEATURES.map((f) => ({ key: f.key, name: f.name, emoji: f.emoji })),
    },
  });
});

function parseRecipientQuery(b: Partial<RecipientQuery> & { scope?: string }): RecipientQuery | null {
  if (!b.scope || !SCOPES.includes(b.scope as RecipientScope)) return null;
  return { scope: b.scope as RecipientScope, teamId: b.teamId ?? null, collabTeamId: b.collabTeamId ?? null, memberIds: b.memberIds ?? [] };
}

async function scopeLabelOf(db: ReturnType<typeof createDb>, q: RecipientQuery, count: number): Promise<string> {
  if (q.scope === "all") return "全員";
  if (q.scope === "team") {
    const t = q.teamId ? await db.select({ name: schema.teams.name }).from(schema.teams).where(eq(schema.teams.id, q.teamId)).get() : null;
    return `ギルド：${t?.name ?? "不明"}`;
  }
  if (q.scope === "collab_team") {
    const t = q.collabTeamId ? await db.select({ name: schema.collabTeams.name }).from(schema.collabTeams).where(eq(schema.collabTeams.id, q.collabTeamId)).get() : null;
    return `チーム：${t?.name ?? "不明"}`;
  }
  return `指定（${count}名）`;
}

// ---- 宛先の確認（人数とメンバーごとの利用状況） ----
adminBroadcastRoutes.post("/recipients", async (c) => {
  const db = createDb(c.env.DB);
  const q = parseRecipientQuery(await c.req.json().catch(() => ({})));
  if (!q) return badRequest(c, "宛先の指定が正しくありません");
  const [recipients, usage] = await Promise.all([resolveRecipients(db, q), computeFeatureUsage(db)]);
  return c.json({
    data: recipients.map((r) => {
      const u = usage.get(r.id);
      return {
        id: r.id, name: r.name, emoji: r.emoji, hasEmail: !!r.email,
        used: u?.used ?? [], recommended: u?.recommended ?? [],
      };
    }),
  });
});

function parseContent(b: Partial<BroadcastContent>): BroadcastContent | string {
  const title = b.title?.trim(); const body = b.body?.trim();
  if (!title || !body) return "件名と本文を入力してください";
  if (title.length > MAX_TITLE || body.length > MAX_BODY) return "件名または本文が長すぎます";
  return { title, body, includeUsage: !!b.includeUsage, includeRecommendations: !!b.includeRecommendations };
}

// ---- プレビュー（指定メンバーに実際に届く文面） ----
adminBroadcastRoutes.post("/preview", async (c) => {
  const db = createDb(c.env.DB);
  const b = await c.req.json<Partial<BroadcastContent> & { memberId?: string }>().catch(() => ({} as Partial<BroadcastContent> & { memberId?: string }));
  const content = parseContent(b);
  if (typeof content === "string") return badRequest(c, content);
  if (!b.memberId) return badRequest(c, "プレビューする対象のメンバーを選んでください");
  const member = await db.select({ id: schema.members.id, name: schema.members.name }).from(schema.members).where(eq(schema.members.id, b.memberId)).get();
  if (!member) return badRequest(c, "指定されたメンバーが見つかりません");

  const [usageMap, base] = await Promise.all([computeFeatureUsage(db), getRenderBase(db, c.env)]);
  const usage = usageMap.get(member.id)!;
  const rendered = renderBroadcast(content, usage, { memberName: member.name, ...base });
  return c.json({ data: { ...rendered, used: usage.used, recommended: usage.recommended } });
});

// ---- 配信 ----
adminBroadcastRoutes.post("/send", async (c) => {
  const db = createDb(c.env.DB);
  const b = await c.req.json<Partial<BroadcastContent> & Partial<RecipientQuery> & { templateId?: string | null; sendEmail?: boolean }>().catch(() => ({} as never));
  const content = parseContent(b);
  if (typeof content === "string") return badRequest(c, content);
  const q = parseRecipientQuery(b);
  if (!q) return badRequest(c, "宛先の指定が正しくありません");

  const [recipients, usageMap] = await Promise.all([resolveRecipients(db, q), computeFeatureUsage(db)]);
  if (recipients.length === 0) return badRequest(c, "配信先のメンバーがいません");

  const result = await sendBroadcast({
    db, env: c.env, waitUntil: (p) => c.executionCtx.waitUntil(p),
    content, templateId: b.templateId ?? null, sendEmail: b.sendEmail !== false,
    scope: q.scope, scopeLabel: await scopeLabelOf(db, q, recipients.length),
    recipients, usageMap, sentBy: c.get("userId"),
  });
  return c.json({ data: result }, 201);
});

// ---- 配信履歴 ----
adminBroadcastRoutes.get("/history", async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db.select().from(schema.broadcasts).orderBy(desc(schema.broadcasts.createdAt)).limit(100).all();
  const reads = await db
    .select({ id: schema.memberNotifications.broadcastId, n: sql<number>`count(*)` })
    .from(schema.memberNotifications).where(sql`${schema.memberNotifications.readAt} IS NOT NULL`)
    .groupBy(schema.memberNotifications.broadcastId).all();
  const readMap = new Map(reads.map((r) => [r.id, Number(r.n)]));
  return c.json({
    data: rows.map((r) => ({
      id: r.id, title: r.title, body: r.body, scopeLabel: r.scopeLabel ?? "", recipientCount: r.recipientCount,
      sendEmail: !!r.sendEmail, includeUsage: !!r.includeUsage, includeRecommendations: !!r.includeRecommendations,
      readCount: readMap.get(r.id) ?? 0, createdAt: r.createdAt,
    })),
  });
});


