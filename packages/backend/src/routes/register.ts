// =============================================================
// メンバー登録ルート
// POST /api/register/scan-card  — カード画像OCR
// POST /api/register/submit     — 仮登録申請
// =============================================================
import { Hono } from "hono";
import { createDb, schema } from "../db/index.ts";
import { newId } from "../services/auth.ts";
import { extractTextFromImage, parseCardText } from "../services/ocr.ts";
import type { Env, Variables } from "../types.ts";

export const registerRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- POST /api/register/scan-card ----
// カード画像（base64）を受け取りOCRしてパース結果を返す
registerRoutes.post("/scan-card", async (c) => {
  const body = await c.req.json<{
    imageBase64: string;
    side: "front" | "back";
  }>();

  if (!body.imageBase64) {
    return c.json({ error: { code: "bad_request", message: "画像データが必要です" } }, 400);
  }

  const rawText = await extractTextFromImage({
    imageBase64: body.imageBase64,
    apiKey: c.env.GOOGLE_VISION_API_KEY ?? "",
    isDev: c.env.ENVIRONMENT === "development",
  });

  const parsed = parseCardText(rawText, body.side ?? "front");

  return c.json({ data: parsed });
});

// ---- POST /api/register/submit ----
// 新規メンバー仮登録（管理者承認待ち）
registerRoutes.post("/submit", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    email: string;
    name: string;
    furigana?: string;
    emoji?: string;
    bgColor?: string;
    category?: string;
    businessDescription?: string;
    company?: string;
    role?: string;
    phone?: string;
    address?: string;
    skills?: Array<{
      name: string;
      emoji: string;
      issue: string;
      connector: string;
      solution: string;
    }>;
  }>();

  if (!body.email || !body.name) {
    return c.json({ error: { code: "bad_request", message: "メールアドレスと名前は必須です" } }, 400);
  }

  // メールアドレス重複チェック
  const { eq } = await import("drizzle-orm");
  const existing = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(eq(schema.members.email, body.email.toLowerCase().trim()))
    .get();

  if (existing) {
    return c.json({
      error: { code: "email_taken", message: "このメールアドレスはすでに登録されています" },
    }, 409);
  }

  const id = newId();
  await db.insert(schema.members).values({
    id,
    email: body.email.toLowerCase().trim(),
    name: body.name.trim(),
    furigana: body.furigana?.trim() ?? "",
    emoji: body.emoji ?? "😊",
    bgColor: body.bgColor ?? "bg-rose-100",
    category: body.category ?? "",
    businessDescription: body.businessDescription ?? "",
    company: body.company ?? "",
    role: body.role ?? "",
    phone: body.phone ?? null,
    address: body.address ?? null,
    skills: JSON.stringify(body.skills ?? []),
    customFields: JSON.stringify({}),
    status: "pending",
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ data: { id, message: "登録申請を受け付けました。管理者の承認をお待ちください。" } }, 201);
});
