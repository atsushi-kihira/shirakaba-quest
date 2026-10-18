// =============================================================
// メンバー登録ルート
// POST /api/register/scan-card                    — カード画像OCR + Claude 構造化
// POST /api/register/request-email-verification    — 手入力登録時：入力内容を下書き保存し、確認メールを送る
// GET  /api/register/email-verification-status     — 確認メールのリンククリック待ちポーリング用（登録完了も返す）
// POST /api/register/verify-email                  — メール内リンクからの確認完了＝下書きの内容で仮登録（承認待ち）を作成
// POST /api/register/resume                        — 前回の入力（下書き）が残っていれば、確認メールを再送して続きから登録
// POST /api/register/submit                        — 仮登録申請（カードを読み取れた場合など、メール確認なしの登録）
// =============================================================
import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { newId } from "../services/auth.ts";
import { scanCard } from "../services/ocr.ts";
import { getFrontendUrl } from "../services/frontendUrl.ts";
import { MailService, buildMemberTableHtml, buildSkillsHtml } from "../services/mailer.ts";
import {
  createPendingMember, deleteDraft, isEmailAlreadyRegistered, loadDraft, normalizeEmail, saveDraft,
  sendVerificationMail, validateRegistrationBody, type RegistrationBody,
} from "../services/registration.ts";
import type { CardOrderMailData } from "../services/mailer.ts";
import type { Env, Variables } from "../types.ts";

export const registerRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- POST /api/register/request-email-verification ----
// 手入力での登録時、プロフィール入力（メールアドレス）後に確認メールを送る。
// 入力内容（registration）が付いていれば下書きとして保存し、メール内のリンクが開かれた時点で仮登録を完了させる。
registerRoutes.post("/request-email-verification", async (c) => {
  const db = createDb(c.env.DB);
  const body = await c.req.json<{ email: string; registration?: RegistrationBody }>();
  const email = body.email;

  if (!email || !email.includes("@")) {
    return c.json({ error: { code: "invalid_email", message: "メールアドレスが正しくありません" } }, 400);
  }
  const normalizedEmail = normalizeEmail(email);

  if (await isEmailAlreadyRegistered(db, normalizedEmail)) {
    return c.json({ error: { code: "email_taken", message: "このメールアドレスはすでに登録されています" } }, 409);
  }

  let draftSaved = false;
  if (body.registration) {
    const registration = { ...body.registration, email: normalizedEmail };
    const problem = validateRegistrationBody(registration);
    if (problem) return c.json({ error: { code: "bad_request", message: problem } }, 400);
    try {
      await saveDraft(c.env.KV, registration);
      draftSaved = true;
    } catch (e) {
      // 下書きの保存に失敗しても確認メールは送る（その場合は、画面側から従来どおり登録を送信する）
      console.error("[register] 下書きの保存に失敗", e);
    }
  }

  const token = await sendVerificationMail(db, c.env, normalizedEmail);
  return c.json({ data: { token, draftSaved } }, 201);
});

// ---- GET /api/register/email-verification-status?token=... ----
// 登録画面側が、メール内リンクがクリックされたか（＝登録が完了したか）をポーリングして確認する
registerRoutes.get("/email-verification-status", async (c) => {
  const db = createDb(c.env.DB);
  const token = c.req.query("token");
  if (!token) return c.json({ error: { code: "bad_request", message: "tokenが必要です" } }, 400);

  const row = await db.select().from(schema.emailVerifications).where(eq(schema.emailVerifications.token, token)).get();
  if (!row) return c.json({ error: { code: "not_found", message: "確認リンクが見つかりません" } }, 404);

  const now = Math.floor(Date.now() / 1000);
  let memberId: string | null = null;
  if (row.verifiedAt) {
    const member = await db.select({ id: schema.members.id }).from(schema.members)
      .where(eq(schema.members.email, row.email)).get();
    memberId = member?.id ?? null;
  }
  return c.json({ data: { verified: !!row.verifiedAt, expired: row.expiresAt < now, registered: !!memberId, memberId } });
});

// ---- POST /api/register/verify-email ----
// メール内のリンクをクリックした先から呼ばれる。確認完了をマークし、保存済みの下書きがあれば、その内容で仮登録（承認待ち）を作成する。
registerRoutes.post("/verify-email", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const { token } = await c.req.json<{ token: string }>();
  if (!token) return c.json({ error: { code: "bad_request", message: "tokenが必要です" } }, 400);

  const row = await db.select().from(schema.emailVerifications).where(eq(schema.emailVerifications.token, token)).get();
  if (!row) {
    return c.json({ error: { code: "not_found", message: "確認リンクが無効です。最初から登録をやり直してください。" } }, 404);
  }
  if (row.expiresAt < now) {
    return c.json({ error: { code: "expired", message: "確認リンクの有効期限が切れています。最初から登録をやり直してください。" } }, 410);
  }

  if (!row.verifiedAt) {
    await db.update(schema.emailVerifications).set({ verifiedAt: now }).where(eq(schema.emailVerifications.token, token));
  }

  // すでに登録済み（リンクを2回開いた・画面側が先に登録した等）ならそのまま完了として返す
  const existing = await db.select({ id: schema.members.id }).from(schema.members).where(eq(schema.members.email, row.email)).get();
  if (existing) return c.json({ data: { email: row.email, registered: true, memberId: existing.id } });

  // 下書きがあれば、その内容で仮登録を作成する。失敗しても確認自体は完了とする（画面側から続きを送信できる）
  try {
    const draft = await loadDraft(c.env.KV, row.email);
    if (draft && !validateRegistrationBody(draft)) {
      const memberId = await createPendingMember(db, c.env, (p) => c.executionCtx.waitUntil(p), draft);
      await deleteDraft(c.env.KV, row.email);
      return c.json({ data: { email: row.email, registered: true, memberId } });
    }
  } catch (e) {
    console.error("[register] 下書きからの仮登録に失敗", e);
  }
  return c.json({ data: { email: row.email, registered: false, memberId: null } });
});

// ---- POST /api/register/resume ----
// 前回の入力（下書き）が残っているメールアドレスなら、確認メールを送り直す。メール内のリンクを開くと、前回の内容で仮登録が完了する。
// メールアドレスの登録状況を第三者に知られないよう、下書きの有無にかかわらず同じ応答を返す。
registerRoutes.post("/resume", async (c) => {
  const db = createDb(c.env.DB);
  const { email } = await c.req.json<{ email?: string }>().catch(() => ({} as { email?: string }));
  if (!email || !email.includes("@")) {
    return c.json({ error: { code: "invalid_email", message: "メールアドレスが正しくありません" } }, 400);
  }
  const normalized = normalizeEmail(email);
  try {
    if (!(await isEmailAlreadyRegistered(db, normalized)) && (await loadDraft(c.env.KV, normalized))) {
      await sendVerificationMail(db, c.env, normalized);
    }
  } catch (e) {
    console.error("[register] 続きからの登録メール送信に失敗", e);
  }
  return c.json({ data: { ok: true } });
});

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
  const db = createDb(c.env.DB);

  try {
    const design = await db.select({ frontFeatureLabel: schema.cardDesigns.frontFeatureLabel }).from(schema.cardDesigns).get();
    const result = await scanCard({
      imageBase64: body.imageBase64,
      side: body.side ?? "front",
      visionApiKey: c.env.GOOGLE_VISION_API_KEY ?? "",
      anthropicApiKey: c.env.ANTHROPIC_API_KEY ?? "",
      isDev,
      cardLabel: design?.frontFeatureLabel,
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
// メール確認を挟まない登録（カードを読み取れた場合）、および、メール確認後に下書きから仮登録できなかった場合の送信用
registerRoutes.post("/submit", async (c) => {
  const db = createDb(c.env.DB);
  const body = await c.req.json<RegistrationBody>();

  const problem = validateRegistrationBody(body);
  if (problem) return c.json({ error: { code: "bad_request", message: problem } }, 400);

  const normalizedEmail = normalizeEmail(body.email);

  // メールアドレス重複チェック
  if (await isEmailAlreadyRegistered(db, normalizedEmail)) {
    return c.json({
      error: { code: "email_taken", message: "このメールアドレスはすでに登録されています" },
    }, 409);
  }

  // 手入力登録（カード読み取りができなかった場合）は、なりすまし防止のため事前のメールアドレス確認を必須にする
  if (!body.cardScanVerified) {
    const verification = await db.select().from(schema.emailVerifications)
      .where(eq(schema.emailVerifications.email, normalizedEmail))
      .orderBy(desc(schema.emailVerifications.createdAt))
      .get();
    if (!verification || !verification.verifiedAt) {
      return c.json({
        error: { code: "email_not_verified", message: "メールアドレスの確認が完了していません。確認メール内のリンクをクリックしてください。" },
      }, 400);
    }
  }

  const id = await createPendingMember(db, c.env, (p) => c.executionCtx.waitUntil(p), { ...body, email: normalizedEmail });
  // 同じメールアドレスの下書きが残っていれば不要になるので消す
  await deleteDraft(c.env.KV, normalizedEmail).catch(() => {});

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
