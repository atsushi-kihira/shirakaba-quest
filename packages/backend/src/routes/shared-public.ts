// =============================================================
// 共有（URLを知っている人全員）のログイン不要ルート
//   GET /api/shared/:token — URL共有になっているものを、読み取り専用で返す
// 合言葉が合わない・共有をやめた・もとが削除されたときは、区別せず「見つかりません」にする。
// 検索エンジンには載せない（noindex）。
// =============================================================
import { Hono } from "hono";
import { createDb } from "../db/index.ts";
import { viewByLink } from "../services/content-share.ts";
import type { Env, Variables } from "../types.ts";

export const sharedPublicRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

sharedPublicRoutes.get("/:token", async (c) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
  const db = createDb(c.env.DB);
  const view = await viewByLink(db, c.req.param("token"));
  if (!view) return c.json({ error: { code: "not_found", message: "この共有は、見つかりませんでした。URLが違うか、共有が終わった可能性があります" } }, 404);
  return c.json({ data: view });
});
