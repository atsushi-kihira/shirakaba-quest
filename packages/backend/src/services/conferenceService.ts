// 会議 URL の発行を担うサービス（Phase 1: Google Meet のみ対応）
// Phase 4 で Zoom を追加予定

import { insertCalendarEvent, refreshGoogleToken } from "./googleClient.ts";
import { decryptToken, encryptToken } from "./tokenCrypto.ts";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { eq } from "drizzle-orm";

export type ConferenceResult = {
  conferenceType: "google_meet" | "manual";
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

/** 会議 URL を発行して Calendar に予定を登録する */
export async function createConference(args: CreateConferenceArgs): Promise<ConferenceResult> {
  const {
    db, tokenKey, hostMemberId, bookingId,
    requestedType, summary, description,
    startAtUtc, endAtUtc, hostEmail, guestEmail,
    clientId, clientSecret,
  } = args;

  const googleCred = await getValidGoogleAccessToken(db, hostMemberId, tokenKey, clientId, clientSecret);

  if (!googleCred) {
    // Google 未連携 → manual（Calendar 登録なし）
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
): Promise<("google_meet")[]> {
  const googleCred = await db
    .select({ memberId: schema.googleCredentials.memberId })
    .from(schema.googleCredentials)
    .where(eq(schema.googleCredentials.memberId, hostMemberId))
    .get();

  const types: ("google_meet")[] = [];
  if (googleCred) types.push("google_meet");
  return types;
}
