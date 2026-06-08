// =============================================================
// メンバールート
// GET  /api/members          → 一覧（プライバシーフィルタリング付き）
// GET  /api/members/:id      → 詳細
// PATCH /api/members/me      → 自分のプロフィール編集
// =============================================================
import { Hono } from "hono";
import { eq, and, or, like } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId } from "../services/auth.ts";
import { scanCard } from "../services/ocr.ts";
import type { Env, Variables } from "../types.ts";
import type { Skill } from "@shared/types";

export const memberRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

memberRoutes.use("*", authMiddleware);

// ---- GET /api/members ----
memberRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const viewerId = c.get("userId");

  // アクティブなメンバーを全件取得
  const allMembers = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.status, "active"))
    .all();

  // 自分との Connection を取得
  const myConnections = await db
    .select()
    .from(schema.connections)
    .where(eq(schema.connections.fromMemberId, viewerId))
    .all();

  const connectionMap = new Map(myConnections.map((c) => [c.toMemberId, c]));

  const result = allMembers.map((member) => {
    const conn = connectionMap.get(member.id);
    const connStatus = conn?.status ?? "none";
    const isUnlocked = connStatus === "digital" || connStatus === "real" || member.id === viewerId;

    return {
      id: member.id,
      name: member.name,
      furigana: member.furigana,
      romaji: member.romaji,
      emoji: member.emoji,
      bgColor: member.bgColor,
      category: member.category,
      businessDescription: member.businessDescription,
      skills: parseJson<Skill[]>(member.skills, []),
      connectionStatus: connStatus,
      // 個人情報は1to1後のみ
      company:      isUnlocked ? member.company      : null,
      role:         isUnlocked ? member.role         : null,
      phone:        isUnlocked ? member.phone        : null,
      address:      isUnlocked ? member.address      : null,
      email:        isUnlocked ? member.email        : null,
      qrCodeUrl:    isUnlocked ? member.qrCodeUrl    : null,
      facebookUrl:  isUnlocked ? member.facebookUrl  : null,
      linkedinUrl:  isUnlocked ? member.linkedinUrl  : null,
      instagramUrl: isUnlocked ? member.instagramUrl : null,
      customFields: isUnlocked ? parseJson(member.customFields, {}) : null,
    };
  });

  return c.json({ data: result });
});

// ---- GET /api/members/:id ----
memberRoutes.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const viewerId = c.get("userId");
  const targetId = c.req.param("id");

  const member = await db
    .select()
    .from(schema.members)
    .where(and(eq(schema.members.id, targetId), eq(schema.members.status, "active")))
    .get();

  if (!member) {
    return c.json(
      { error: { code: "not_found", message: "メンバーが見つかりません" } },
      404
    );
  }

  // 自分との Connection を確認
  let connStatus: "none" | "digital" | "real" = "none";
  if (viewerId !== targetId) {
    const conn = await db
      .select({ status: schema.connections.status })
      .from(schema.connections)
      .where(
        and(
          eq(schema.connections.fromMemberId, viewerId),
          eq(schema.connections.toMemberId, targetId)
        )
      )
      .get();
    connStatus = (conn?.status as typeof connStatus) ?? "none";
  }

  const isUnlocked = connStatus !== "none" || viewerId === targetId;

  return c.json({
    data: {
      id: member.id,
      name: member.name,
      furigana: member.furigana,
      romaji: member.romaji,
      emoji: member.emoji,
      bgColor: member.bgColor,
      category: member.category,
      businessDescription: member.businessDescription,
      skills: parseJson<Skill[]>(member.skills, []),
      connectionStatus: connStatus,
      company:      isUnlocked ? member.company      : null,
      role:         isUnlocked ? member.role         : null,
      phone:        isUnlocked ? member.phone        : null,
      address:      isUnlocked ? member.address      : null,
      email:        isUnlocked ? member.email        : null,
      qrCodeUrl:    isUnlocked ? member.qrCodeUrl    : null,
      facebookUrl:  isUnlocked ? member.facebookUrl  : null,
      linkedinUrl:  isUnlocked ? member.linkedinUrl  : null,
      instagramUrl: isUnlocked ? member.instagramUrl : null,
      customFields: isUnlocked ? parseJson(member.customFields, {}) : null,
    },
  });
});

// ---- PATCH /api/members/me ----
memberRoutes.patch("/me", async (c) => {
  const db = createDb(c.env.DB);
  const userId = c.get("userId");
  const userType = c.get("userType");

  if (userType !== "member") {
    return c.json({ error: { code: "forbidden", message: "メンバーのみ利用可能です" } }, 403);
  }

  const body = await c.req.json<Partial<{
    name: string;
    furigana: string;
    romaji: string;
    emoji: string;
    bgColor: string;
    company: string;
    role: string;
    phone: string;
    address: string;
    category: string;
    businessDescription: string;
    skills: Skill[];
    qrCodeUrl: string;
    facebookUrl: string;
    linkedinUrl: string;
    instagramUrl: string;
    customFields: Record<string, string>;
  }>>();

  const now = Math.floor(Date.now() / 1000);

  await db
    .update(schema.members)
    .set({
      ...(body.name              !== undefined && { name: body.name }),
      ...(body.furigana          !== undefined && { furigana: body.furigana }),
      ...(body.romaji            !== undefined && { romaji: body.romaji }),
      ...(body.emoji             !== undefined && { emoji: body.emoji }),
      ...(body.bgColor           !== undefined && { bgColor: body.bgColor }),
      ...(body.company           !== undefined && { company: body.company }),
      ...(body.role              !== undefined && { role: body.role }),
      ...(body.phone             !== undefined && { phone: body.phone }),
      ...(body.address           !== undefined && { address: body.address }),
      ...(body.category          !== undefined && { category: body.category }),
      ...(body.businessDescription !== undefined && { businessDescription: body.businessDescription }),
      ...(body.skills            !== undefined && { skills: JSON.stringify(body.skills) }),
      ...(body.qrCodeUrl         !== undefined && { qrCodeUrl: body.qrCodeUrl }),
      ...(body.facebookUrl       !== undefined && { facebookUrl: body.facebookUrl }),
      ...(body.linkedinUrl       !== undefined && { linkedinUrl: body.linkedinUrl }),
      ...(body.instagramUrl      !== undefined && { instagramUrl: body.instagramUrl }),
      ...(body.customFields      !== undefined && { customFields: JSON.stringify(body.customFields) }),
      updatedAt: now,
    })
    .where(eq(schema.members.id, userId));

  return c.json({ ok: true });
});

// ---- POST /api/members/:id/real-card ----
// 相手のリアルカード（物理名刺）を受け取ったことを記録する
memberRoutes.post("/:id/real-card", async (c) => {
  const db = createDb(c.env.DB);
  const myId = c.get("userId");
  const userType = c.get("userType");
  const targetId = c.req.param("id");

  if (userType !== "member") {
    return c.json({ error: { code: "forbidden", message: "メンバーのみ利用可能です" } }, 403);
  }

  if (myId === targetId) {
    return c.json({ error: { code: "self_request", message: "自分自身のカードは記録できません" } }, 400);
  }

  // 相手が存在するか確認
  const target = await db
    .select({ id: schema.members.id, name: schema.members.name })
    .from(schema.members)
    .where(and(eq(schema.members.id, targetId), eq(schema.members.status, "active")))
    .get();

  if (!target) {
    return c.json({ error: { code: "not_found", message: "メンバーが見つかりません" } }, 404);
  }

  const now = Math.floor(Date.now() / 1000);

  // Connection 取得（なければ作成）
  let conn = await db
    .select()
    .from(schema.connections)
    .where(and(eq(schema.connections.fromMemberId, myId), eq(schema.connections.toMemberId, targetId)))
    .get();

  if (!conn) {
    const newConnId = newId();
    await db.insert(schema.connections).values({
      id: newConnId,
      fromMemberId: myId,
      toMemberId: targetId,
      status: "none",
    });
    conn = await db
      .select()
      .from(schema.connections)
      .where(and(eq(schema.connections.fromMemberId, myId), eq(schema.connections.toMemberId, targetId)))
      .get();
  }

  if (!conn) {
    return c.json({ error: { code: "internal_error", message: "接続記録の作成に失敗しました" } }, 500);
  }

  // すでに real カード取得済み
  if (conn.status === "real") {
    return c.json({ data: { alreadyRecorded: true, message: "すでにリアルカードを受け取り済みです" } });
  }

  // Connection を real に更新
  await db
    .update(schema.connections)
    .set({ status: "real", realCardReceivedAt: now })
    .where(and(eq(schema.connections.fromMemberId, myId), eq(schema.connections.toMemberId, targetId)));

  // +1pt 付与
  await db.insert(schema.pointTransactions).values({
    id: newId(),
    memberId: myId,
    delta: 1,
    reason: "real_card_exchanged",
    relatedId: targetId,
    createdAt: now,
  });

  console.log(`[REAL CARD] ${myId} received real card from ${targetId}`);
  return c.json({ data: { alreadyRecorded: false, message: `${target.name}さんのリアルカードを受け取りました！ +1pt` } });
});

// ---- GET /api/members/:id/connection-status ----
// 自分と特定メンバーの接続状態を返す（QR受け取り確認ページ用）
memberRoutes.get("/:id/connection-status", async (c) => {
  const db = createDb(c.env.DB);
  const myId = c.get("userId");
  const targetId = c.req.param("id");

  if (myId === targetId) {
    return c.json({ data: { status: "self" } });
  }

  // 相手の基本情報
  const target = await db
    .select({
      id: schema.members.id,
      name: schema.members.name,
      emoji: schema.members.emoji,
      bgColor: schema.members.bgColor,
      category: schema.members.category,
      businessDescription: schema.members.businessDescription,
    })
    .from(schema.members)
    .where(and(eq(schema.members.id, targetId), eq(schema.members.status, "active")))
    .get();

  if (!target) {
    return c.json({ error: { code: "not_found", message: "メンバーが見つかりません" } }, 404);
  }

  const conn = await db
    .select()
    .from(schema.connections)
    .where(and(eq(schema.connections.fromMemberId, myId), eq(schema.connections.toMemberId, targetId)))
    .get();

  return c.json({
    data: {
      member: target,
      status: (conn?.status ?? "none") as "none" | "digital" | "real",
    },
  });
});

// ---- POST /api/members/scan-for-match ----
// カード画像をOCRし、システム内メンバーと照合して候補を返す
memberRoutes.post("/scan-for-match", async (c) => {
  const myId = c.get("userId");
  const userType = c.get("userType");
  const db = createDb(c.env.DB);

  if (userType !== "member") {
    return c.json({ error: { code: "forbidden", message: "メンバーのみ利用可能です" } }, 403);
  }

  const body = await c.req.json<{ imageBase64: string; side?: "front" | "back" }>();
  if (!body.imageBase64) {
    return c.json({ error: { code: "bad_request", message: "画像データが必要です" } }, 400);
  }

  const isDev = c.env.ENVIRONMENT === "development";

  // OCR でカード情報を抽出
  let ocrResult;
  try {
    ocrResult = await scanCard({
      imageBase64: body.imageBase64,
      side: body.side ?? "front",
      visionApiKey: c.env.GOOGLE_VISION_API_KEY ?? "",
      anthropicApiKey: c.env.ANTHROPIC_API_KEY ?? "",
      isDev,
    });
  } catch {
    return c.json({ error: { code: "ocr_failed", message: "カードの読み取りに失敗しました。もう一度試してください。" } }, 500);
  }

  // アクティブなメンバー一覧を取得（自分を除く）
  const members = await db
    .select({
      id: schema.members.id,
      name: schema.members.name,
      furigana: schema.members.furigana,
      email: schema.members.email,
      company: schema.members.company,
      emoji: schema.members.emoji,
      bgColor: schema.members.bgColor,
      category: schema.members.category,
      businessDescription: schema.members.businessDescription,
    })
    .from(schema.members)
    .where(and(eq(schema.members.status, "active")))
    .all();

  const selfIdx = members.findIndex((m) => m.id === myId);
  if (selfIdx !== -1) members.splice(selfIdx, 1);

  // 照合スコアリング
  type Candidate = { id: string; name: string; furigana: string; emoji: string; bgColor: string; category: string; businessDescription: string; score: number };
  const candidates: Candidate[] = [];

  for (const m of members) {
    let score = 0;

    // 名前一致（最重要）
    if (ocrResult.memberName) {
      const ocrName = ocrResult.memberName.replace(/\s/g, "");
      const memberName = m.name.replace(/\s/g, "");
      if (memberName === ocrName) score += 100;
      else if (memberName.includes(ocrName) || ocrName.includes(memberName)) score += 50;
    }

    // メールアドレス一致
    if (ocrResult.email && m.email) {
      if (m.email.toLowerCase() === ocrResult.email.toLowerCase()) score += 80;
    }

    // 会社名一致
    if (ocrResult.company && m.company) {
      if (m.company.includes(ocrResult.company) || ocrResult.company.includes(m.company)) score += 30;
    }

    if (score > 0) {
      candidates.push({
        id: m.id,
        name: m.name,
        furigana: m.furigana,
        emoji: m.emoji,
        bgColor: m.bgColor,
        category: m.category,
        businessDescription: m.businessDescription,
        score,
      });
    }
  }

  // スコア順にソート、上位5件
  candidates.sort((a, b) => b.score - a.score);
  const top5 = candidates.slice(0, 5);

  // 既存 connection 状態も付加
  const myConnections = await db
    .select({ toMemberId: schema.connections.toMemberId, status: schema.connections.status })
    .from(schema.connections)
    .where(eq(schema.connections.fromMemberId, myId))
    .all();
  const connMap = new Map(myConnections.map((c) => [c.toMemberId, c.status]));

  return c.json({
    data: {
      ocr: {
        memberName: ocrResult.memberName ?? null,
        company: ocrResult.company ?? null,
        email: ocrResult.email ?? null,
        role: ocrResult.role ?? null,
      },
      candidates: top5.map((c) => ({
        id: c.id,
        name: c.name,
        furigana: c.furigana,
        emoji: c.emoji,
        bgColor: c.bgColor,
        category: c.category,
        businessDescription: c.businessDescription,
        connectionStatus: (connMap.get(c.id) ?? "none") as "none" | "digital" | "real",
        score: c.score,
      })),
      // スコア0でも候補リストに出せるよう全メンバーも別途返す
      allMembers: members.map((m) => ({
        id: m.id,
        name: m.name,
        furigana: m.furigana,
        emoji: m.emoji,
        bgColor: m.bgColor,
        category: m.category,
        connectionStatus: (connMap.get(m.id) ?? "none") as "none" | "digital" | "real",
      })),
    },
  });
});

// ---- POST /api/members/:id/import-card ----
// システム外でもらったカード画像をもとに1to1記録を登録する
// connection.status = "digital"、+1pt付与（重複不可）
memberRoutes.post("/:id/import-card", async (c) => {
  const db = createDb(c.env.DB);
  const myId = c.get("userId");
  const userType = c.get("userType");
  const targetId = c.req.param("id");

  if (userType !== "member") {
    return c.json({ error: { code: "forbidden", message: "メンバーのみ利用可能です" } }, 403);
  }
  if (myId === targetId) {
    return c.json({ error: { code: "self_request", message: "自分自身のカードは登録できません" } }, 400);
  }

  // 相手が存在するか確認
  const target = await db
    .select({ id: schema.members.id, name: schema.members.name })
    .from(schema.members)
    .where(and(eq(schema.members.id, targetId), eq(schema.members.status, "active")))
    .get();

  if (!target) {
    return c.json({ error: { code: "not_found", message: "メンバーが見つかりません" } }, 404);
  }

  const now = Math.floor(Date.now() / 1000);

  // Connection 取得（なければ作成）
  let conn = await db
    .select()
    .from(schema.connections)
    .where(and(eq(schema.connections.fromMemberId, myId), eq(schema.connections.toMemberId, targetId)))
    .get();

  if (!conn) {
    await db.insert(schema.connections).values({
      id: newId(),
      fromMemberId: myId,
      toMemberId: targetId,
      status: "none",
    });
    conn = await db
      .select()
      .from(schema.connections)
      .where(and(eq(schema.connections.fromMemberId, myId), eq(schema.connections.toMemberId, targetId)))
      .get();
  }

  // すでに digital 以上の場合は重複登録しない
  if (conn?.status === "digital" || conn?.status === "real") {
    return c.json({
      data: {
        alreadyRecorded: true,
        message: `${target.name}さんとはすでに1to1記録があります`,
      },
    });
  }

  // Connection を digital に更新（1to1完了扱い）
  await db
    .update(schema.connections)
    .set({ status: "digital", oneOnOneCompletedAt: now })
    .where(and(eq(schema.connections.fromMemberId, myId), eq(schema.connections.toMemberId, targetId)));

  // +1pt 付与
  await db.insert(schema.pointTransactions).values({
    id: newId(),
    memberId: myId,
    delta: 1,
    reason: "one_on_one_completed",
    relatedId: targetId,
    createdAt: now,
  });

  console.log(`[IMPORT CARD] ${myId} registered 1to1 with ${targetId} via card image`);
  return c.json({
    data: {
      alreadyRecorded: false,
      message: `${target.name}さんとの1to1を記録しました！ +1pt`,
    },
  });
});

// ---- ユーティリティ ----
function parseJson<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}
