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
import { MailService, buildMemberTableHtml, buildSkillsHtml } from "../services/mailer.ts";
import type { CardOrderMailData } from "../services/mailer.ts";
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
    romaji?: string;
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
    uspRequests?: Array<{
      uspName: string;
      emoji: string;
      description: string;
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
    romaji: body.romaji?.trim() ?? null,
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

  // USP承認申請を登録し、管理者にメール通知
  if (body.uspRequests && body.uspRequests.length > 0) {
    const now2 = Math.floor(Date.now() / 1000);
    const { eq: eq2 } = await import("drizzle-orm");
    const isDev = c.env.ENVIRONMENT === "development";

    for (const req of body.uspRequests) {
      if (!req.uspName?.trim()) continue;
      const reqId = newId();
      await db.insert(schema.uspRequests).values({
        id: reqId,
        requesterEmail: body.email.toLowerCase().trim(),
        requesterName: body.name.trim(),
        uspName: req.uspName.trim(),
        emoji: req.emoji || "⭐",
        description: req.description?.trim() || null,
        status: "pending",
        createdAt: now2,
      });
    }

    // 管理者全員にメール通知
    const admins = await db.select({ email: schema.admins.email, name: schema.admins.name })
      .from(schema.admins)
      .all();

    const appDesign = await db.select({ appTitle: schema.cardDesigns.appTitle })
      .from(schema.cardDesigns)
      .get();
    const appTitle = appDesign?.appTitle ?? "白樺クエスト";

    const mailerReg = new MailService(db, c.env);
    for (const req of body.uspRequests) {
      if (!req.uspName?.trim()) continue;
      for (const admin of admins) {
        mailerReg.send("usp_request_admin", admin.email, {
          appTitle,
          adminName: admin.name,
          requesterName: body.name.trim(),
          requesterEmail: body.email.toLowerCase().trim(),
          uspEmoji: req.emoji || "⭐",
          uspName: req.uspName.trim(),
          uspDescription: req.description?.trim() ?? "",
        }).catch((e) => console.error("[usp-request-mail]", e));
      }
    }
  }

  return c.json({
    data: {
      id,
      message: "登録申請を受け付けました。管理者の承認をお待ちください。",
    },
  }, 201);
});

// ---- POST /api/register/card-order  登録直後のカード発注（認証不要） ----
registerRoutes.post("/card-order", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const isDev = c.env.ENVIRONMENT === "development";
  const { eq } = await import("drizzle-orm");

  const body = await c.req.json<{
    memberId: string;
    characterKey: string;
    characterLabel: string;
    photoBase64?: string;
    address?: string;
    phone?: string;
    planName: string;
    planPrice: number;
  }>();

  if (!body.memberId || !body.characterKey || !body.planName) {
    return c.json({ error: { code: "invalid_input", message: "必須情報が不足しています" } }, 400);
  }

  const design = await db.select({
    cardPrintEnabled:         schema.cardDesigns.cardPrintEnabled,
    cardPrintContactEmail:    schema.cardDesigns.cardPrintContactEmail,
    cardPrintCompanyName:     schema.cardDesigns.cardPrintCompanyName,
    cardPrintThankYouMessage: schema.cardDesigns.cardPrintThankYouMessage,
    appTitle:                 schema.cardDesigns.appTitle,
  }).from(schema.cardDesigns).get();

  if (!design?.cardPrintEnabled) {
    return c.json({ error: { code: "not_enabled", message: "カード作成機能は現在利用できません" } }, 403);
  }

  const member = await db.select().from(schema.members)
    .where(eq(schema.members.id, body.memberId)).get();
  if (!member) return c.json({ error: { code: "not_found", message: "メンバーが見つかりません" } }, 404);

  let photoKey: string | null = null;
  if (body.photoBase64 && c.env.R2) {
    try {
      const base64 = body.photoBase64.includes(",") ? body.photoBase64.split(",")[1] : body.photoBase64;
      const binary = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
      photoKey = `card-orders/${body.memberId}/${now}-photo.jpg`;
      await c.env.R2.put(photoKey, binary, { httpMetadata: { contentType: "image/jpeg" } });
    } catch (e) {
      console.error("[register/card-order] 写真の保存に失敗", e);
    }
  }

  const skills = JSON.parse(member.skills || "[]") as Array<{
    name: string; emoji: string; issue: string; connector: string; solution: string;
  }>;

  const memberSnapshot = {
    name: member.name, furigana: member.furigana, romaji: member.romaji ?? "",
    email: member.email, category: member.category,
    businessDescription: member.businessDescription,
    company: member.company ?? "", role: member.role ?? "", skills,
  };

  const id = newId();
  await db.insert(schema.cardOrders).values({
    id,
    memberId: body.memberId,
    characterKey: body.characterKey,
    characterLabel: body.characterLabel,
    photoKey,
    address: body.address ?? null,
    phone: body.phone ?? null,
    planName: body.planName,
    planPrice: body.planPrice,
    memberSnapshot: JSON.stringify(memberSnapshot),
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });

  const orderData = {
    memberName: member.name, memberFurigana: member.furigana,
    memberRomaji: member.romaji ?? "", memberEmail: member.email,
    memberCategory: member.category, memberBusinessDescription: member.businessDescription,
    memberCompany: member.company ?? "", memberRole: member.role ?? "",
    memberAddress: member.address ?? "", memberPhone: member.phone ?? "",
    skills, characterKey: body.characterKey, characterLabel: body.characterLabel,
    orderAddress: body.address ?? "", orderPhone: body.phone ?? "",
    planName: body.planName, planPrice: body.planPrice,
  };

  const mailerCard = new MailService(db, c.env);
  const skillsText = buildSkillsHtml(orderData.skills);
  const memberTableText = buildMemberTableHtml(orderData as CardOrderMailData);
  const cardVarsBase = {
    appTitle: design.appTitle ?? "白樺クエスト",
    memberName: orderData.memberName,
    planName: orderData.planName,
    planPrice: String(orderData.planPrice.toLocaleString()),
    characterLabel: orderData.characterLabel,
    skillsText,
    thankYouMessage: design.cardPrintThankYouMessage ?? "ご注文ありがとうございました。",
    companyName: design.cardPrintCompanyName ?? "",
    orderAddress: orderData.orderAddress,
    orderPhone: orderData.orderPhone,
  };

  const mailPromises: Promise<void>[] = [];

  if (design.cardPrintContactEmail) {
    const companyMailPromise = mailerCard.send("card_order_company", design.cardPrintContactEmail, {
      ...cardVarsBase, memberTableText,
    })
      .then(() => console.log(`[register-card-order] ✅ 会社向けメール送信成功 → ${design.cardPrintContactEmail}`))
      .catch((e) => console.error(`[register-card-order] ❌ 会社向けメール送信失敗 → ${design.cardPrintContactEmail}:`, e));
    mailPromises.push(companyMailPromise);
  } else {
    console.warn("[register-card-order] ⚠️ cardPrintContactEmail が未設定のため会社向けメールをスキップ");
  }

  const confirmMailPromise = mailerCard.send("card_order_confirm", member.email, cardVarsBase)
    .then(() => console.log(`[register-card-order] ✅ 注文者確認メール送信成功 → ${member.email}`))
    .catch((e) => console.error(`[register-card-order] ❌ 注文者確認メール送信失敗 → ${member.email}:`, e));
  mailPromises.push(confirmMailPromise);

  // waitUntil でレスポンス後もメール送信を完走させる
  c.executionCtx.waitUntil(Promise.all(mailPromises));

  return c.json({ data: { id, thankYouMessage: design.cardPrintThankYouMessage } }, 201);
});
