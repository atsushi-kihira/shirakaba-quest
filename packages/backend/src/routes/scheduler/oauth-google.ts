// Google OAuth 2.0 連携ルート
// GET  /api/scheduler/oauth/google/start       → OAuth URL を返す（フロントがリダイレクト）
// GET  /api/scheduler/oauth/google/callback    → コールバック（認証不要）
// POST /api/scheduler/oauth/google/disconnect  → 連携解除
// GET  /api/scheduler/oauth/google/status      → 連携状態

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { encryptToken, decryptToken } from "../../services/tokenCrypto.ts";
import { refreshGoogleToken, fetchGoogleUserInfo } from "../../services/googleClient.ts";
import { getFrontendUrl } from "../../services/frontendUrl.ts";
import type { Env, Variables } from "../../types.ts";

export const oauthGoogleRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

// KV の state キーのプレフィックス
const STATE_PREFIX = "oauth_state:";

/** OAuth 開始 — Bearer 認証が必要 */
oauthGoogleRoutes.get("/start", async (c) => {
  const memberId = c.get("userId");
  if (!memberId) return c.json({ error: { code: "unauthorized", message: "ログインが必要です" } }, 401);

  // 32 バイトのランダム state を生成
  const stateBytes = crypto.getRandomValues(new Uint8Array(32));
  const state = btoa(String.fromCharCode(...stateBytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  // state → memberId を KV に 10 分 TTL で保存
  await c.env.KV.put(
    `${STATE_PREFIX}${state}`,
    JSON.stringify({ memberId }),
    { expirationTtl: 600 }
  );

  const redirectUri = `${new URL(c.req.url).origin}/api/scheduler/oauth/google/callback`;
  const frontendUrl = getFrontendUrl(c.env);

  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return c.json({
    data: {
      authUrl: `${GOOGLE_AUTH_URL}?${params.toString()}`,
      redirectUri,
    },
  });
});

/** OAuth コールバック — 認証不要（index.ts で authMiddleware の前に登録） */
oauthGoogleRoutes.get("/callback", async (c) => {
  const { code, state, error } = c.req.query();
  const frontendUrl = getFrontendUrl(c.env);
  const redirectBase = `${frontendUrl}/scheduler/integrations`;

  if (error || !code || !state) {
    return c.redirect(`${redirectBase}?google_error=${encodeURIComponent(error ?? "unknown")}`);
  }

  // state 検証
  const stateData = await c.env.KV.get(`${STATE_PREFIX}${state}`);
  if (!stateData) {
    return c.redirect(`${redirectBase}?google_error=state_mismatch`);
  }
  const { memberId } = JSON.parse(stateData) as { memberId: string };
  await c.env.KV.delete(`${STATE_PREFIX}${state}`);

  // code → tokens 交換
  const redirectUri = `${new URL(c.req.url).origin}/api/scheduler/oauth/google/callback`;
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: c.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error("Google token exchange failed:", body);
    return c.redirect(`${redirectBase}?google_error=token_exchange_failed`);
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  if (!tokens.refresh_token) {
    return c.redirect(`${redirectBase}?google_error=no_refresh_token`);
  }

  // ユーザー情報取得
  let userEmail = "";
  try {
    const userInfo = await fetchGoogleUserInfo(tokens.access_token);
    userEmail = userInfo.email;
  } catch {
    return c.redirect(`${redirectBase}?google_error=userinfo_failed`);
  }

  const tokenKey = c.env.SCHEDULER_TOKEN_KEY;
  const accessTokenEnc = await encryptToken(tokens.access_token, tokenKey);
  const refreshTokenEnc = await encryptToken(tokens.refresh_token, tokenKey);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const now = new Date().toISOString();

  const db = createDb(c.env.DB);

  // primary_calendar_id はデフォルト "primary" (Google のプライマリカレンダー)
  await db
    .insert(schema.googleCredentials)
    .values({
      memberId,
      googleAccountEmail: userEmail,
      primaryCalendarId: "primary",
      accessTokenEnc,
      refreshTokenEnc,
      accessTokenExpiresAt: expiresAt,
      scopes: tokens.scope,
      connectedAt: now,
      lastRefreshedAt: null,
    })
    .onConflictDoUpdate({
      target: schema.googleCredentials.memberId,
      set: {
        googleAccountEmail: userEmail,
        accessTokenEnc,
        refreshTokenEnc,
        accessTokenExpiresAt: expiresAt,
        scopes: tokens.scope,
        connectedAt: now,
        lastRefreshedAt: null,
      },
    });

  return c.redirect(`${redirectBase}?google_connected=1`);
});

/** 連携解除 */
oauthGoogleRoutes.post("/disconnect", async (c) => {
  const memberId = c.get("userId");
  if (!memberId) return c.json({ error: { code: "unauthorized", message: "ログインが必要です" } }, 401);

  const db = createDb(c.env.DB);

  // アクセストークンを revoke（失敗しても続行）
  const cred = await db
    .select({ accessTokenEnc: schema.googleCredentials.accessTokenEnc })
    .from(schema.googleCredentials)
    .where(eq(schema.googleCredentials.memberId, memberId))
    .get();

  if (cred) {
    try {
      const accessToken = await decryptToken(cred.accessTokenEnc, c.env.SCHEDULER_TOKEN_KEY);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, {
        method: "POST",
      });
    } catch {
      // revoke 失敗は無視
    }
    await db
      .delete(schema.googleCredentials)
      .where(eq(schema.googleCredentials.memberId, memberId));
  }

  return c.json({ data: { disconnected: true } });
});

/** 連携状態確認 */
oauthGoogleRoutes.get("/status", async (c) => {
  const memberId = c.get("userId");
  if (!memberId) return c.json({ error: { code: "unauthorized", message: "ログインが必要です" } }, 401);

  const db = createDb(c.env.DB);
  const cred = await db
    .select({
      googleAccountEmail: schema.googleCredentials.googleAccountEmail,
      connectedAt: schema.googleCredentials.connectedAt,
    })
    .from(schema.googleCredentials)
    .where(eq(schema.googleCredentials.memberId, memberId))
    .get();

  return c.json({
    data: {
      connected: !!cred,
      googleAccountEmail: cred?.googleAccountEmail ?? null,
      connectedAt: cred?.connectedAt ?? null,
    },
  });
});
