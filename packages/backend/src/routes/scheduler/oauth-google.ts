// Google OAuth 2.0 連携ルート
// GET  /api/scheduler/oauth/google/start       → OAuth URL を返す（フロントがリダイレクト）
// GET  /api/scheduler/oauth/google/callback    → コールバック（認証不要）
// POST /api/scheduler/oauth/google/disconnect  → 連携解除
// GET  /api/scheduler/oauth/google/status      → 連携状態

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { encryptToken, decryptToken } from "../../services/tokenCrypto.ts";
import { refreshGoogleToken, fetchGoogleUserInfo, fetchCalendarList } from "../../services/googleClient.ts";
import { getValidGoogleAccessToken, parseBusyCalendars, type BusyCalendar } from "../../services/conferenceService.ts";
import { getFrontendUrl } from "../../services/frontendUrl.ts";
import { resolveEffectiveMemberId } from "../../services/resolve-member.ts";
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
  const userId = c.get("userId");
  const userType = c.get("userType");
  if (!userId) return c.json({ error: { code: "unauthorized", message: "ログインが必要です" } }, 401);

  const db0 = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db0, userId, userType);
  if (!memberId) {
    return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないため連携できません" } }, 403);
  }

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
  // フォールバック用に早期取得（getFrontendUrl が失敗しても後続で使えるよう）
  let redirectBase = "http://localhost:5173/scheduler/integrations";
  try {
    const frontendUrl = getFrontendUrl(c.env);
    redirectBase = `${frontendUrl}/scheduler/integrations`;
  } catch (e) {
    console.error("getFrontendUrl failed:", e);
  }

  const { code, state, error } = c.req.query();

  if (error || !code || !state) {
    return c.redirect(`${redirectBase}?google_error=${encodeURIComponent(error ?? "unknown")}`);
  }

  // state 検証
  let memberId: string;
  try {
    const stateData = await c.env.KV.get(`${STATE_PREFIX}${state}`);
    if (!stateData) {
      return c.redirect(`${redirectBase}?google_error=state_mismatch`);
    }
    const parsed = JSON.parse(stateData) as { memberId: string };
    memberId = parsed.memberId;
    await c.env.KV.delete(`${STATE_PREFIX}${state}`);
  } catch (e) {
    console.error("KV state read failed:", e);
    return c.redirect(`${redirectBase}?google_error=state_error`);
  }

  // code → tokens 交換
  let tokens: { access_token: string; refresh_token?: string; expires_in: number; scope: string };
  try {
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

    tokens = (await tokenRes.json()) as typeof tokens;
  } catch (e) {
    console.error("Token exchange fetch error:", e);
    return c.redirect(`${redirectBase}?google_error=token_exchange_failed`);
  }

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
  if (!tokenKey) {
    console.error("SCHEDULER_TOKEN_KEY is not set");
    return c.redirect(`${redirectBase}?google_error=server_config_error`);
  }

  let accessTokenEnc: string;
  let refreshTokenEnc: string;
  try {
    accessTokenEnc = await encryptToken(tokens.access_token, tokenKey);
    refreshTokenEnc = await encryptToken(tokens.refresh_token, tokenKey);
  } catch (e) {
    console.error("Token encryption failed:", e);
    return c.redirect(`${redirectBase}?google_error=server_config_error`);
  }

  const expiresInMs = typeof tokens.expires_in === "number" ? tokens.expires_in * 1000 : 3600 * 1000;
  const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
  const now = new Date().toISOString();

  const db = createDb(c.env.DB);

  try {
    // primary_calendar_id はデフォルト "primary" (Google のプライマリカレンダー)。
    // busyCalendars（空き状況判定の対象）も初回連携時はプライマリのみをデフォルトにする。
    // 再連携（onConflictDoUpdate）の場合は、以前に選んだ busyCalendars 設定を保持するため
    // set 側には含めない。
    await db
      .insert(schema.googleCredentials)
      .values({
        memberId,
        googleAccountEmail: userEmail,
        primaryCalendarId: "primary",
        busyCalendars: JSON.stringify([{ id: "primary", summary: "メインカレンダー" }] satisfies BusyCalendar[]),
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
  } catch (e) {
    console.error("DB insert failed:", e);
    return c.redirect(`${redirectBase}?google_error=db_error`);
  }

  return c.redirect(`${redirectBase}?google_connected=1`);
});

/** 連携解除 */
oauthGoogleRoutes.post("/disconnect", async (c) => {
  const userId = c.get("userId");
  const userType = c.get("userType");
  if (!userId) return c.json({ error: { code: "unauthorized", message: "ログインが必要です" } }, 401);

  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, userId, userType);
  if (!memberId) return c.json({ data: { disconnected: true } });

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
  const userId = c.get("userId");
  const userType = c.get("userType");
  if (!userId) return c.json({ error: { code: "unauthorized", message: "ログインが必要です" } }, 401);

  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, userId, userType);
  if (!memberId) {
    return c.json({ data: { connected: false, googleAccountEmail: null, connectedAt: null } });
  }
  const cred = await db
    .select({
      googleAccountEmail: schema.googleCredentials.googleAccountEmail,
      connectedAt: schema.googleCredentials.connectedAt,
      primaryCalendarId: schema.googleCredentials.primaryCalendarId,
      busyCalendars: schema.googleCredentials.busyCalendars,
    })
    .from(schema.googleCredentials)
    .where(eq(schema.googleCredentials.memberId, memberId))
    .get();

  return c.json({
    data: {
      connected: !!cred,
      googleAccountEmail: cred?.googleAccountEmail ?? null,
      connectedAt: cred?.connectedAt ?? null,
      busyCalendars: cred ? parseBusyCalendars(cred.busyCalendars, cred.primaryCalendarId) : [],
    },
  });
});

/** 空き状況判定に使えるカレンダー一覧（Googleから取得）と、現在の選択状態を返す */
oauthGoogleRoutes.get("/calendars", async (c) => {
  const userId = c.get("userId");
  const userType = c.get("userType");
  if (!userId) return c.json({ error: { code: "unauthorized", message: "ログインが必要です" } }, 401);

  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, userId, userType);
  if (!memberId) {
    return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないため連携できません" } }, 403);
  }

  const googleCred = await getValidGoogleAccessToken(
    db, memberId,
    c.env.SCHEDULER_TOKEN_KEY,
    c.env.GOOGLE_OAUTH_CLIENT_ID,
    c.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
  if (googleCred.status === "not_connected") {
    return c.json({ error: { code: "not_connected", message: "Googleと連携されていません" } }, 400);
  }
  if (googleCred.status === "refresh_failed") {
    return c.json({ error: { code: "calendar_unavailable", message: "Googleとの連携情報を一時的に取得できませんでした。少し時間をおいてから、もう一度お試しください。" } }, 503);
  }

  try {
    const calendars = await fetchCalendarList(googleCred.accessToken);
    // 連携直後のデフォルト値は freeBusy 専用のエイリアス "primary" を使っているが、
    // calendarList が返す実際のプライマリカレンダーIDは（本人のメールアドレス等）別の文字列になるため、
    // チェックボックスの初期選択状態を正しく一致させるためにここで正規化する。
    const primaryEntry = calendars.find((cal) => cal.primary);
    const selectedIds = googleCred.busyCalendars.map((cal) =>
      cal.id === "primary" && primaryEntry ? primaryEntry.id : cal.id
    );
    return c.json({ data: { calendars, selectedIds } });
  } catch (e) {
    console.error("fetchCalendarList failed:", e);
    return c.json({ error: { code: "calendar_list_failed", message: "カレンダー一覧の取得に失敗しました。時間をおいて再度お試しください。" } }, 502);
  }
});

/** 空き状況判定に使うカレンダーを選択・保存する（複数選択可） */
oauthGoogleRoutes.patch("/calendars", async (c) => {
  const userId = c.get("userId");
  const userType = c.get("userType");
  if (!userId) return c.json({ error: { code: "unauthorized", message: "ログインが必要です" } }, 401);

  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, userId, userType);
  if (!memberId) {
    return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないため連携できません" } }, 403);
  }

  const body = await c.req.json<{ calendars?: BusyCalendar[] }>().catch(() => ({ calendars: undefined }));
  const calendars = (body.calendars ?? []).filter(
    (cal): cal is BusyCalendar => !!cal && typeof cal.id === "string" && cal.id.trim().length > 0
  );
  if (calendars.length === 0) {
    return c.json({ error: { code: "invalid_input", message: "少なくとも1つのカレンダーを選択してください" } }, 400);
  }

  const existing = await db
    .select({ memberId: schema.googleCredentials.memberId })
    .from(schema.googleCredentials)
    .where(eq(schema.googleCredentials.memberId, memberId))
    .get();
  if (!existing) {
    return c.json({ error: { code: "not_connected", message: "Googleと連携されていません" } }, 400);
  }

  await db
    .update(schema.googleCredentials)
    .set({ busyCalendars: JSON.stringify(calendars) })
    .where(eq(schema.googleCredentials.memberId, memberId));

  return c.json({ data: { busyCalendars: calendars } });
});
