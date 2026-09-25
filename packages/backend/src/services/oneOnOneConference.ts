// =============================================================
// メンバー間1to1（oneOnOneSessions）で、候補日から日時が確定した瞬間に
// 会議URLを発行して bookings を作成する共通処理。
// 「候補日を選んで提示する」方式は、日時確定＝相手（responder）の操作によって決まるため、
// 従来の PATCH /:id/schedule（申込者が後から手動で入力する想定）とは別に、
// select-candidate の直後にその場で会議URLまで発行できるようにするための切り出し。
// =============================================================
import { schema } from "../db/index.ts";
import { createConference } from "./conferenceService.ts";
import { generateRawToken, newId } from "./auth.ts";
import type { Db } from "../db/index.ts";
import type { Env } from "../types.ts";

export async function createConferenceForOneOnOneSession(opts: {
  db: Db;
  env: Env;
  sessionId: string;
  requesterId: string;
  requesterName: string;
  requesterEmail: string;
  responderId: string;
  responderName: string;
  responderEmail: string;
  conferenceType: "zoom" | "google_meet";
  startAtUtc: string;
  endAtUtc: string;
}): Promise<{ conferenceUrl: string | null; conferenceType: "google_meet" | "zoom" | "manual"; conferenceUrlStatus: "unresolved" | null }> {
  const bookingId = newId();
  const conferenceResult = await createConference({
    db: opts.db,
    tokenKey: opts.env.SCHEDULER_TOKEN_KEY,
    hostMemberId: opts.requesterId,
    bookingId,
    requestedType: opts.conferenceType,
    summary: `${opts.requesterName}さんと${opts.responderName}さんの1to1`,
    description: "",
    startAtUtc: opts.startAtUtc,
    endAtUtc: opts.endAtUtc,
    hostEmail: opts.requesterEmail,
    guestEmail: opts.responderEmail,
    clientId: opts.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: opts.env.GOOGLE_OAUTH_CLIENT_SECRET,
    zoomClientId: opts.env.ZOOM_CLIENT_ID,
    zoomClientSecret: opts.env.ZOOM_CLIENT_SECRET,
  });
  const conferenceUrlStatus = conferenceResult.urlStatus === "unresolved" ? "unresolved" : null;

  await opts.db.insert(schema.bookings).values({
    id: bookingId,
    hostMemberId: opts.requesterId,
    guestMemberId: opts.responderId,
    guestName: opts.responderName,
    guestEmail: opts.responderEmail,
    guestMessage: null,
    startAtUtc: opts.startAtUtc,
    endAtUtc: opts.endAtUtc,
    timezone: "Asia/Tokyo",
    status: "confirmed",
    cancellationReason: null,
    cancellationToken: generateRawToken(),
    rescheduleToken: generateRawToken(),
    hostCalendarEventId: conferenceResult.calendarEventId,
    conferenceType: conferenceResult.conferenceType,
    conferenceUrl: conferenceResult.conferenceUrl,
    conferenceMetaJson: conferenceResult.conferenceMetaJson,
    conferenceUrlStatus,
    oneOnOneSessionId: opts.sessionId,
    source: "prearranged",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return { conferenceUrl: conferenceResult.conferenceUrl, conferenceType: conferenceResult.conferenceType, conferenceUrlStatus };
}
