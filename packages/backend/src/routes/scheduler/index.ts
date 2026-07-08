// スケジューラー機能ルートのエントリーポイント
// /api/scheduler/* 配下に全ルートをマウント
// callback は認証不要（OAuth state で本人確認）、その他は認証必須

import { Hono } from "hono";
import { oauthGoogleRoutes } from "./oauth-google.ts";
import { oauthZoomRoutes } from "./oauth-zoom.ts";
import { schedulerSettingsRoutes } from "./settings.ts";
import { publicBookingRoutes } from "./public.ts";
import { schedulerBookingsRoutes } from "./bookings.ts";
import { authMiddleware } from "../../middleware/auth.ts";
import type { Env, Variables } from "../../types.ts";

export const schedulerRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- 認証必須パスのミドルウェア設定 ----
schedulerRoutes.use("/oauth/google/start", authMiddleware);
schedulerRoutes.use("/oauth/google/disconnect", authMiddleware);
schedulerRoutes.use("/oauth/google/status", authMiddleware);
schedulerRoutes.use("/oauth/zoom/start", authMiddleware);
schedulerRoutes.use("/oauth/zoom/disconnect", authMiddleware);
schedulerRoutes.use("/oauth/zoom/status", authMiddleware);
schedulerRoutes.use("/me/*", authMiddleware);
schedulerRoutes.use("/bookings/*", authMiddleware);

// ---- ルートのマウント ----
schedulerRoutes.route("/oauth/google", oauthGoogleRoutes);  // callback は認証なし
schedulerRoutes.route("/oauth/zoom", oauthZoomRoutes);       // callback は認証なし
schedulerRoutes.route("/public", publicBookingRoutes);       // 認証なし
schedulerRoutes.route("/me", schedulerSettingsRoutes);       // 認証必須
schedulerRoutes.route("/bookings", schedulerBookingsRoutes); // 認証必須
