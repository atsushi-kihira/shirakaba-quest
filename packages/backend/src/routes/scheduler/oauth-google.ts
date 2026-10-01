// Google OAuth 2.0 連携ルート（1メンバーが複数のGoogleアカウントを連携できる）
// GET  /api/scheduler/oauth/google/start                           → OAuth URL を返す（フロントがリダイレクト）
// GET  /api/scheduler/oauth/google/callback                        → コールバック（認証不要）
// GET  /api/scheduler/oauth/google/status                          → 連携状態（連携済みアカウント一覧）
// POST /api/scheduler/oauth/google/accounts/:accountId/disconnect  → 指定アカウントの連携解除
// PATCH /api/scheduler/oauth/google/accounts/:accountId/default    → 自動処理に使うデフォルトアカウントを切替
// GET  /api/scheduler/oauth/google/accounts/:accountId/calendars   → 指定アカウントのカレンダー一覧・現在の選択状態
// PATCH /api/scheduler/oauth/google/accounts/:accountId/calendars  → 書き込み先・空き状況判定対象カレンダーを保存

import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { encryptToken, decryptToken } from "../../services/tokenCrypto.ts";
import { refreshGoogleToken, fetchGoogleUserInfo, fetchCalendarList } from "../../services/googleClient.ts";
import { getValidGoogleAccessTokenForAccount, parseBusyCalendars, type BusyCalendar } from "../../services/conferenceService.ts";
import { getFrontendUrl } from "../../services/frontendUrl.ts";
import { resolveEffectiveMemberId } from "../../services/resolve-member.ts";
import { newId } from "../../services/auth.ts";
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

  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    // select_account: 既にブラウザでログイン中のGoogleアカウントへ暗黙に連携されてしまわないよう、
    // 2つ目以降のアカウントを追加する際も必ずアカウント選択画面を経由させる。
    prompt: "select_account consent",
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
    // 同じメンバー・同じGoogleアカウントの再連携（トークン失効後の再認可等）は、
    // 新しい行を増やさず既存行のトークンだけを更新する（メールアドレスで同一アカウントと判定）。
    const existing = await db
      .select({ id: schema.googleCalendarAccounts.id })
      .from(schema.googleCalendarAccounts)
      .where(and(
        eq(schema.googleCalendarAccounts.memberId, memberId),
        eq(schema.googleCalendarAccounts.googleAccountEmail, userEmail)
      ))
      .get();

    if (existing) {
      await db
        .update(schema.googleCalendarAccounts)
        .set({
          accessTokenEnc,
          refreshTokenEnc,
          accessTokenExpiresAt: expiresAt,
          scopes: tokens.scope,
          connectedAt: now,
          lastRefreshedAt: null,
        })
        .where(eq(schema.googleCalendarAccounts.id, existing.id));
    } else {
      // このメンバーにとって初めてのGoogleアカウントの場合のみ、自動的にデフォルトにする
      const otherAccount = await db
        .select({ id: schema.googleCalendarAccounts.id })
        .from(schema.googleCalendarAccounts)
        .where(eq(schema.googleCalendarAccounts.memberId, memberId))
        .get();
      await db.insert(schema.googleCalendarAccounts).values({
        id: newId(),
        memberId,
        googleAccountEmail: userEmail,
        isDefault: otherAccount ? 0 : 1,
        primaryCalendarId: "primary",
        busyCalendars: JSON.stringify([{ id: "primary", summary: "メインカレンダー" }] satisfies BusyCalendar[]),
        accessTokenEnc,
        refreshTokenEnc,
        accessTokenExpiresAt: expiresAt,
        scopes: tokens.scope,
        connectedAt: now,
        lastRefreshedAt: null,
      });
    }
  } catch (e) {
    console.error("DB insert failed:", e);
    return c.redirect(`${redirectBase}?google_error=db_error`);
  }

  return c.redirect(`${redirectBase}?google_connected=1`);
});

/** 連携状態確認（連携済みアカウントの一覧を返す） */
oauthGoogleRoutes.get("/status", async (c) => {
  const userId = c.get("userId");
  const userType = c.get("userType");
  if (!userId) return c.json({ error: { code: "unauthorized", message: "ログインが必要です" } }, 401);

  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, userId, userType);
  if (!memberId) {
    // connected/googleAccountEmail/connectedAt/busyCalendars は後方互換のため残している旧形式のフィールド
    // （「Googleと連携済みか（＝デフォルトアカウントがあるか）」だけを見たい既存の呼び出し元向け）。
    return c.json({ data: { accounts: [], connected: false, googleAccountEmail: null, connectedAt: null, busyCalendars: [] } });
  }
  const rows = await db
    .select({
      id: schema.googleCalendarAccounts.id,
      googleAccountEmail: schema.googleCalendarAccounts.googleAccountEmail,
      connectedAt: schema.googleCalendarAccounts.connectedAt,
      isDefault: schema.googleCalendarAccounts.isDefault,
      primaryCalendarId: schema.googleCalendarAccounts.primaryCalendarId,
      busyCalendars: schema.googleCalendarAccounts.busyCalendars,
    })
    .from(schema.googleCalendarAccounts)
    .where(eq(schema.googleCalendarAccounts.memberId, memberId))
    .all();

  // 連携日時が新しい順（直近追加したアカウントほど上に表示する）
  rows.sort((a, b) => b.connectedAt.localeCompare(a.connectedAt));
  const defaultAccount = rows.find((r) => r.isDefault) ?? null;

  return c.json({
    data: {
      accounts: rows.map((r) => ({
        id: r.id,
        googleAccountEmail: r.googleAccountEmail,
        connectedAt: r.connectedAt,
        isDefault: !!r.isDefault,
        busyCalendars: parseBusyCalendars(r.busyCalendars, r.primaryCalendarId),
      })),
      // 後方互換フィールド（デフォルトアカウントの情報。以前の「1メンバー1アカウント」時代のAPI形状）。
      // 自動化の可否だけを見たい画面はこちらを参照し続けられる。
      connected: !!defaultAccount,
      googleAccountEmail: defaultAccount?.googleAccountEmail ?? null,
      connectedAt: defaultAccount?.connectedAt ?? null,
      busyCalendars: defaultAccount ? parseBusyCalendars(defaultAccount.busyCalendars, defaultAccount.primaryCalendarId) : [],
    },
  });
});

/** 指定アカウントの連携解除 */
oauthGoogleRoutes.post("/accounts/:accountId/disconnect", async (c) => {
  const userId = c.get("userId");
  const userType = c.get("userType");
  if (!userId) return c.json({ error: { code: "unauthorized", message: "ログインが必要です" } }, 401);

  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, userId, userType);
  if (!memberId) return c.json({ data: { disconnected: true } });

  const accountId = c.req.param("accountId");
  const cred = await db
    .select()
    .from(schema.googleCalendarAccounts)
    .where(and(eq(schema.googleCalendarAccounts.id, accountId), eq(schema.googleCalendarAccounts.memberId, memberId)))
    .get();
  if (!cred) return c.json({ data: { disconnected: true } });

  // アクセストークンを revoke（失敗しても続行）
  try {
    const accessToken = await decryptToken(cred.accessTokenEnc, c.env.SCHEDULER_TOKEN_KEY);
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, {
      method: "POST",
    });
  } catch {
    // revoke 失敗は無視
  }

  await db.delete(schema.googleCalendarAccounts).where(eq(schema.googleCalendarAccounts.id, accountId));

  // デフォルトアカウントを解除した場合、他に連携中のアカウントが残っていれば
  // いずれか1件（最も古くから連携しているもの）を新しいデフォルトに昇格させる
  // （自動処理が「デフォルトが存在しない」状態で黙って動かなくなるのを防ぐ）。
  if (cred.isDefault) {
    const remaining = await db
      .select({ id: schema.googleCalendarAccounts.id, connectedAt: schema.googleCalendarAccounts.connectedAt })
      .from(schema.googleCalendarAccounts)
      .where(eq(schema.googleCalendarAccounts.memberId, memberId))
      .all();
    if (remaining.length > 0) {
      const promoted = remaining.reduce((a, b) => (a.connectedAt < b.connectedAt ? a : b));
      await db.update(schema.googleCalendarAccounts).set({ isDefault: 1 }).where(eq(schema.googleCalendarAccounts.id, promoted.id));
    }
  }

  return c.json({ data: { disconnected: true } });
});

/** 自動処理（会議URL発行・ダブルブッキング防止等）に使うデフォルトアカウントを切り替える */
oauthGoogleRoutes.patch("/accounts/:accountId/default", async (c) => {
  const userId = c.get("userId");
  const userType = c.get("userType");
  if (!userId) return c.json({ error: { code: "unauthorized", message: "ログインが必要です" } }, 401);

  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, userId, userType);
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないため連携できません" } }, 403);

  const accountId = c.req.param("accountId");
  const cred = await db
    .select({ id: schema.googleCalendarAccounts.id })
    .from(schema.googleCalendarAccounts)
    .where(and(eq(schema.googleCalendarAccounts.id, accountId), eq(schema.googleCalendarAccounts.memberId, memberId)))
    .get();
  if (!cred) return c.json({ error: { code: "not_found", message: "指定されたアカウントが見つかりません" } }, 404);

  await db.update(schema.googleCalendarAccounts).set({ isDefault: 0 }).where(eq(schema.googleCalendarAccounts.memberId, memberId));
  await db.update(schema.googleCalendarAccounts).set({ isDefault: 1 }).where(eq(schema.googleCalendarAccounts.id, accountId));

  return c.json({ data: { ok: true } });
});

/** 指定アカウントで選べるカレンダー一覧（Googleから取得）と、現在の選択状態（書き込み先・空き状況判定対象）を返す */
oauthGoogleRoutes.get("/accounts/:accountId/calendars", async (c) => {
  const userId = c.get("userId");
  const userType = c.get("userType");
  if (!userId) return c.json({ error: { code: "unauthorized", message: "ログインが必要です" } }, 401);

  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, userId, userType);
  if (!memberId) {
    return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないため連携できません" } }, 403);
  }

  const accountId = c.req.param("accountId");
  const googleCred = await getValidGoogleAccessTokenForAccount(
    db, accountId, memberId,
    c.env.SCHEDULER_TOKEN_KEY,
    c.env.GOOGLE_OAUTH_CLIENT_ID,
    c.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
  if (googleCred.status === "not_connected") {
    return c.json({ error: { code: "not_connected", message: "指定されたアカウントが見つかりません" } }, 400);
  }
  if (googleCred.status === "refresh_failed") {
    return c.json({ error: { code: "calendar_unavailable", message: "Googleとの連携情報を一時的に取得できませんでした。少し時間をおいてから、もう一度お試しください。" } }, 503);
  }

  try {
    const calendars = await fetchCalendarList(googleCred.accessToken);
    // 連携直後のデフォルト値は freeBusy・書き込み先ともに専用のエイリアス "primary" を使っているが、
    // calendarList が返す実際のプライマリカレンダーIDは（本人のメールアドレス等）別の文字列になるため、
    // 選択状態を正しく一致させるためにここで正規化する。
    const primaryEntry = calendars.find((cal) => cal.primary);
    const normalize = (id: string) => (id === "primary" && primaryEntry ? primaryEntry.id : id);
    const selectedBusyIds = googleCred.busyCalendars.map((cal) => normalize(cal.id));
    const writeCalendarId = normalize(googleCred.calendarId);
    return c.json({ data: { calendars, selectedBusyIds, writeCalendarId } });
  } catch (e) {
    console.error("fetchCalendarList failed:", e);
    return c.json({ error: { code: "calendar_list_failed", message: "カレンダー一覧の取得に失敗しました。時間をおいて再度お試しください。" } }, 502);
  }
});

/** 指定アカウントの「書き込み先カレンダー」「空き状況判定対象カレンダー」を保存する */
oauthGoogleRoutes.patch("/accounts/:accountId/calendars", async (c) => {
  const userId = c.get("userId");
  const userType = c.get("userType");
  if (!userId) return c.json({ error: { code: "unauthorized", message: "ログインが必要です" } }, 401);

  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, userId, userType);
  if (!memberId) {
    return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないため連携できません" } }, 403);
  }

  const accountId = c.req.param("accountId");
  const body = await c.req.json<{ busyCalendars?: BusyCalendar[]; writeCalendarId?: string }>()
    .catch(() => ({ busyCalendars: undefined, writeCalendarId: undefined }));
  const busyCalendars = (body.busyCalendars ?? []).filter(
    (cal): cal is BusyCalendar => !!cal && typeof cal.id === "string" && cal.id.trim().length > 0
  );
  const writeCalendarId = body.writeCalendarId?.trim();
  if (busyCalendars.length === 0) {
    return c.json({ error: { code: "invalid_input", message: "少なくとも1つのカレンダーを選択してください" } }, 400);
  }
  if (!writeCalendarId) {
    return c.json({ error: { code: "invalid_input", message: "予定の書き込み先カレンダーを選択してください" } }, 400);
  }

  const existing = await db
    .select({ id: schema.googleCalendarAccounts.id })
    .from(schema.googleCalendarAccounts)
    .where(and(eq(schema.googleCalendarAccounts.id, accountId), eq(schema.googleCalendarAccounts.memberId, memberId)))
    .get();
  if (!existing) {
    return c.json({ error: { code: "not_connected", message: "指定されたアカウントが見つかりません" } }, 400);
  }

  await db
    .update(schema.googleCalendarAccounts)
    .set({ busyCalendars: JSON.stringify(busyCalendars), primaryCalendarId: writeCalendarId })
    .where(eq(schema.googleCalendarAccounts.id, accountId));

  return c.json({ data: { busyCalendars, writeCalendarId } });
});
