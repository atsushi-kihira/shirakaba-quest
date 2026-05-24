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
import { generateQuestWithAi } from "../../services/ai-quest.ts";
import type { Env, Variables } from "../../types.ts";
import type { Skill } from "@shared/types";

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

  // アクティブメンバーとそのスキルを取得
  const members = await db
    .select({
      name: schema.members.name,
      category: schema.members.category,
      businessDescription: schema.members.businessDescription,
      skills: schema.members.skills,
    })
    .from(schema.members)
    .where(eq(schema.members.status, "active"))
    .all();

  const memberData = members.map((m) => ({
    name: m.name,
    category: m.category,
    businessDescription: m.businessDescription,
    skills: parseJson<Skill[]>(m.skills, []).map((s) => ({ name: s.name, emoji: s.emoji })),
  }));

  const draft = await generateQuestWithAi({
    members: memberData,
    userPrompt,
    apiKey: c.env.ANTHROPIC_API_KEY,
    isDev: c.env.ENVIRONMENT === "development",
  });

  return c.json({ data: draft });
});

// ---- POST /api/admin/quests/:id/regenerate ----
adminQuestRoutes.post("/:id/regenerate", async (c) => {
  const db = createDb(c.env.DB);
  const questId = c.req.param("id");
  const { userPrompt } = await c.req.json<{ userPrompt?: string }>().catch(() => ({ userPrompt: undefined }));

  const quest = await db.select().from(schema.quests).where(eq(schema.quests.id, questId)).get();
  if (!quest) return c.json({ error: { code: "not_found", message: "お題が見つかりません" } }, 404);

  const members = await db
    .select({ name: schema.members.name, category: schema.members.category, businessDescription: schema.members.businessDescription, skills: schema.members.skills })
    .from(schema.members).where(eq(schema.members.status, "active")).all();

  const memberData = members.map((m) => ({
    name: m.name, category: m.category, businessDescription: m.businessDescription,
    skills: parseJson<Skill[]>(m.skills, []).map((s) => ({ name: s.name, emoji: s.emoji })),
  }));

  const draft = await generateQuestWithAi({
    members: memberData, userPrompt,
    apiKey: c.env.ANTHROPIC_API_KEY,
    isDev: c.env.ENVIRONMENT === "development",
  });

  // プロンプト履歴を保存
  const history = parseJson<Array<{ prompt: string; generatedAt: number }>>(quest.aiPromptHistory, []);
  history.push({ prompt: userPrompt ?? "(なし)", generatedAt: Math.floor(Date.now() / 1000) });

  const now = Math.floor(Date.now() / 1000);
  await db.update(schema.quests)
    .set({
      title: draft.title,
      story: draft.story,
      emoji: draft.emoji,
      skillCount: draft.skillCount,
      answerSkills: JSON.stringify(draft.answerSkills),
      reward: draft.reward,
      aiPromptHistory: JSON.stringify(history),
      updatedAt: now,
    })
    .where(eq(schema.quests.id, questId));

  return c.json({ data: draft });
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
