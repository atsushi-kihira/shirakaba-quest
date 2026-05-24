// =============================================================
// メンバールート
// GET  /api/members          → 一覧（プライバシーフィルタリング付き）
// GET  /api/members/:id      → 詳細
// PATCH /api/members/me      → 自分のプロフィール編集
// =============================================================
import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
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

// ---- ユーティリティ ----
function parseJson<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}
