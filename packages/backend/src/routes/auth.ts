// =============================================================
// 認証ルート
// POST /api/auth/request-otp
// POST /api/auth/verify-otp
// POST /api/auth/logout
// GET  /api/auth/me
// =============================================================
import { Hono } from "hono";
import { createDb, schema } from "../db/index.ts";
import {
  generateOtpCode,
  storeOtp,
  verifyAndConsumeOtp,
  findUserByEmail,
  createSession,
  deleteSession,
} from "../services/auth.ts";
import { sendOtpMail } from "../services/mailer.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { eq } from "drizzle-orm";
import type { Env, Variables } from "../types.ts";

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- POST /api/auth/request-otp ----
authRoutes.post("/request-otp", async (c) => {
  const { email, context } = await c.req.json<{
    email: string;
    context?: "admin" | "member";  // 管理者ログイン時は "admin" を渡す
  }>();

  if (!email || !email.includes("@")) {
    return c.json(
      { error: { code: "invalid_email", message: "メールアドレスが正しくありません" } },
      400
    );
  }

  const db = createDb(c.env.DB);
  const found = await findUserByEmail(db, email.toLowerCase(), context ?? "member");

  if (found) {
    // メンバーの場合はアクティブか確認
    if (found.userType === "member") {
      const member = await db
        .select({ status: schema.members.status })
        .from(schema.members)
        .where(eq(schema.members.id, found.id))
        .get();

      if (member?.status === "pending") {
        console.log(`[OTP] Blocked: ${email} is pending`);
        return c.json({
          ok: false,
          status: "pending",
          message: "アカウントは管理者の承認待ちです。承認されるとログインできるようになります。",
        });
      }
      if (member?.status === "suspended") {
        return c.json({
          ok: false,
          status: "suspended",
          message: "このアカウントは現在停止されています。管理者にお問い合わせください。",
        });
      }
    }

    const code = generateOtpCode();
    await storeOtp({ kv: c.env.KV, email: email.toLowerCase(), code });
    await sendOtpMail({
      to: email,
      code,
      apiKey: c.env.SENDGRID_API_KEY,
      isDev: c.env.ENVIRONMENT === "development",
      fromEmail: c.env.SENDGRID_FROM_EMAIL,
    });
  }

  // 見つからなくても同じレスポンスを返す（ユーザー列挙防止）
  return c.json({ ok: true });
});

// ---- POST /api/auth/verify-otp ----
authRoutes.post("/verify-otp", async (c) => {
  const { email, code, context } = await c.req.json<{
    email: string;
    code: string;
    context?: "admin" | "member";
  }>();

  if (!email || !code) {
    return c.json(
      { error: { code: "missing_fields", message: "メールアドレスとコードは必須です" } },
      400
    );
  }

  const isValid = await verifyAndConsumeOtp({
    kv: c.env.KV,
    email: email.toLowerCase(),
    code,
  });

  if (!isValid) {
    return c.json(
      { error: { code: "invalid_otp", message: "コードが正しくないか、有効期限が切れています" } },
      401
    );
  }

  const db = createDb(c.env.DB);
  const found = await findUserByEmail(db, email.toLowerCase(), context ?? "member");

  if (!found) {
    return c.json(
      { error: { code: "user_not_found", message: "アカウントが見つかりません" } },
      404
    );
  }

  const rawToken = await createSession({
    db,
    userId: found.id,
    userType: found.userType,
  });

  // ユーザー情報を返す（パスワード等センシティブなものは除く）
  const userInfo = found.userType === "member"
    ? {
        id: found.user.id,
        name: (found.user as typeof schema.members.$inferSelect).name,
        email: (found.user as typeof schema.members.$inferSelect).email,
        emoji: (found.user as typeof schema.members.$inferSelect).emoji,
        bgColor: (found.user as typeof schema.members.$inferSelect).bgColor,
      }
    : {
        id: found.user.id,
        name: (found.user as typeof schema.admins.$inferSelect).name,
        email: (found.user as typeof schema.admins.$inferSelect).email,
        emoji: "⚙️",
        bgColor: "bg-stone-100",
      };

  return c.json({
    token: rawToken,
    userType: found.userType,
    user: userInfo,
  });
});

// ---- POST /api/auth/logout ----
authRoutes.post("/logout", async (c) => {
  const authorization = c.req.header("Authorization");
  if (authorization?.startsWith("Bearer ")) {
    const rawToken = authorization.slice("Bearer ".length);
    const db = createDb(c.env.DB);
    await deleteSession({ db, rawToken });
  }
  return c.json({ ok: true });
});

// ---- GET /api/auth/me ----
authRoutes.get("/me", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const userType = c.get("userType");
  const db = createDb(c.env.DB);

  if (userType === "member") {
    const member = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, userId))
      .get();

    if (!member) {
      return c.json(
        { error: { code: "not_found", message: "メンバーが見つかりません" } },
        404
      );
    }

    return c.json({
      data: {
        id: member.id,
        name: member.name,
        email: member.email,
        emoji: member.emoji,
        bgColor: member.bgColor,
        userType: "member",
        status: member.status,
        avatarImageKey: member.avatarImageKey ?? null,
      },
    });
  }

  // admin
  const admin = await db
    .select()
    .from(schema.admins)
    .where(eq(schema.admins.id, userId))
    .get();

  if (!admin) {
    return c.json(
      { error: { code: "not_found", message: "管理者が見つかりません" } },
      404
    );
  }

  return c.json({
    data: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      emoji: "⚙️",
      bgColor: "bg-stone-100",
      userType: "admin",
      role: admin.role,
    },
  });
});
