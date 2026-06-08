// =============================================================
// クエストルート
// GET  /api/quests              → 公開クエスト一覧
// GET  /api/quests/:id          → 詳細（answerSkills は除外）
// POST /api/quests/:id/attempts → 挑戦
// GET  /api/quests/:id/my-attempts → 自分の挑戦履歴
// =============================================================
import { Hono } from "hono";
import { eq, and, inArray } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId } from "../services/auth.ts";
import { resolveEffectiveMemberId } from "../services/resolve-member.ts";
import type { Env, Variables } from "../types.ts";

export const questRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
questRoutes.use("*", authMiddleware);

// ---- GET /api/quests ----
questRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const rawUserId = c.get("userId");
  const userType  = c.get("userType");
  // 管理者の場合は対応するメンバーIDで isSolved を判定する
  const memberId = (await resolveEffectiveMemberId(db, rawUserId, userType)) ?? rawUserId;

  const quests = await db
    .select({
      id: schema.quests.id,
      title: schema.quests.title,
      story: schema.quests.story,
      emoji: schema.quests.emoji,
      level: schema.quests.level,
      skillCount: schema.quests.skillCount,
      required2x: schema.quests.required2x,
      reward: schema.quests.reward,
      status: schema.quests.status,
      deadline: schema.quests.deadline,
      publishedAt: schema.quests.publishedAt,
      source: schema.quests.source,
      createdAt: schema.quests.createdAt,
      updatedAt: schema.quests.updatedAt,
      // answerSkills は意図的に除外
    })
    .from(schema.quests)
    .where(eq(schema.quests.status, "published"))
    .all();

  // 自分の正解済みクエストIDを取得
  const solvedAttempts = await db
    .select({ questId: schema.questAttempts.questId })
    .from(schema.questAttempts)
    .where(and(
      eq(schema.questAttempts.memberId, memberId),
      eq(schema.questAttempts.isCorrect, 1),
    ))
    .all();
  const solvedSet = new Set(solvedAttempts.map((a) => a.questId));

  return c.json({
    data: quests.map((q) => ({ ...q, isSolved: solvedSet.has(q.id) })),
  });
});

// ---- GET /api/quests/:id ----
questRoutes.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const questId = c.req.param("id");

  const quest = await db
    .select({
      id: schema.quests.id,
      title: schema.quests.title,
      story: schema.quests.story,
      emoji: schema.quests.emoji,
      level: schema.quests.level,
      skillCount: schema.quests.skillCount,
      required2x: schema.quests.required2x,
      reward: schema.quests.reward,
      status: schema.quests.status,
      deadline: schema.quests.deadline,
      publishedAt: schema.quests.publishedAt,
      source: schema.quests.source,
      createdAt: schema.quests.createdAt,
      updatedAt: schema.quests.updatedAt,
      // answerSkills は意図的に除外
    })
    .from(schema.quests)
    .where(and(eq(schema.quests.id, questId), eq(schema.quests.status, "published")))
    .get();

  if (!quest) {
    return c.json({ error: { code: "not_found", message: "お題が見つかりません" } }, 404);
  }

  return c.json({ data: quest });
});

// ---- POST /api/quests/:id/attempts ----
questRoutes.post("/:id/attempts", async (c) => {
  const db = createDb(c.env.DB);
  const rawUserId = c.get("userId");
  const userType  = c.get("userType");
  // 管理者も自分のメンバーIDで挑戦を記録する
  const memberId = await resolveEffectiveMemberId(db, rawUserId, userType);
  const questId = c.req.param("id");

  // 管理者がメンバーアカウントを持っていない場合は挑戦不可
  if (!memberId) {
    return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないため挑戦できません" } }, 403);
  }
  const { selectedSkillNames } = await c.req.json<{ selectedSkillNames: string[] }>();

  if (!Array.isArray(selectedSkillNames) || selectedSkillNames.length === 0) {
    return c.json({ error: { code: "invalid_input", message: "スキルを選択してください" } }, 400);
  }

  // クエスト取得（answerSkills を含む）
  const quest = await db
    .select()
    .from(schema.quests)
    .where(and(eq(schema.quests.id, questId), eq(schema.quests.status, "published")))
    .get();

  if (!quest) {
    return c.json({ error: { code: "not_found", message: "お題が見つかりません" } }, 404);
  }

  // 個数チェック
  if (selectedSkillNames.length !== quest.skillCount) {
    return c.json({
      error: { code: "wrong_count", message: `スキルを${quest.skillCount}個選んでください（現在${selectedSkillNames.length}個）` }
    }, 400);
  }

  // 正解判定
  const answerSkills: string[] = JSON.parse(quest.answerSkills);
  const selectedSorted = [...selectedSkillNames].sort();
  const answerSorted = [...answerSkills].sort();
  const isCorrect = selectedSorted.length === answerSorted.length &&
    selectedSorted.every((n, i) => n === answerSorted[i]);

  const now = Math.floor(Date.now() / 1000);
  const attemptId = newId();

  await db.insert(schema.questAttempts).values({
    id: attemptId,
    questId,
    memberId,
    selectedSkillNames: JSON.stringify(selectedSkillNames),
    isCorrect: isCorrect ? 1 : 0,
    attemptedAt: now,
  });

  // 正解かつ初回正解ならポイント加算
  if (isCorrect) {
    const pastCorrect = await db
      .select({ id: schema.questAttempts.id })
      .from(schema.questAttempts)
      .where(
        and(
          eq(schema.questAttempts.questId, questId),
          eq(schema.questAttempts.memberId, memberId),
          eq(schema.questAttempts.isCorrect, 1),
        )
      )
      .all();

    const isFirstCorrect = pastCorrect.length === 1; // 今回の1件だけ
    if (isFirstCorrect) {
      const reason = quest.level === "hard" ? "quest_hard_solved" : "quest_normal_solved";
      await db.insert(schema.pointTransactions).values({
        id: newId(),
        memberId,
        delta: quest.reward,
        reason,
        relatedId: questId,
        createdAt: now,
      });
    }

    return c.json({
      data: {
        isCorrect: true,
        reward: isFirstCorrect ? quest.reward : 0,
        isFirstCorrect,
        message: isFirstCorrect
          ? `🎉 正解！${quest.reward}pt 獲得しました！`
          : "✅ 正解！（すでに獲得済みのため追加ポイントなし）",
      },
    });
  }

  return c.json({
    data: {
      isCorrect: false,
      reward: 0,
      isFirstCorrect: false,
      message: "😔 残念、不正解でした。もう一度考えてみましょう！",
    },
  });
});

// ---- GET /api/quests/:id/my-attempts ----
questRoutes.get("/:id/my-attempts", async (c) => {
  const db = createDb(c.env.DB);
  const rawUserId = c.get("userId");
  const userType  = c.get("userType");
  const memberId = (await resolveEffectiveMemberId(db, rawUserId, userType)) ?? rawUserId;
  const questId = c.req.param("id");

  const attempts = await db
    .select()
    .from(schema.questAttempts)
    .where(
      and(
        eq(schema.questAttempts.questId, questId),
        eq(schema.questAttempts.memberId, memberId)
      )
    )
    .all();

  const hasCorrect = attempts.some((a) => a.isCorrect === 1);

  return c.json({
    data: {
      attempts: attempts.map((a) => ({
        ...a,
        isCorrect: a.isCorrect === 1,
        selectedSkillNames: JSON.parse(a.selectedSkillNames),
      })),
      hasCorrect,
      attemptCount: attempts.length,
    },
  });
});
