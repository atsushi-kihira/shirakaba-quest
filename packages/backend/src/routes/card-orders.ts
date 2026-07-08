// =============================================================
// カード発注ルート（メンバー向け）
// GET  /api/card-print-settings  — 発注設定の公開情報（プラン・キャラ等）
// POST /api/card-orders          — 発注申込
// GET  /api/card-orders/my       — 自分の発注履歴
// =============================================================
import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { newId } from "../services/auth.ts";
import { MailService, buildMemberTableHtml, buildSkillsHtml } from "../services/mailer.ts";
import type { CardOrderMailData } from "../services/mailer.ts";
import type { Env, Variables } from "../types.ts";

export const cardOrderRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- GET /api/card-print-settings ----
cardOrderRoutes.get("/card-print-settings", async (c) => {
  const db = createDb(c.env.DB);
  const design = await db.select({
    cardPrintEnabled:         schema.cardDesigns.cardPrintEnabled,
    cardPrintCompanyName:     schema.cardDesigns.cardPrintCompanyName,
    cardPrintImageOnlyPrice:  schema.cardDesigns.cardPrintImageOnlyPrice,
    cardPrintImageOnlyName:   schema.cardDesigns.cardPrintImageOnlyName,
    cardPrintPlans:           schema.cardDesigns.cardPrintPlans,
    cardPrintThankYouMessage: schema.cardDesigns.cardPrintThankYouMessage,
  }).from(schema.cardDesigns).get();

  if (!design) return c.json({ data: null });

  return c.json({
    data: {
      enabled: !!design.cardPrintEnabled,
      companyName: design.cardPrintCompanyName,
      imageOnlyPrice: design.cardPrintImageOnlyPrice,
      imageOnlyName: design.cardPrintImageOnlyName || "カードイメージデータ作成のみ",
      plans: JSON.parse(design.cardPrintPlans || "[]") as Array<{ name: string; price: number }>,
      thankYouMessage: design.cardPrintThankYouMessage,
    },
  });
});

// ---- POST /api/card-orders ----
cardOrderRoutes.post("/card-orders", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);
  const isDev = c.env.ENVIRONMENT === "development";

  const body = await c.req.json<{
    characterKey: string;
    characterLabel: string;
    photoBase64?: string;
    address?: string;
    phone?: string;
    planName: string;
    planPrice: number;
  }>();

  if (!body.characterKey || !body.planName) {
    return c.json({ error: { code: "invalid_input", message: "キャラクターとプランは必須です" } }, 400);
  }

  // 発注設定を取得
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

  // メンバー情報を取得
  const member = await db.select().from(schema.members).where(eq(schema.members.id, memberId)).get();
  if (!member) return c.json({ error: { code: "not_found", message: "メンバーが見つかりません" } }, 404);

  // 写真をR2に保存
  let photoKey: string | null = null;
  if (body.photoBase64 && c.env.R2) {
    try {
      const base64 = body.photoBase64.includes(",") ? body.photoBase64.split(",")[1] : body.photoBase64;
      const binary = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
      photoKey = `card-orders/${memberId}/${now}-photo.jpg`;
      await c.env.R2.put(photoKey, binary, { httpMetadata: { contentType: "image/jpeg" } });
    } catch (e) {
      console.error("[card-orders] 写真の保存に失敗", e);
    }
  }

  const skills = JSON.parse(member.skills || "[]") as Array<{
    name: string; emoji: string; issue: string; connector: string; solution: string;
  }>;

  const memberSnapshot = {
    name: member.name,
    furigana: member.furigana,
    romaji: member.romaji ?? "",
    email: member.email,
    category: member.category,
    businessDescription: member.businessDescription,
    company: member.company ?? "",
    role: member.role ?? "",
    skills,
  };

  const id = newId();
  await db.insert(schema.cardOrders).values({
    id,
    memberId,
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
    memberName: member.name,
    memberFurigana: member.furigana,
    memberRomaji: member.romaji ?? "",
    memberEmail: member.email,
    memberCategory: member.category,
    memberBusinessDescription: member.businessDescription,
    memberCompany: member.company ?? "",
    memberRole: member.role ?? "",
    memberAddress: member.address ?? "",
    memberPhone: member.phone ?? "",
    skills,
    characterKey: body.characterKey,
    characterLabel: body.characterLabel,
    orderAddress: body.address ?? "",
    orderPhone: body.phone ?? "",
    planName: body.planName,
    planPrice: body.planPrice,
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

  // カード会社へ通知メール
  if (design.cardPrintContactEmail) {
    const companyMailPromise = mailerCard.send("card_order_company", design.cardPrintContactEmail, {
      ...cardVarsBase, memberTableText,
    })
      .then(() => console.log(`[card-order] ✅ 会社向けメール送信成功 → ${design.cardPrintContactEmail}`))
      .catch((e) => console.error(`[card-order] ❌ 会社向けメール送信失敗 → ${design.cardPrintContactEmail}:`, e));
    mailPromises.push(companyMailPromise);
  } else {
    console.warn("[card-order] ⚠️ cardPrintContactEmail が未設定のため会社向けメールをスキップ");
  }

  // 注文者への確認メール
  const confirmMailPromise = mailerCard.send("card_order_confirm", member.email, cardVarsBase)
    .then(() => console.log(`[card-order] ✅ 注文者確認メール送信成功 → ${member.email}`))
    .catch((e) => console.error(`[card-order] ❌ 注文者確認メール送信失敗 → ${member.email}:`, e));
  mailPromises.push(confirmMailPromise);

  // waitUntil でレスポンス後もメール送信を完走させる
  c.executionCtx.waitUntil(Promise.all(mailPromises));

  return c.json({ data: { id, thankYouMessage: design.cardPrintThankYouMessage } }, 201);
});

// ---- GET /api/card-orders/my ----
cardOrderRoutes.get("/card-orders/my", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");

  const orders = await db
    .select()
    .from(schema.cardOrders)
    .where(eq(schema.cardOrders.memberId, memberId))
    .orderBy(desc(schema.cardOrders.createdAt))
    .all();

  return c.json({
    data: orders.map((o) => ({
      id: o.id,
      characterKey: o.characterKey,
      characterLabel: o.characterLabel,
      planName: o.planName,
      planPrice: o.planPrice,
      status: o.status,
      createdAt: o.createdAt,
    })),
  });
});
