// =============================================================
// 管理者向けお題管理ルート
// GET    /api/admin/quests
// GET    /api/admin/quests/export          — CSV エクスポート
// POST   /api/admin/quests                 — 手動作成
// POST   /api/admin/quests/ai-generate     — AI 生成（1件）
// POST   /api/admin/quests/ai-bulk-generate — AI 一括生成（複数件）
// POST   /api/admin/quests/import          — CSV 一括インポート（追加）
// POST   /api/admin/quests/regenerate-skills-preview
// DELETE /api/admin/quests                 — 一括削除
// POST   /api/admin/quests/:id/regenerate
// POST   /api/admin/quests/:id/regenerate-skills
// PATCH  /api/admin/quests/:id
// DELETE /api/admin/quests/:id
// POST   /api/admin/quests/:id/publish
// =============================================================
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { newId } from "../../services/auth.ts";
import { generateQuestWithAi, bulkGenerateQuestsWithAi, regenerateAnswerSkillsWithAi } from "../../services/ai-quest.ts";
import type { Env, Variables } from "../../types.ts";

export const adminQuestRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- GET /api/admin/quests ----
adminQuestRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const quests = await db.select().from(schema.quests).all();
  return c.json({ data: quests.map(toPublic) });
});

// ---- GET /api/admin/quests/export ---- CSV エクスポート
adminQuestRoutes.get("/export", async (c) => {
  const db = createDb(c.env.DB);
  const quests = await db
    .select()
    .from(schema.quests)
    .where(sql`${schema.quests.status} != 'deleted'`)
    .all();

  const header = "emoji,title,story,mission,level,usp1,usp2,usp3,usp4,usp5,reward";
  const rows = quests.map((q) => {
    const skills = parseJson<string[]>(q.answerSkills, []);
    return toCsvRow([
      q.emoji,
      q.title,
      q.story,
      q.mission ?? "",
      q.level,
      skills[0] ?? "",
      skills[1] ?? "",
      skills[2] ?? "",
      skills[3] ?? "",
      skills[4] ?? "",
      String(q.reward),
    ]);
  });

  const csv = "﻿" + [header, ...rows].join("\r\n"); // BOM付きで Excel 対応
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="quests_${Date.now()}.csv"`,
    },
  });
});

// ---- POST /api/admin/quests ---- 手動作成
adminQuestRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    title: string;
    story: string;
    mission?: string;
    emoji: string;
    level: "normal" | "hard";
    answerSkills: string[];
    reward: number;
    deadline?: number;
    publishNow?: boolean;
  }>();

  const skillCount = body.level === "hard" ? 5 : 3;
  const id = newId();

  await db.insert(schema.quests).values({
    id,
    title: body.title,
    story: body.story,
    mission: body.mission ?? "",
    emoji: body.emoji ?? "📋",
    level: body.level ?? "normal",
    skillCount,
    answerSkills: JSON.stringify(body.answerSkills.slice(0, skillCount)),
    reward: body.reward ?? 5,
    status: body.publishNow ? "published" : "draft",
    deadline: body.deadline ?? null,
    publishedAt: body.publishNow ? now : null,
    source: "manual",
    createdBy: adminId,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ data: { id } }, 201);
});

// ---- POST /api/admin/quests/ai-generate ----
adminQuestRoutes.post("/ai-generate", async (c) => {
  const db = createDb(c.env.DB);
  const { userPrompt } = await c.req.json<{ userPrompt?: string }>().catch(() => ({ userPrompt: undefined }));

  const usps = await db
    .select({ name: schema.usps.name, emoji: schema.usps.emoji })
    .from(schema.usps)
    .orderBy(schema.usps.sortOrder)
    .all();

  if (usps.length === 0) {
    return c.json(
      { error: { code: "no_usps", message: "USPが登録されていません。先にUSP管理画面でUSPを登録してください。" } },
      422
    );
  }

  const draft = await generateQuestWithAi({
    usps, userPrompt,
    apiKey: c.env.ANTHROPIC_API_KEY,
    isDev: c.env.ENVIRONMENT === "development",
  });

  return c.json({ data: draft });
});

// ---- POST /api/admin/quests/ai-bulk-generate ---- AI 一括生成
adminQuestRoutes.post("/ai-bulk-generate", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    items: { instruction: string }[];
    additionalPrompt?: string;
  }>().catch(() => ({ items: [] as { instruction: string }[], additionalPrompt: undefined }));

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ error: { code: "bad_request", message: "生成するお題の指示を入力してください" } }, 400);
  }
  if (body.items.length > 10) {
    return c.json({ error: { code: "bad_request", message: "一度に生成できるお題は10件までです" } }, 400);
  }

  const usps = await db
    .select({ name: schema.usps.name, emoji: schema.usps.emoji })
    .from(schema.usps)
    .orderBy(schema.usps.sortOrder)
    .all();

  if (usps.length === 0) {
    return c.json(
      { error: { code: "no_usps", message: "USPが登録されていません。先にUSP管理画面でUSPを登録してください。" } },
      422
    );
  }

  const drafts = await bulkGenerateQuestsWithAi({
    usps,
    items: body.items,
    additionalPrompt: body.additionalPrompt,
    apiKey: c.env.ANTHROPIC_API_KEY,
    isDev: c.env.ENVIRONMENT === "development",
  });

  const created: { id: string; title: string; emoji: string }[] = [];

  for (const draft of drafts) {
    const id = newId();
    const skillCount = draft.level === "hard" ? 5 : 3;

    await db.insert(schema.quests).values({
      id,
      title: draft.title,
      story: draft.story,
      mission: draft.mission ?? "",
      emoji: draft.emoji ?? "📋",
      level: draft.level ?? "normal",
      skillCount,
      answerSkills: JSON.stringify(draft.answerSkills.slice(0, skillCount)),
      reward: draft.reward ?? 5,
      status: "draft",
      deadline: null,
      publishedAt: null,
      source: "ai",
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    });

    created.push({ id, title: draft.title, emoji: draft.emoji ?? "📋" });
  }

  return c.json({ data: { created, count: created.length } }, 201);
});

// ---- POST /api/admin/quests/import ---- CSV 一括インポート（追加のみ）
adminQuestRoutes.post("/import", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    quests: Array<{
      emoji?: string;
      title?: string;
      story?: string;
      mission?: string;
      level?: string;
      answerSkills?: string[];
      reward?: number;
    }>;
  }>().catch(() => ({ quests: [] }));

  if (!Array.isArray(body.quests) || body.quests.length === 0) {
    return c.json({ error: { code: "bad_request", message: "インポートするお題がありません" } }, 400);
  }

  // 登録済み USP 名を取得（バリデーション用）
  const allUsps = await db.select({ name: schema.usps.name }).from(schema.usps).all();
  const validUspNames = new Set(allUsps.map((u) => u.name));

  let imported = 0;
  const errors: string[] = [];

  for (let i = 0; i < body.quests.length; i++) {
    const q = body.quests[i];
    const rowLabel = `行${i + 2}`;
    const level = q.level === "hard" ? "hard" : "normal";
    const required = level === "hard" ? 5 : 3;

    if (!q.title?.trim()) {
      errors.push(`${rowLabel}: タイトルが空です`);
      continue;
    }

    const validSkills = (q.answerSkills ?? []).filter((s) => validUspNames.has(s));
    if (validSkills.length < required) {
      const unknown = (q.answerSkills ?? []).filter((s) => !validUspNames.has(s));
      const msg = unknown.length > 0
        ? `${rowLabel}: USP「${unknown.join("」「")}」はシステムに存在しません`
        : `${rowLabel}: USP数が不足しています（${validSkills.length}個 / ${required}個必要）`;
      errors.push(msg);
      continue;
    }

    await db.insert(schema.quests).values({
      id: newId(),
      title: q.title.trim(),
      story: q.story?.trim() ?? "",
      mission: q.mission?.trim() ?? "",
      emoji: q.emoji?.trim() || "📋",
      level,
      skillCount: required,
      answerSkills: JSON.stringify(validSkills.slice(0, required)),
      reward: Number(q.reward) > 0 ? Number(q.reward) : 5,
      status: "draft",
      deadline: null,
      publishedAt: null,
      source: "manual",
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    });
    imported++;
  }

  return c.json({ imported, errors });
});

// ---- POST /api/admin/quests/regenerate-skills-preview ---- 保存前ドラフト用
adminQuestRoutes.post("/regenerate-skills-preview", async (c) => {
  const db = createDb(c.env.DB);
  const { title, story, targetCount } = await c.req.json<{ title: string; story: string; targetCount?: number }>()
    .catch(() => ({ title: "", story: "", targetCount: 3 }));

  if (!title || !story) {
    return c.json({ error: { code: "bad_request", message: "タイトルとストーリーを入力してください" } }, 400);
  }

  const usps = await db
    .select({ name: schema.usps.name, emoji: schema.usps.emoji })
    .from(schema.usps)
    .orderBy(schema.usps.sortOrder)
    .all();

  if (usps.length === 0) {
    return c.json({ error: { code: "no_usps", message: "USPが登録されていません。" } }, 422);
  }

  const result = await regenerateAnswerSkillsWithAi({
    usps, questTitle: title, questStory: story,
    targetCount: targetCount ?? 3,
    apiKey: c.env.ANTHROPIC_API_KEY,
    isDev: c.env.ENVIRONMENT === "development",
  });

  return c.json({ data: result });
});

// ---- DELETE /api/admin/quests (bulk) ----
adminQuestRoutes.delete("/", async (c) => {
  const db = createDb(c.env.DB);
  const { ids } = await c.req.json<{ ids: string[] }>().catch(() => ({ ids: [] as string[] }));

  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ error: { code: "bad_request", message: "削除するお題IDを指定してください" } }, 400);
  }

  const { inArray } = await import("drizzle-orm");
  const now = Math.floor(Date.now() / 1000);

  await db.update(schema.quests)
    .set({ status: "deleted", updatedAt: now })
    .where(inArray(schema.quests.id, ids));

  return c.json({ ok: true, deleted: ids.length });
});

// ---- POST /api/admin/quests/:id/regenerate ---- お題全体を再生成
adminQuestRoutes.post("/:id/regenerate", async (c) => {
  const db = createDb(c.env.DB);
  const questId = c.req.param("id");
  const { userPrompt } = await c.req.json<{ userPrompt?: string }>().catch(() => ({ userPrompt: undefined }));

  const quest = await db.select().from(schema.quests).where(eq(schema.quests.id, questId)).get();
  if (!quest) return c.json({ error: { code: "not_found", message: "お題が見つかりません" } }, 404);

  const usps = await db
    .select({ name: schema.usps.name, emoji: schema.usps.emoji })
    .from(schema.usps)
    .orderBy(schema.usps.sortOrder)
    .all();

  if (usps.length === 0) {
    return c.json(
      { error: { code: "no_usps", message: "USPが登録されていません。先にUSP管理画面でUSPを登録してください。" } },
      422
    );
  }

  const draft = await generateQuestWithAi({
    usps, userPrompt,
    apiKey: c.env.ANTHROPIC_API_KEY,
    isDev: c.env.ENVIRONMENT === "development",
  });

  const history = parseJson<Array<{ prompt: string; generatedAt: number }>>(quest.aiPromptHistory, []);
  history.push({ prompt: userPrompt ?? "(なし)", generatedAt: Math.floor(Date.now() / 1000) });

  const now = Math.floor(Date.now() / 1000);
  await db.update(schema.quests)
    .set({
      title: draft.title, story: draft.story, mission: draft.mission ?? "", emoji: draft.emoji,
      skillCount: draft.skillCount, answerSkills: JSON.stringify(draft.answerSkills),
      reward: draft.reward, aiPromptHistory: JSON.stringify(history), updatedAt: now,
    })
    .where(eq(schema.quests.id, questId));

  return c.json({ data: draft });
});

// ---- POST /api/admin/quests/:id/regenerate-skills ---- 正解USPのみをAIで再生成
adminQuestRoutes.post("/:id/regenerate-skills", async (c) => {
  const db = createDb(c.env.DB);
  const questId = c.req.param("id");

  const quest = await db.select().from(schema.quests).where(eq(schema.quests.id, questId)).get();
  if (!quest) return c.json({ error: { code: "not_found", message: "お題が見つかりません" } }, 404);

  const usps = await db
    .select({ name: schema.usps.name, emoji: schema.usps.emoji })
    .from(schema.usps)
    .orderBy(schema.usps.sortOrder)
    .all();

  if (usps.length === 0) {
    return c.json({ error: { code: "no_usps", message: "USPが登録されていません。" } }, 422);
  }

  const targetCount = quest.level === "hard" ? 5 : 3;
  const result = await regenerateAnswerSkillsWithAi({
    usps, questTitle: quest.title, questStory: quest.story,
    targetCount,
    apiKey: c.env.ANTHROPIC_API_KEY,
    isDev: c.env.ENVIRONMENT === "development",
  });

  const now = Math.floor(Date.now() / 1000);
  await db.update(schema.quests)
    .set({
      answerSkills: JSON.stringify(result.answerSkills),
      skillCount: result.skillCount,
      updatedAt: now,
    })
    .where(eq(schema.quests.id, questId));

  return c.json({ data: result });
});

// ---- PATCH /api/admin/quests/:id ----
adminQuestRoutes.patch("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const questId = c.req.param("id");
  const body = await c.req.json<Partial<{
    title: string; story: string; mission: string; emoji: string;
    level: "normal" | "hard"; answerSkills: string[];
    reward: number; deadline: number; status: string;
  }>>();

  const now = Math.floor(Date.now() / 1000);
  const skillCount = body.level !== undefined ? (body.level === "hard" ? 5 : 3) : undefined;

  await db.update(schema.quests).set({
    ...(body.title        !== undefined && { title: body.title }),
    ...(body.story        !== undefined && { story: body.story }),
    ...(body.mission      !== undefined && { mission: body.mission }),
    ...(body.emoji        !== undefined && { emoji: body.emoji }),
    ...(body.level        !== undefined && { level: body.level }),
    ...(skillCount        !== undefined && { skillCount }),
    ...(body.answerSkills !== undefined && { answerSkills: JSON.stringify(body.answerSkills) }),
    ...(body.reward       !== undefined && { reward: body.reward }),
    ...(body.deadline     !== undefined && { deadline: body.deadline }),
    ...(body.status       !== undefined && {
      status: body.status,
      publishedAt: body.status === "published" ? now : undefined,
    }),
    updatedAt: now,
  }).where(eq(schema.quests.id, questId));

  return c.json({ ok: true });
});

// ---- DELETE /api/admin/quests/:id ----
adminQuestRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  await db.update(schema.quests)
    .set({ status: "deleted", updatedAt: now })
    .where(eq(schema.quests.id, c.req.param("id")));

  return c.json({ ok: true });
});

// ---- POST /api/admin/quests/:id/publish ----
adminQuestRoutes.post("/:id/publish", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  await db.update(schema.quests)
    .set({ status: "published", publishedAt: now, updatedAt: now })
    .where(eq(schema.quests.id, c.req.param("id")));

  return c.json({ ok: true });
});

// ---- ヘルパー ----

function toPublic(q: typeof schema.quests.$inferSelect) {
  return {
    ...q,
    mission: q.mission ?? "",
    answerSkills: parseJson<string[]>(q.answerSkills, []),
    aiPromptHistory: parseJson(q.aiPromptHistory, []),
  };
}

function parseJson<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str) as T; } catch { return fallback; }
}

function toCsvRow(fields: string[]): string {
  return fields.map((f) => {
    const s = String(f ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }).join(",");
}
