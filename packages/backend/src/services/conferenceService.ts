// 会議 URL の発行を担うサービス（Google Meet / Zoom 対応）

import { insertCalendarEvent, deleteCalendarEvent, refreshGoogleToken, TokenRefreshError } from "./googleClient.ts";
import { decryptToken, encryptToken } from "./tokenCrypto.ts";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { eq } from "drizzle-orm";

export type BusyCalendar = { id: string; summary: string };

/** busyCalendars 列（JSON文字列）をパースする。未設定・壊れている場合はプライマリカレンダーのみにフォールバックする */
export function parseBusyCalendars(raw: string | null, primaryCalendarId: string): BusyCalendar[] {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((x) => x && typeof x.id === "string")) {
        return parsed as BusyCalendar[];
      }
    } catch {
      // フォールバックへ
    }
  }
  return [{ id: primaryCalendarId, summary: "メインカレンダー" }];
}

export type ConferenceResult = {
  conferenceType: "google_meet" | "zoom" | "manual";
  conferenceUrl: string | null;
  conferenceMetaJson: string | null;
  calendarEventId: string | null;
};

export type CreateConferenceArgs = {
  db: Db;
  tokenKey: string;
  hostMemberId: string;
  bookingId: string;
  requestedType: "google_meet" | "zoom" | "manual";
  summary: string;
  description: string;
  startAtUtc: string;
  endAtUtc: string;
  hostEmail: string;
  guestEmail: string;
  clientId: string;
  clientSecret: string;
  zoomClientId?: string;
  zoomClientSecret?: string;
};

// 「未連携」と「連携済みだがトークン取得に一時的に失敗した」を呼び出し元が区別できるようにする。
// 区別せず両方 null 返却にしていたことが、一時的な失敗時に「予定は全部空き」と誤って
// 案内してしまう不具合の原因になっていた。
export type GoogleAccessTokenResult =
  | { status: "not_connected" }
  | { status: "refresh_failed" }
  | { status: "ok"; accessToken: string; calendarId: string; busyCalendars: BusyCalendar[] };

/** Google 認証情報を取得しトークンをリフレッシュ（必要な場合） */
export async function getValidGoogleAccessToken(
  db: Db,
  memberId: string,
  tokenKey: string,
  clientId: string,
  clientSecret: string
): Promise<GoogleAccessTokenResult> {
  const cred = await db
    .select()
    .from(schema.googleCredentials)
    .where(eq(schema.googleCredentials.memberId, memberId))
    .get();
  if (!cred) return { status: "not_connected" };

  let accessToken = await decryptToken(cred.accessTokenEnc, tokenKey);
  const expiresAt = new Date(cred.accessTokenExpiresAt).getTime();

  if (Date.now() >= expiresAt - 60_000) {
    // トークンの有効期限が 1 分以内 → リフレッシュ
    const refreshToken = await decryptToken(cred.refreshTokenEnc, tokenKey);
    try {
      const refreshed = await refreshGoogleToken(refreshToken, clientId, clientSecret);
      accessToken = refreshed.access_token;
      const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
      const newEncrypted = await encryptToken(accessToken, tokenKey);
      await db
        .update(schema.googleCredentials)
        .set({
          accessTokenEnc: newEncrypted,
          accessTokenExpiresAt: newExpiry,
          lastRefreshedAt: new Date().toISOString(),
        })
        .where(eq(schema.googleCredentials.memberId, memberId));
    } catch (err) {
      console.error(`Google token refresh failed for member ${memberId}:`, err);
      // invalid_grant 相当（400/401 = トークン失効・再連携が必要）の場合のみ連携情報を削除する。
      // 5xx・ネットワークエラー等の一時的な失敗まで削除すると、Google側の一時的な不調だけで
      // 連携が丸ごと切れてしまい、ユーザーが気づかないまま予約カレンダーが「全部空き」に
      // なってしまう（実際にこの不具合が発生した）。一時的な失敗は連携情報を残し、次回リクエスト時に
      // 再試行できるようにする。
      if (err instanceof TokenRefreshError && (err.status === 400 || err.status === 401)) {
        await db.delete(schema.googleCredentials).where(eq(schema.googleCredentials.memberId, memberId));
        return { status: "not_connected" };
      }
      return { status: "refresh_failed" };
    }
  }

  return {
    status: "ok",
    accessToken,
    calendarId: cred.primaryCalendarId,
    busyCalendars: parseBusyCalendars(cred.busyCalendars, cred.primaryCalendarId),
  };
}

/** Zoom アクセストークンを取得（必要に応じてリフレッシュ） */
export async function getValidZoomAccessToken(
  db: Db,
  memberId: string,
  tokenKey: string,
  zoomClientId: string,
  zoomClientSecret: string
): Promise<{ accessToken: string; zoomUserId: string } | null> {
  const cred = await db
    .select()
    .from(schema.zoomCredentials)
    .where(eq(schema.zoomCredentials.memberId, memberId))
    .get();
  if (!cred) return null;

  let accessToken = await decryptToken(cred.accessTokenEnc, tokenKey);
  const expiresAt = new Date(cred.accessTokenExpiresAt).getTime();

  if (Date.now() >= expiresAt - 60_000) {
    const refreshToken = await decryptToken(cred.refreshTokenEnc, tokenKey);
    const basic = btoa(`${zoomClientId}:${zoomClientSecret}`);
    const res = await fetch("https://zoom.us/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`Zoom token refresh failed for member ${memberId}: ${res.status} ${body}`);
      // Google側と同様、恒久的な失敗（400/401 = 再連携が必要）の場合のみ連携情報を削除する
      if (res.status === 400 || res.status === 401) {
        await db.delete(schema.zoomCredentials).where(eq(schema.zoomCredentials.memberId, memberId));
      }
      return null;
    }
    const refreshed = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    accessToken = refreshed.access_token;
    const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await db
      .update(schema.zoomCredentials)
      .set({
        accessTokenEnc: await encryptToken(accessToken, tokenKey),
        refreshTokenEnc: await encryptToken(refreshed.refresh_token, tokenKey),
        accessTokenExpiresAt: newExpiry,
        lastRefreshedAt: new Date().toISOString(),
      })
      .where(eq(schema.zoomCredentials.memberId, memberId));
  }

  return { accessToken, zoomUserId: cred.zoomUserId };
}

/** Zoom ミーティングを作成して join URL を返す */
export async function createZoomMeeting(
  accessToken: string,
  topic: string,
  startAtUtc: string,
  durationMinutes: number,
  agenda: string
): Promise<{ joinUrl: string; meetingId: string } | null> {
  const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic,
      type: 2, // scheduled meeting
      start_time: startAtUtc.replace(".000Z", "Z"),
      duration: durationMinutes,
      agenda,
      settings: {
        host_video: true,
        participant_video: true,
        join_before_host: true,
        waiting_room: false,
      },
    }),
  });
  if (!res.ok) {
    console.error("Zoom meeting creation failed:", await res.text());
    return null;
  }
  const data = (await res.json()) as { join_url: string; id: number };
  return { joinUrl: data.join_url, meetingId: String(data.id) };
}

/** 会議 URL を発行して Calendar に予定を登録する */
export async function createConference(args: CreateConferenceArgs): Promise<ConferenceResult> {
  const {
    db, tokenKey, hostMemberId, bookingId,
    requestedType, summary, description,
    startAtUtc, endAtUtc, hostEmail, guestEmail,
    clientId, clientSecret,
    zoomClientId, zoomClientSecret,
  } = args;

  // Zoom ミーティング
  if (requestedType === "zoom" && zoomClientId && zoomClientSecret) {
    const zoomCred = await getValidZoomAccessToken(db, hostMemberId, tokenKey, zoomClientId, zoomClientSecret);
    if (zoomCred) {
      const startMs = new Date(startAtUtc).getTime();
      const endMs = new Date(endAtUtc).getTime();
      const durationMin = Math.round((endMs - startMs) / 60_000);
      const meeting = await createZoomMeeting(
        zoomCred.accessToken,
        summary,
        startAtUtc,
        durationMin,
        description
      );
      if (meeting) {
        // Zoom 成功 → Google カレンダーにも予定追加（連携済みなら）
        let calendarEventId: string | null = null;
        const googleCred = await getValidGoogleAccessToken(db, hostMemberId, tokenKey, clientId, clientSecret);
        if (googleCred.status === "ok") {
          try {
            const calResult = await insertCalendarEvent({
              accessToken: googleCred.accessToken,
              calendarId: googleCred.calendarId,
              summary,
              description: `${description}\n\nZoom 会議: ${meeting.joinUrl}`,
              startAtUtc,
              endAtUtc,
              attendeeEmails: [hostEmail, guestEmail].filter(Boolean),
              requestId: `${bookingId}-zoom`,
              withMeet: false,
            });
            calendarEventId = calResult.eventId;
          } catch {
            // カレンダー追加失敗は非致命的
          }
        }
        return {
          conferenceType: "zoom",
          conferenceUrl: meeting.joinUrl,
          conferenceMetaJson: JSON.stringify({ meetingId: meeting.meetingId }),
          calendarEventId,
        };
      }
    }
    // Zoom 失敗 → manual にフォールバック
    return { conferenceType: "manual", conferenceUrl: null, conferenceMetaJson: null, calendarEventId: null };
  }

  const googleCred = await getValidGoogleAccessToken(db, hostMemberId, tokenKey, clientId, clientSecret);

  if (googleCred.status !== "ok") {
    return { conferenceType: "manual", conferenceUrl: null, conferenceMetaJson: null, calendarEventId: null };
  }

  const withMeet = requestedType === "google_meet";
  const { accessToken, calendarId } = googleCred;

  const result = await insertCalendarEvent({
    accessToken,
    calendarId,
    summary,
    description,
    startAtUtc,
    endAtUtc,
    attendeeEmails: [hostEmail, guestEmail].filter(Boolean),
    requestId: bookingId,
    withMeet,
  });

  if (withMeet && result.meetUrl) {
    return {
      conferenceType: "google_meet",
      conferenceUrl: result.meetUrl,
      conferenceMetaJson: null,
      calendarEventId: result.eventId,
    };
  }

  return {
    conferenceType: "manual",
    conferenceUrl: null,
    conferenceMetaJson: null,
    calendarEventId: result.eventId,
  };
}

/** Zoom ミーティングを削除する */
export async function deleteZoomMeeting(accessToken: string, meetingId: string): Promise<void> {
  const res = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    console.error("Zoom meeting deletion failed:", await res.text());
  }
}

export type AutoConferenceEnv = {
  SCHEDULER_TOKEN_KEY: string;
  ZOOM_CLIENT_ID?: string;
  ZOOM_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
};

export type AutoConferenceResult = {
  conferenceType: "google_meet" | "zoom";
  conferenceUrl: string;
  conferenceMetaJson: string | null;
  calendarEventId: string | null;
};

/** 定例会の各開催回向けに、あらかじめ指定された会議ツールで自動的に会議URLを発行する（失敗時は null） */
export async function autoCreateConferenceForOccurrence(
  db: Db,
  env: AutoConferenceEnv,
  hostMemberId: string,
  type: "google_meet" | "zoom",
  title: string,
  description: string,
  startsAtSec: number,
  endsAtSec: number | null
): Promise<AutoConferenceResult | null> {
  const startAtUtc = new Date(startsAtSec * 1000).toISOString();
  const endAtUtc = new Date((endsAtSec ?? startsAtSec + 3600) * 1000).toISOString();

  try {
    if (type === "zoom") {
      if (!env.ZOOM_CLIENT_ID || !env.ZOOM_CLIENT_SECRET) return null;
      const cred = await getValidZoomAccessToken(db, hostMemberId, env.SCHEDULER_TOKEN_KEY, env.ZOOM_CLIENT_ID, env.ZOOM_CLIENT_SECRET);
      if (!cred) return null;
      const durationMin = Math.max(15, Math.round((new Date(endAtUtc).getTime() - new Date(startAtUtc).getTime()) / 60_000));
      const meeting = await createZoomMeeting(cred.accessToken, title, startAtUtc, durationMin, description);
      if (!meeting) return null;
      return {
        conferenceType: "zoom",
        conferenceUrl: meeting.joinUrl,
        conferenceMetaJson: JSON.stringify({ meetingId: meeting.meetingId }),
        calendarEventId: null,
      };
    }

    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) return null;
    const cred = await getValidGoogleAccessToken(db, hostMemberId, env.SCHEDULER_TOKEN_KEY, env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET);
    if (cred.status !== "ok") return null;
    const host = await db.select({ email: schema.members.email }).from(schema.members).where(eq(schema.members.id, hostMemberId)).get();
    const result = await insertCalendarEvent({
      accessToken: cred.accessToken,
      calendarId: cred.calendarId,
      summary: title,
      description,
      startAtUtc,
      endAtUtc,
      attendeeEmails: host?.email ? [host.email] : [],
      requestId: `series-${hostMemberId}-${startsAtSec}`,
      withMeet: true,
    });
    if (!result.meetUrl) return null;
    return {
      conferenceType: "google_meet",
      conferenceUrl: result.meetUrl,
      conferenceMetaJson: null,
      calendarEventId: result.eventId,
    };
  } catch (e) {
    console.error("autoCreateConferenceForOccurrence failed:", e);
    return null;
  }
}

/** 自動発行された会議URLをキャンセルする（個別回の日程変更・キャンセル時。失敗しても致命的ではない） */
export async function cancelAutoConference(
  db: Db,
  env: AutoConferenceEnv,
  hostMemberId: string,
  conferenceType: string | null,
  conferenceMetaJson: string | null,
  calendarEventId: string | null
): Promise<void> {
  try {
    if (conferenceType === "zoom" && env.ZOOM_CLIENT_ID && env.ZOOM_CLIENT_SECRET) {
      const meta = conferenceMetaJson ? (JSON.parse(conferenceMetaJson) as { meetingId?: string }) : null;
      if (meta?.meetingId) {
        const cred = await getValidZoomAccessToken(db, hostMemberId, env.SCHEDULER_TOKEN_KEY, env.ZOOM_CLIENT_ID, env.ZOOM_CLIENT_SECRET);
        if (cred) await deleteZoomMeeting(cred.accessToken, meta.meetingId);
      }
    } else if (conferenceType === "google_meet" && calendarEventId && env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET) {
      const cred = await getValidGoogleAccessToken(db, hostMemberId, env.SCHEDULER_TOKEN_KEY, env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET);
      if (cred.status === "ok") await deleteCalendarEvent(cred.accessToken, cred.calendarId, calendarEventId);
    }
  } catch (e) {
    console.error("cancelAutoConference failed:", e);
  }
}

/** ホストの利用可能な会議ツール一覧を返す（スロット API レスポンス用） */
export async function getAvailableConferenceTypes(
  db: Db,
  hostMemberId: string
): Promise<("google_meet" | "zoom")[]> {
  const [googleCred, zoomCred] = await Promise.all([
    db
      .select({ memberId: schema.googleCredentials.memberId })
      .from(schema.googleCredentials)
      .where(eq(schema.googleCredentials.memberId, hostMemberId))
      .get(),
    db
      .select({ memberId: schema.zoomCredentials.memberId })
      .from(schema.zoomCredentials)
      .where(eq(schema.zoomCredentials.memberId, hostMemberId))
      .get(),
  ]);

  const types: ("google_meet" | "zoom")[] = [];
  if (googleCred) types.push("google_meet");
  if (zoomCred) types.push("zoom");
  return types;
}
