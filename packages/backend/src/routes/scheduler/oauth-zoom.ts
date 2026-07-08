// Zoom OAuth 2.0 連携ルート
// GET  /api/scheduler/oauth/zoom/start       → OAuth URL を返す
// GET  /api/scheduler/oauth/zoom/callback    → コールバック（認証不要）
// POST /api/scheduler/oauth/zoom/disconnect  → 連携解除
// GET  /api/scheduler/oauth/zoom/status      → 連携状態

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { encryptToken, decryptToken } from "../../services/tokenCrypto.ts";
import { getFrontendUrl } from "../../services/frontendUrl.ts";
import type { Env, Variables } from "../../types.ts";

export const oauthZoomRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const ZOOM_AUTH_URL = "https://zoom.us/oauth/authorize";
const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";
const STATE_PREFIX = "zoom_oauth_state:";

function basicAuth(clientId: string, clientSecret: string): string {
  return btoa(`${clientId}:${clientSecret}`);
}

/** OAuth 開始 */
oauthZoomRoutes.get("/start", async (c) => {
  const memberId = c.get("userId");
  if (!memberId) return c.json({ error: { code: "unauthorized", message: "ログインが必要です" } }, 401);

  const stateBytes = crypto.getRandomValues(new Uint8Array(32));
  const state = btoa(String.fromCharCode(...stateBytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  await c.env.KV.put(
    `${STATE_PREFIX}${state}`,
    JSON.stringify({ memberId }),
    { expirationTtl: 600 }
  );

  const redirectUri = `${new URL(c.req.url).origin}/api/scheduler/oauth/zoom/callback`;

  const params = new URLSearchParams({
    client_id: c.env.ZOOM_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });

  return c.json({
    data: {
      authUrl: `${ZOOM_AUTH_URL}?${params.toString()}`,
      redirectUri,
    },
  });
});

/** OAuth コールバック — 認証不要 */
oauthZoomRoutes.get("/callback", async (c) => {
  const { code, state, error } = c.req.query();
  const frontendUrl = getFrontendUrl(c.env);
  const redirectBase = `${frontendUrl}/scheduler/integrations`;

  if (error || !code || !state) {
    return c.redirect(`${redirectBase}?zoom_error=${encodeURIComponent(error ?? "unknown")}`);
  }

  const stateData = await c.env.KV.get(`${STATE_PREFIX}${state}`);
  if (!stateData) {
    return c.redirect(`${redirectBase}?zoom_error=state_mismatch`);
  }
  const { memberId } = JSON.parse(stateData) as { memberId: string };
  await c.env.KV.delete(`${STATE_PREFIX}${state}`);

  const redirectUri = `${new URL(c.req.url).origin}/api/scheduler/oauth/zoom/callback`;

  // code → tokens 交換
  const tokenRes = await fetch(ZOOM_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth(c.env.ZOOM_CLIENT_ID, c.env.ZOOM_CLIENT_SECRET)}`,
    },
    body: new URLSearchParams({
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    console.error("Zoom token exchange failed:", await tokenRes.text());
    return c.redirect(`${redirectBase}?zoom_error=token_exchange_failed`);
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };

  // Zoom ユーザー情報取得
  const userRes = await fetch("https://api.zoom.us/v2/users/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  let zoomEmail = "";
  let zoomUserId = "";
  if (userRes.ok) {
    const userInfo = (await userRes.json()) as { email: string; id: string };
    zoomEmail = userInfo.email;
    zoomUserId = userInfo.id;
  }

  const tokenKey = c.env.SCHEDULER_TOKEN_KEY;
  const accessTokenEnc = await encryptToken(tokens.access_token, tokenKey);
  const refreshTokenEnc = await encryptToken(tokens.refresh_token, tokenKey);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const now = new Date().toISOString();

  const db = createDb(c.env.DB);

  await db
    .insert(schema.zoomCredentials)
    .values({
      memberId,
      zoomAccountEmail: zoomEmail,
      zoomUserId,
      accessTokenEnc,
      refreshTokenEnc,
      accessTokenExpiresAt: expiresAt,
      scopes: tokens.scope,
      connectedAt: now,
      lastRefreshedAt: null,
    })
    .onConflictDoUpdate({
      target: schema.zoomCredentials.memberId,
      set: {
        zoomAccountEmail: zoomEmail,
        zoomUserId,
        accessTokenEnc,
        refreshTokenEnc,
        accessTokenExpiresAt: expiresAt,
        scopes: tokens.scope,
        connectedAt: now,
        lastRefreshedAt: null,
      },
    });

  return c.redirect(`${redirectBase}?zoom_connected=1`);
});

/** 連携解除 */
oauthZoomRoutes.post("/disconnect", async (c) => {
  const memberId = c.get("userId");
  if (!memberId) return c.json({ error: { code: "unauthorized", message: "ログインが必要です" } }, 401);

  const db = createDb(c.env.DB);

  const cred = await db
    .select({ accessTokenEnc: schema.zoomCredentials.accessTokenEnc })
    .from(schema.zoomCredentials)
    .where(eq(schema.zoomCredentials.memberId, memberId))
    .get();

  if (cred) {
    try {
      const accessToken = await decryptToken(cred.accessTokenEnc, c.env.SCHEDULER_TOKEN_KEY);
      // Zoom トークン revoke
      await fetch(
        `https://zoom.us/oauth/revoke?token=${encodeURIComponent(accessToken)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth(c.env.ZOOM_CLIENT_ID, c.env.ZOOM_CLIENT_SECRET)}`,
          },
        }
      );
    } catch {
      // revoke 失敗は無視
    }
    await db
      .delete(schema.zoomCredentials)
      .where(eq(schema.zoomCredentials.memberId, memberId));
  }

  return c.json({ data: { disconnected: true } });
});

/** 連携状態確認 */
oauthZoomRoutes.get("/status", async (c) => {
  const memberId = c.get("userId");
  if (!memberId) return c.json({ error: { code: "unauthorized", message: "ログインが必要です" } }, 401);

  const db = createDb(c.env.DB);
  const cred = await db
    .select({
      zoomAccountEmail: schema.zoomCredentials.zoomAccountEmail,
      connectedAt: schema.zoomCredentials.connectedAt,
    })
    .from(schema.zoomCredentials)
    .where(eq(schema.zoomCredentials.memberId, memberId))
    .get();

  return c.json({
    data: {
      connected: !!cred,
      zoomAccountEmail: cred?.zoomAccountEmail ?? null,
      connectedAt: cred?.connectedAt ?? null,
    },
  });
});
