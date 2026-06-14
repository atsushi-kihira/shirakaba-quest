// =============================================================
// メンバー登録ルート
// POST /api/register/scan-card  — カード画像OCR + Claude 構造化
// POST /api/register/submit     — 仮登録申請
// =============================================================
import { Hono } from "hono";
import { createDb, schema } from "../db/index.ts";
import { newId } from "../services/auth.ts";
import { scanCard } from "../services/ocr.ts";
import { saveCardImage } from "../services/card-image.ts";
import type { Env, Variables } from "../types.ts";

export const registerRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- POST /api/register/scan-card ----
registerRoutes.post("/scan-card", async (c) => {
  const body = await c.req.json<{
    imageBase64: string;
    side: "front" | "back";
  }>();

  if (!body.imageBase64) {
    return c.json({ error: { code: "bad_request", message: "画像データが必要です" } }, 400);
  }

  const isDev = c.env.ENVIRONMENT === "development";

  try {
    const result = await scanCard({
      imageBase64: body.imageBase64,
      side: body.side ?? "front",
      visionApiKey: c.env.GOOGLE_VISION_API_KEY ?? "",
      anthropicApiKey: c.env.ANTHROPIC_API_KEY ?? "",
      isDev,
    });

    return c.json({ data: result });
  } catch (err) {
    console.error("[scan-card error]", err);
    return c.json({
      error: {
        code: "ocr_failed",
        message: "カードの読み取りに失敗しました。もう一度撮影してみてください。",
      },
    }, 500);
  }
});

// ---- POST /api/register/submit ----
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
    cardImageBase64?: string;
    skills?: Array<{
      name: string;
      emoji: string;
      issue: string;
      connector: string;
      solution: string;
    }>;
  }>();

  if (!body.email || !body.name) {
    return c.json({
      error: { code: "bad_request", message: "メールアドレスと名前は必須です" },
    }, 400);
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

  // カード画像（表面）をR2に保存
  let cardImageKey: string | null = null;
  if (body.cardImageBase64) {
    try {
      cardImageKey = await saveCardImage(c.env.R2, id, body.cardImageBase64);
    } catch (err) {
      console.error("[register/submit] カード画像の保存に失敗", err);
    }
  }

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
    cardImageKey,
    status: "pending",
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({
    data: {
      id,
      message: "登録申請を受け付けました。管理者の承認をお待ちください。",
    },
  }, 201);
});
