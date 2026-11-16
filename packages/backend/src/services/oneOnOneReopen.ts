// =============================================================
// 1to1の「日時を選び直す」共通処理
// 候補日から選び間違えた・公開予約URLで違う日時を選んでしまった、というときに、
// いったん確定済みの日時と会議URL（Zoom / Googleカレンダー）を取り消して、
// 「日時がまだ決まっていない状態」に戻す。戻したあとは、これまでと同じ画面で
// 候補日から選び直す（または予約ページで選び直す）ことができる。
// メンバー向けAPI（PATCH /api/oneonone/:id/reopen-schedule）と、
// メールの回答ページ向けAPI（POST /api/oneonone/public/:token/reopen-schedule）から使う。
// =============================================================
import { and, eq, sql } from "drizzle-orm";
import { schema } from "../db/index.ts";
import type { Db } from "../db/index.ts";
import { newId } from "./auth.ts";
import { cancelAutoConference } from "./conferenceService.ts";
import type { Env } from "../types.ts";

type SessionRow = typeof schema.oneOnOneSessions.$inferSelect;

export type ReopenResult =
  | { ok: true }
  | { ok: false; status: 400 | 409; code: string; message: string };

export async function reopenOneOnOneSchedule(
  db: Db,
  env: Env,
  session: SessionRow,
  actorId: string
): Promise<ReopenResult> {
  if (session.status !== "pending" && session.status !== "accepted") {
    return { ok: false, status: 400, code: "invalid_status", message: "この1to1は日時を選び直せない状態です" };
  }
  // どちらかがすでに「完了」を記録している場合は、実施済みなので選び直せない
  if (session.requesterCompletedAt || session.responderCompletedAt) {
    return { ok: false, status: 400, code: "already_completed", message: "すでに1to1の完了が記録されているため、日時は選び直せません" };
  }

  const booking = await db
    .select()
    .from(schema.bookings)
    .where(and(eq(schema.bookings.oneOnOneSessionId, session.id), eq(schema.bookings.status, "confirmed")))
    .get();

  if (!session.scheduledFor && !session.selectedCandidateSlotId && !booking) {
    return { ok: false, status: 400, code: "not_scheduled", message: "日時はまだ決まっていません" };
  }

  // 候補日から選び直す方式では、まだ先の候補が1つも残っていないと、選び直す先がない。
  // 取り消してしまうと身動きが取れなくなるため、その場合は取り消さずに案内する
  if (session.arrangementMethod === "candidates") {
    const now = Math.floor(Date.now() / 1000);
    const latest = await db
      .select({ lastStartsAt: sql<number | null>`MAX(${schema.oneOnOneCandidateSlots.startsAt})` })
      .from(schema.oneOnOneCandidateSlots)
      .where(eq(schema.oneOnOneCandidateSlots.oneOnOneSessionId, session.id))
      .get();
    if (!latest?.lastStartsAt || latest.lastStartsAt <= now) {
      return {
        ok: false, status: 400, code: "no_future_candidates",
        message: "提示された候補日がすべて過ぎているため、選び直せません。「日時・会議URLを編集」から日時を直接変更してください。",
      };
    }
  }

  // 確定済みの予約と、自動発行済みの会議（Googleカレンダー予定 / Zoomミーティング）を取り消す。
  // 選び直すだけなので、キャンセルのお知らせメールは送らない（日時が変わったことは画面で分かる）
  if (booking) {
    const nowIso = new Date().toISOString();
    await db.update(schema.bookings)
      .set({ status: "cancelled", cancellationReason: "日時を選び直すため", updatedAt: nowIso })
      .where(eq(schema.bookings.id, booking.id));
    await cancelAutoConference(
      db, env, booking.hostMemberId,
      booking.conferenceType, booking.conferenceMetaJson, booking.hostCalendarEventId
    );
    await db.insert(schema.bookingEvents).values({
      id: newId(),
      bookingId: booking.id,
      eventType: "cancelled",
      actorKind: "member",
      actorId,
      payloadJson: JSON.stringify({ reason: "reselect_schedule" }),
      occurredAt: nowIso,
    });
  }

  await db.update(schema.oneOnOneSessions)
    .set({
      scheduledFor: null,
      selectedCandidateSlotId: null,
      selectedComment: null,
      manualConferenceUrl: null,
      conferenceUrlStatus: null,
    })
    .where(eq(schema.oneOnOneSessions.id, session.id));

  return { ok: true };
}
