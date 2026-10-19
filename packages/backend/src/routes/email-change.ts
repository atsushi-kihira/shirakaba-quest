// =============================================================
// メンバー本人によるメールアドレス変更
// POST /api/email-change/request  — 新しいメールアドレスに確認メールを送る（要ログイン）
// POST /api/email-change/verify   — 確認メール内のリンクから呼ばれる。確認できたらメールアドレスを切り替える（認証不要）
// =============================================================
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { generateUrlSafeToken } from "../services/auth.ts";
import { getFrontendUrl } from "../services/frontendUrl.ts";
import { MailService } from "../services/mailer.ts";
import { normalizeEmail } from "../services/registration.ts";
import {
  EMAIL_CHANGE_VALIDITY_SECONDS, applyEmailChange, isEmailInUse, isValidEmailFormat,
} from "../services/email-change.ts";
import type { Env, Variables } from "../types.ts";

export const emailChangeRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const REQUEST_LIMIT_PER_HOUR = 5;

emailChangeRoutes.post("/request", authMiddleware, async (c) => {
  const userId = c.get("userId");
  if (!userId || c.get("userType") !== "member") {
    return c.json({ error: { code: "forbidden", message: "メンバーとしてログインしている方のみ、メールアドレスを変更できます" } }, 403);
  }
  const db = createDb(c.env.DB);
  const { newEmail } = await c.req.json<{ newEmail?: string }>().catch(() => ({} as { newEmail?: string }));
  const email = normalizeEmail(newEmail ?? "");
  if (!isValidEmailFormat(email)) {
    return c.json({ error: { code: "invalid_email", message: "メールアドレスの形式が正しくありません。もう一度ご確認ください。" } }, 400);
  }

  const member = await db.select({ name: schema.members.name, email: schema.members.email }).from(schema.members)
    .where(eq(schema.members.id, userId)).get();
  if (!member) return c.json({ error: { code: "not_found", message: "メンバー情報が見つかりません" } }, 404);
  if (normalizeEmail(member.email) === email) {
    return c.json({ error: { code: "same_email", message: "いま使っているメールアドレスと同じです。別のメールアドレスを入力してください。" } }, 400);
  }
  if (await isEmailInUse(db, email, userId)) {
    return c.json({ error: { code: "email_taken", message: "このメールアドレスは、すでに使われています。別のメールアドレスを入力してください。" } }, 409);
  }

  // 短時間に何度も確認メールを送れないようにする
  const rateKey = `emailchg-rate:${userId}`;
  const count = Number((await c.env.KV.get(rateKey)) ?? "0");
  if (count >= REQUEST_LIMIT_PER_HOUR) {
    return c.json({ error: { code: "rate_limited", message: "確認メールの送信回数が多すぎます。1時間ほどあけてから、もう一度お試しください。" } }, 429);
  }
  await c.env.KV.put(rateKey, String(count + 1), { expirationTtl: 3600 });

  const now = Math.floor(Date.now() / 1000);
  const token = generateUrlSafeToken();
  await db.insert(schema.emailChangeRequests).values({
    token, memberId: userId, newEmail: email, expiresAt: now + EMAIL_CHANGE_VALIDITY_SECONDS, usedAt: null, createdAt: now,
  });
  const design = await db.select({ appTitle: schema.cardDesigns.appTitle }).from(schema.cardDesigns).get();
  const verifyUrl = `${getFrontendUrl(c.env)}/email-change/verify?token=${token}`;
  try {
    await new MailService(db, c.env).send("email_change_verify", email, {
      appTitle: design?.appTitle ?? "白樺クエスト", memberName: member.name, verifyUrl,
    });
  } catch (e) {
    console.error("[email-change] 確認メールの送信に失敗", e);
    return c.json({ error: { code: "mail_failed", message: "確認メールを送れませんでした。メールアドレスをご確認のうえ、もう一度お試しください。" } }, 502);
  }
  return c.json({ data: { sentTo: email } }, 201);
});

emailChangeRoutes.post("/verify", async (c) => {
  const db = createDb(c.env.DB);
  const { token } = await c.req.json<{ token?: string }>().catch(() => ({} as { token?: string }));
  if (!token) return c.json({ error: { code: "bad_request", message: "確認リンクが正しくありません" } }, 400);

  const row = await db.select().from(schema.emailChangeRequests).where(eq(schema.emailChangeRequests.token, token)).get();
  if (!row) {
    return c.json({ error: { code: "not_found", message: "確認リンクが無効です。お手数ですが、マイページからもう一度変更をお申し込みください。" } }, 404);
  }
  const now = Math.floor(Date.now() / 1000);
  const member = await db.select({ email: schema.members.email }).from(schema.members)
    .where(eq(schema.members.id, row.memberId)).get();
  if (!member) return c.json({ error: { code: "not_found", message: "メンバー情報が見つかりません" } }, 404);

  // すでに切り替え済み（リンクを2回開いた等）なら、そのまま完了として返す
  if (row.usedAt && normalizeEmail(member.email) === row.newEmail) {
    return c.json({ data: { email: row.newEmail } });
  }
  if (row.usedAt) {
    return c.json({ error: { code: "used", message: "この確認リンクはすでに使われています。お手数ですが、マイページからもう一度変更をお申し込みください。" } }, 410);
  }
  if (row.expiresAt < now) {
    return c.json({ error: { code: "expired", message: "確認リンクの有効期限が切れています。お手数ですが、マイページからもう一度変更をお申し込みください。" } }, 410);
  }
  if (await isEmailInUse(db, row.newEmail, row.memberId)) {
    return c.json({ error: { code: "email_taken", message: "このメールアドレスは、すでに別の方が使っています。別のメールアドレスで、もう一度お申し込みください。" } }, 409);
  }

  await applyEmailChange(db, c.env, (p) => c.executionCtx.waitUntil(p), row.memberId, row.newEmail, { syncLinkedAdmin: true });
  await db.update(schema.emailChangeRequests).set({ usedAt: now }).where(eq(schema.emailChangeRequests.token, token));
  return c.json({ data: { email: row.newEmail } });
});
