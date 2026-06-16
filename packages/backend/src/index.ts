// =============================================================
// 白樺クエスト バックエンド — Hono on Cloudflare Workers
// =============================================================
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authRoutes } from "./routes/auth.ts";
import { memberRoutes } from "./routes/members.ts";
import { rankingRoutes } from "./routes/ranking.ts";
import { oneOnOneRoutes } from "./routes/oneonone.ts";
import { questRoutes } from "./routes/quests.ts";
import { badgeRoutes } from "./routes/badges.ts";
import { seasonRoutes } from "./routes/seasons.ts";
import { eventRoutes } from "./routes/events.ts";
import { teamRoutes } from "./routes/teams.ts";
import { registerRoutes } from "./routes/register.ts";
import { adminRoutes } from "./routes/admin/index.ts";
import { authMiddleware } from "./middleware/auth.ts";
import { adminMiddleware } from "./middleware/auth.ts";
import type { Env, Variables } from "./types.ts";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- ミドルウェア ----
app.use("*", async (c, next) => {
  const origin = c.env.CORS_ORIGIN ?? "http://localhost:5173";
  return cors({ origin, credentials: true })(c, next);
});

app.use("*", logger());

// ---- ヘルスチェック ----
app.get("/api/health", (c) =>
  c.json({ ok: true, env: c.env.ENVIRONMENT, timestamp: Date.now() })
);

// ---- ルート ----
app.route("/api/auth", authRoutes);
app.route("/api/register", registerRoutes);
app.route("/api/members", memberRoutes);
app.route("/api/ranking", rankingRoutes);
app.route("/api/oneonone", oneOnOneRoutes);
app.route("/api/quests", questRoutes);
app.route("/api", badgeRoutes);
app.route("/api/season", seasonRoutes);
app.route("/api/events", eventRoutes);
app.route("/api/teams", teamRoutes);

// ---- 公開アプリ設定（認証不要・全ユーザー対象） ----
app.get("/api/settings", async (c) => {
  const { createDb, schema } = await import("./db/index.ts");
  const db = createDb(c.env.DB);
  const design = await db.select().from(schema.cardDesigns).get();
  return c.json({
    data: {
      appTitle:     design?.appTitle     ?? "白樺クエスト",
      appLogo:      design?.appLogo      ?? "🃏",
      appPointName: design?.appPointName ?? "pt",
      termQuest:    design?.termQuest    ?? "お題",
      termUsp:      design?.termUsp      ?? "USP",
      termOneOnOne: design?.termOneOnOne ?? "1to1",
    },
  });
});

// ---- 公開 USP 一覧（メンバー登録・プロフィール編集で使用、認証不要） ----
app.get("/api/usps", async (c) => {
  const { createDb, schema } = await import("./db/index.ts");
  const db = createDb(c.env.DB);
  const usps = await db.select().from(schema.usps).orderBy(schema.usps.sortOrder).all();
  return c.json({ data: usps });
});
// 管理者ルートは index.ts 側でミドルウェアを適用
app.use("/api/admin/*", authMiddleware, adminMiddleware);
app.route("/api/admin", adminRoutes);

// ---- 404 ----
app.notFound((c) =>
  c.json({ error: { code: "not_found", message: "エンドポイントが見つかりません" } }, 404)
);

// ---- エラーハンドラー ----
app.onError((err, c) => {
  console.error("[ERROR]", err);
  return c.json(
    { error: { code: "internal_error", message: "サーバーエラーが発生しました。しばらく経ってからお試しください。" } },
    500
  );
});

export default app;
