// =============================================================
// 認証ミドルウェア — Bearer token 検証
// =============================================================
import { createMiddleware } from "hono/factory";
import { createDb } from "../db/index.ts";
import { verifySession } from "../services/auth.ts";
import { resolveEffectiveMemberId } from "../services/resolve-member.ts";
import type { Env, Variables } from "../types.ts";

/** 認証必須ミドルウェア */
export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: Variables;
}>(async (c, next) => {
  const authorization = c.req.header("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return c.json(
      { error: { code: "unauthorized", message: "ログインが必要です" } },
      401
    );
  }

  const rawToken = authorization.slice("Bearer ".length);
  const db = createDb(c.env.DB);
  const result = await verifySession({ db, rawToken });

  if (!result) {
    return c.json(
      { error: { code: "session_expired", message: "セッションが期限切れです。再度ログインしてください。" } },
      401
    );
  }

  c.set("userId", result.userId);
  c.set("userType", result.userType);

  // 管理者でログインしていても、同じメールアドレスのメンバー登録がある人は、管理画面以外ではメンバー本人として扱う。
  // （管理者ログインで入った人が、マイページや各種機能でメンバーとしての機能を使えない状態を防ぐため。
  //   メンバーとしてログインした場合と同じ機能・同じ表示になる。管理画面とログイン情報の取得は管理者のまま）
  if (result.userType === "admin") {
    const path = c.req.path;
    if (!path.startsWith("/api/admin") && !path.startsWith("/api/auth")) {
      const memberId = await resolveEffectiveMemberId(db, result.userId, "admin");
      if (memberId) {
        c.set("userId", memberId);
        c.set("userType", "member");
      }
    }
  }
  await next();
});

/** 管理者専用ミドルウェア（authMiddleware の後に使う） */
export const adminMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: Variables;
}>(async (c, next) => {
  const userType = c.get("userType");
  if (userType !== "admin") {
    return c.json(
      { error: { code: "forbidden", message: "管理者権限が必要です" } },
      403
    );
  }
  await next();
});
