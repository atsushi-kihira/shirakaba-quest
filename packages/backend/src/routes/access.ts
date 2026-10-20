// =============================================================
// 画面の閲覧の記録（管理画面の利用状況の集計用）
// POST /api/access/view  { screen } — メンバーが画面を開いたことを記録する（要ログイン）
// =============================================================
import { Hono } from "hono";
import { createDb } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { recordScreenView } from "../services/access-log.ts";
import type { Env, Variables } from "../types.ts";

export const accessRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

accessRoutes.post("/view", authMiddleware, async (c) => {
  const userId = c.get("userId");
  // メンバーとして使っている場合だけ記録する（管理画面の操作は数えない）
  if (userId && c.get("userType") === "member") {
    const { screen } = await c.req.json<{ screen?: string }>().catch(() => ({} as { screen?: string }));
    if (screen) c.executionCtx.waitUntil(recordScreenView(createDb(c.env.DB), userId, screen));
  }
  return c.json({ ok: true });
});
