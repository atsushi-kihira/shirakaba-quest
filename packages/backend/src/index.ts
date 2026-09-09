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
import { oneOnOnePublicRoutes } from "./routes/oneonone-public.ts";
import { questRoutes } from "./routes/quests.ts";
import { badgeRoutes } from "./routes/badges.ts";
import { seasonRoutes } from "./routes/seasons.ts";
import { eventRoutes } from "./routes/events.ts";
import { teamRoutes } from "./routes/teams.ts";
import { collabRoutes, sweepPendingCompanySummaries } from "./routes/collab.ts";
import { shareStoryRoutes } from "./routes/share-stories.ts";
import { enishiRoutes } from "./routes/enishi.ts";
import { registerRoutes } from "./routes/register.ts";
import { adminRoutes } from "./routes/admin/index.ts";
import { meetingRoutes } from "./routes/meetings.ts";
import { meetingSeriesRoutes } from "./routes/meeting-series.ts";
import { scheduleRoutes } from "./routes/schedule.ts";
import { schedulerRoutes } from "./routes/scheduler/index.ts";
import { pushRoutes } from "./routes/push.ts";
import { cardOrderRoutes } from "./routes/card-orders.ts";
import { authMiddleware } from "./middleware/auth.ts";
import { adminMiddleware } from "./middleware/auth.ts";
import type { Env, Variables } from "./types.ts";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- ミドルウェア ----
app.use("*", async (c, next) => {
  // CORS_ORIGIN はカンマ区切りで複数ドメインを許可できる（例: 旧ドメインと新ドメインの並行運用）
  const origins = (c.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return cors({ origin: origins, credentials: true })(c, next);
});

app.use("*", logger());

// セキュリティ強化のためのレスポンスヘッダー（クリックジャッキング対策・MIME スニッフィング対策など）
app.use("*", async (c, next) => {
  await next();
  c.header("X-Frame-Options", "DENY");
  c.header("Content-Security-Policy", "frame-ancestors 'none'");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  c.header("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=(), usb=()");
});

// ---- ヘルスチェック ----
app.get("/api/health", (c) =>
  c.json({ ok: true, env: c.env.ENVIRONMENT, timestamp: Date.now() })
);

// ---- ルート ----
app.route("/api/auth", authRoutes);
app.route("/api/register", registerRoutes);
app.route("/api/members", memberRoutes);
app.route("/api/ranking", rankingRoutes);
app.route("/api/oneonone/public", oneOnOnePublicRoutes); // 認証なし（メール経由の承諾/辞退用）
app.route("/api/oneonone", oneOnOneRoutes);
app.route("/api/quests", questRoutes);
app.route("/api", badgeRoutes);
app.route("/api/season", seasonRoutes);
app.route("/api/events", eventRoutes);
app.route("/api/teams", teamRoutes);
app.route("/api/collab", collabRoutes);
app.route("/api/share-stories", shareStoryRoutes);
app.route("/api/enishi", enishiRoutes);
app.route("/api/meetings", meetingRoutes);
app.route("/api/meeting-series", meetingSeriesRoutes);
app.route("/api/schedule", scheduleRoutes);
app.route("/api/push", pushRoutes);
app.route("/api/scheduler", schedulerRoutes);

// ---- 内部専用: 会社概要のバックグラウンド生成の自己連鎖呼び出し（一般ユーザーの認証は使わず、共有シークレットで保護） ----
app.post("/api/internal/sweep-pending-summaries", async (c) => {
  const secret = c.req.header("x-internal-task-secret");
  if (!secret || secret !== c.env.INTERNAL_TASK_SECRET) {
    return c.json({ error: { code: "forbidden", message: "許可されていないリクエストです" } }, 403);
  }
  const { createDb } = await import("./db/index.ts");
  const db = createDb(c.env.DB);
  const { hop } = await c.req.json<{ hop?: number }>().catch(() => ({ hop: 0 }));
  const origin = new URL(c.req.url).origin;
  c.executionCtx.waitUntil(sweepPendingCompanySummaries(db, c.env, origin, hop ?? 0));
  return c.json({ ok: true });
});

// ---- 公開アプリ設定（認証不要・全ユーザー対象） ----
app.get("/api/settings", async (c) => {
  const { createDb, schema } = await import("./db/index.ts");
  const db = createDb(c.env.DB);
  const design = await db.select().from(schema.cardDesigns).get();
  return c.json({
    data: {
      appTitle:          design?.appTitle          ?? "白樺クエスト",
      appLogo:           design?.appLogo           ?? "🃏",
      appPointName:      design?.appPointName      ?? "pt",
      termQuest:         design?.termQuest         ?? "お題",
      termUsp:           design?.termUsp           ?? "USP",
      termOneOnOne:      design?.termOneOnOne      ?? "1to1",
      termExternalGuest: design?.termExternalGuest ?? "外部ゲスト",
      termEnishi:        design?.termEnishi        ?? "ご縁",
      termBusinessCommunity: design?.termBusinessCommunity ?? "ビジネスコミュニティ",
      characterImageKey: design?.characterImageKey ?? null,
      timezone:          design?.timezone          ?? "Asia/Tokyo",
      theme:             design?.theme             ?? "playful",
    },
  });
});

// ---- 公開キャラクター画像配信（R2 or デフォルト） ----
app.get("/api/character-image", async (c) => {
  const { createDb, schema } = await import("./db/index.ts");
  const db = createDb(c.env.DB);
  const design = await db.select({ characterImageKey: schema.cardDesigns.characterImageKey }).from(schema.cardDesigns).get();

  if (!design?.characterImageKey) {
    // カスタム未設定: 404 を返してフロントはデフォルト画像を使う
    return c.json({ error: { code: "not_found", message: "カスタムキャラクター画像が未設定です" } }, 404);
  }

  const obj = await c.env.R2.get(design.characterImageKey);
  if (!obj) return c.json({ error: { code: "not_found", message: "画像が見つかりません" } }, 404);

  const contentType = obj.httpMetadata?.contentType ?? "image/png";
  const buf = await obj.arrayBuffer();
  return new Response(buf, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=60",
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
// カード発注設定は公開（認証不要）、発注自体は認証必須
app.use("/api/card-orders/*", authMiddleware);
app.route("/api", cardOrderRoutes);

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
