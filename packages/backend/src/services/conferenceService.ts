// 会議 URL の発行を担うサービス（Google Meet / Zoom 対応）

import { insertCalendarEvent, refreshGoogleToken } from "./googleClient.ts";
import { decryptToken, encryptToken } from "./tokenCrypto.ts";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { eq } from "drizzle-orm";

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

/** Google 認証情報を取得しトークンをリフレッシュ（必要な場合） */
export async function getValidGoogleAccessToken(
  db: Db,
  memberId: string,
  tokenKey: string,
  clientId: string,
  clientSecret: string
): Promise<{ accessToken: string; calendarId: string } | null> {
  const cred = await db
    .select()
    .from(schema.googleCredentials)
    .where(eq(schema.googleCredentials.memberId, memberId))
    .get();
  if (!cred) return null;

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
    } catch {
      // リフレッシュ失敗 → 再連携が必要
      await db.delete(schema.googleCredentials).where(eq(schema.googleCredentials.memberId, memberId));
      return null;
    }
  }

  return { accessToken, calendarId: cred.primaryCalendarId };
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
      await db.delete(schema.zoomCredentials).where(eq(schema.zoomCredentials.memberId, memberId));
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
        if (googleCred) {
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

  if (!googleCred) {
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
