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
import { MailService } from "../services/mailer.ts";
import { hasMemberRole } from "../services/member-roles.ts";
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

  if (!found) {
    return c.json({
      error: {
        code: "email_not_registered",
        message: "このメールアドレスは登録されていません。メールアドレスをご確認ください。",
      },
    }, 404);
  }

  // メンバーの場合はアクティブか確認
  if (found.userType === "member") {
    const member = await db
      .select({ status: schema.members.status })
      .from(schema.members)
      .where(eq(schema.members.id, found.id))
      .get();

    // pending（承認待ち）は、承認前でも限定機能のゲストとしてログインできるようにする（フロント側でUIを制限）
    if (member?.status === "on_leave") {
      return c.json({
        ok: false,
        status: "on_leave",
        message: "このアカウントは現在休会中です。管理者にお問い合わせください。",
      });
    }
  }

  const code = generateOtpCode();
  await storeOtp({ kv: c.env.KV, email: email.toLowerCase(), code });

  const design = await db.select({ appTitle: schema.cardDesigns.appTitle }).from(schema.cardDesigns).get();
  const appTitle = design?.appTitle ?? "白樺クエスト";

  const mailer = new MailService(db, c.env);
  await mailer.send("otp_login", email, { appTitle, otpCode: code });

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

    const [isPilot1, isPilot2] = await Promise.all([
      hasMemberRole(db, member.id, "pilot1"),
      hasMemberRole(db, member.id, "pilot2"),
    ]);

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
        timezone: (member as typeof member & { timezone?: string | null }).timezone ?? null,
        personalTheme: member.personalTheme ?? null,
        businessCommunityJoinedDate: member.businessCommunityJoinedDate ?? null,
        isPilot1,
        isPilot2,
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
