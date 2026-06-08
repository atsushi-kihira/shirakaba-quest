// =============================================================
// 管理者向けお題管理ルート
// GET    /api/admin/quests
// POST   /api/admin/quests          (手動作成)
// POST   /api/admin/quests/ai-generate
// POST   /api/admin/quests/:id/regenerate
// PATCH  /api/admin/quests/:id
// DELETE /api/admin/quests/:id
// POST   /api/admin/quests/:id/publish
// =============================================================
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { newId } from "../../services/auth.ts";
import { generateQuestWithAi, regenerateAnswerSkillsWithAi } from "../../services/ai-quest.ts";
import type { Env, Variables } from "../../types.ts";

export const adminQuestRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- GET /api/admin/quests ----
adminQuestRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);

  const quests = await db
    .select()
    .from(schema.quests)
    .all();

  return c.json({
    data: quests.map((q) => ({
      ...q,
      answerSkills: parseJson<string[]>(q.answerSkills, []),
      aiPromptHistory: parseJson(q.aiPromptHistory, []),
    })),
  });
});

// ---- POST /api/admin/quests ---- (手動作成)
adminQuestRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    title: string;
    story: string;
    emoji: string;
    level: "normal" | "hard";
    skillCount: number;
    answerSkills: string[];
    required2x?: number;
    reward: number;
    deadline?: number;
    publishNow?: boolean;
  }>();

  const id = newId();

  await db.insert(schema.quests).values({
    id,
    title: body.title,
    story: body.story,
    emoji: body.emoji ?? "📋",
    level: body.level ?? "normal",
    skillCount: body.skillCount,
    answerSkills: JSON.stringify(body.answerSkills),
    required2x: body.required2x,
    reward: body.reward ?? (body.level === "hard" ? 10 : 5),
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

  // USP マスターリストを取得
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
    usps,
    userPrompt,
    apiKey: c.env.ANTHROPIC_API_KEY,
    isDev: c.env.ENVIRONMENT === "development",
  });

  return c.json({ data: draft });
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
      title: draft.title, story: draft.story, emoji: draft.emoji,
      skillCount: draft.skillCount, answerSkills: JSON.stringify(draft.answerSkills),
      reward: draft.reward, aiPromptHistory: JSON.stringify(history), updatedAt: now,
    })
    .where(eq(schema.quests.id, questId));

  return c.json({ data: draft });
});

// ---- POST /api/admin/quests/regenerate-skills-preview ---- 保存前ドラフト用: タイトル・ストーリーから正解USPをAI提案
adminQuestRoutes.post("/regenerate-skills-preview", async (c) => {
  const db = createDb(c.env.DB);
  const { title, story } = await c.req.json<{ title: string; story: string }>().catch(() => ({ title: "", story: "" }));

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
    apiKey: c.env.ANTHROPIC_API_KEY,
    isDev: c.env.ENVIRONMENT === "development",
  });

  return c.json({ data: result });
});

// ---- DELETE /api/admin/quests (bulk) ---- 複数お題をまとめて削除
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
    return c.json(
      { error: { code: "no_usps", message: "USPが登録されていません。" } },
      422
    );
  }

  const result = await regenerateAnswerSkillsWithAi({
    usps,
    questTitle: quest.title,
    questStory: quest.story,
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
    title: string; story: string; emoji: string;
    level: "normal" | "hard"; skillCount: number;
    answerSkills: string[]; required2x: number;
    reward: number; deadline: number; status: string;
  }>>();

  const now = Math.floor(Date.now() / 1000);

  await db.update(schema.quests).set({
    ...(body.title        !== undefined && { title: body.title }),
    ...(body.story        !== undefined && { story: body.story }),
    ...(body.emoji        !== undefined && { emoji: body.emoji }),
    ...(body.level        !== undefined && { level: body.level }),
    ...(body.skillCount   !== undefined && { skillCount: body.skillCount }),
    ...(body.answerSkills !== undefined && { answerSkills: JSON.stringify(body.answerSkills) }),
    ...(body.required2x   !== undefined && { required2x: body.required2x }),
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

function parseJson<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str) as T; } catch { return fallback; }
}
