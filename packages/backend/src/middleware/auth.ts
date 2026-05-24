// =============================================================
// 認証ミドルウェア — Bearer token 検証
// =============================================================
import { createMiddleware } from "hono/factory";
import { createDb } from "../db/index.ts";
import { verifySession } from "../services/auth.ts";
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
