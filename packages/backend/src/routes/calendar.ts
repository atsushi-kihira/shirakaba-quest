// =============================================================
// ホーム画面の「ミーティング/イベントカレンダー」用 API（読み取り専用）
//   GET /api/calendar/events?from=<unix秒>&to=<unix秒>
//   GET /api/calendar/search?q=<文字>&past=1   （タイトルなどで予定を探す。past=1 で過去の予定も含める）
// 自分が主催している／招待されている、日程が確定した予定を返す：
//   ・1to1（メンバー同士＝accepted/completed で日時あり、ビジターとの予約＝confirmed の予約）
//   ・通常ミーティング（確定した候補日）
//   ・定例会の開催回（meetings.seriesId あり）
// 辞退・欠席・無回答でも、確定した予定は返す（myStatus で区別する）。
// 他の人の1to1は返さない（自分が当事者のものだけ）。承認前のメンバーには、ミーティング系は返さない。
// =============================================================
import { Hono } from "hono";
import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import { createDb, schema, type Db } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { resolveEffectiveMemberId, isMemberApproved } from "../services/resolve-member.ts";
import { loadTypeStyles, typeStyleOf } from "../services/meeting-event.ts";
import type { Env, Variables } from "../types.ts";
import type { CalendarEvent, CalendarEventMyStatus, CalendarTypeInfo } from "@shared/types";

export const calendarRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
calendarRoutes.use("*", authMiddleware);

/** 1回で取得できる範囲（月表示の前後の週を含めても足りる日数） */
const MAX_RANGE_SECONDS = 62 * 86400;

function toSec(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

/** IN (...) に入れるIDが多いと、データベースの上限（1回の問い合わせに使える値は100個まで）を超えるので、小分けにして問い合わせる */
async function inChunks<T>(ids: string[], run: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 40) out.push(...(await run(ids.slice(i, i + 40))));
  return out;
}

/** 期間内の、自分の予定（1to1・ミーティング・定例会）を集める */
async function buildCalendarEvents(db: Db, memberId: string, from: number, to: number): Promise<CalendarEvent[]> {
  const approved = await isMemberApproved(db, memberId);
  const me = await db.select({ email: schema.members.email }).from(schema.members).where(eq(schema.members.id, memberId)).get();
  const events: CalendarEvent[] = [];

  // ---------------- 1to1 ----------------
  const fromIso = new Date(from * 1000).toISOString();
  const toIso = new Date(to * 1000).toISOString();
  const myBookings = await db
    .select()
    .from(schema.bookings)
    .where(and(
      eq(schema.bookings.status, "confirmed"),
      gte(schema.bookings.startAtUtc, fromIso),
      lte(schema.bookings.startAtUtc, toIso),
      or(
        eq(schema.bookings.hostMemberId, memberId),
        eq(schema.bookings.guestMemberId, memberId),
        ...(me?.email ? [eq(schema.bookings.guestEmail, me.email)] : []),
      ),
    ))
    .all();

  // 期間内に日時がある、自分の1to1（メンバー同士）
  const sessionsByDate = await db
    .select()
    .from(schema.oneOnOneSessions)
    .where(and(
      inArray(schema.oneOnOneSessions.status, ["accepted", "completed"]),
      or(eq(schema.oneOnOneSessions.requesterId, memberId), eq(schema.oneOnOneSessions.responderId, memberId)),
      gte(schema.oneOnOneSessions.scheduledFor, from),
      lte(schema.oneOnOneSessions.scheduledFor, to),
    ))
    .all();

  // 予約から見つかった1to1のセッション（日時が予約側にだけある場合も拾う）
  const sessionIdsFromBookings = [...new Set(myBookings.map((b) => b.oneOnOneSessionId).filter((x): x is string => !!x))];
  const knownSessionIds = new Set(sessionsByDate.map((s) => s.id));
  const extraSessionIds = sessionIdsFromBookings.filter((id) => !knownSessionIds.has(id));
  const extraSessions = await inChunks(extraSessionIds, (part) => db.select().from(schema.oneOnOneSessions)
    .where(and(
      inArray(schema.oneOnOneSessions.id, part),
      inArray(schema.oneOnOneSessions.status, ["accepted", "completed"]),
      or(eq(schema.oneOnOneSessions.requesterId, memberId), eq(schema.oneOnOneSessions.responderId, memberId)),
    )).all());
  const sessions = [...sessionsByDate, ...extraSessions];

  // 日時が予約側で変更されているセッションは、予約の日時を正とする（予約が期間外なら出さない）
  const sessionIdsAll = sessions.map((s) => s.id);
  const linkedBookings = await inChunks(sessionIdsAll, (part) => db.select().from(schema.bookings)
    .where(and(inArray(schema.bookings.oneOnOneSessionId, part), eq(schema.bookings.status, "confirmed"))).all());
  const bookingBySession = new Map(linkedBookings.map((b) => [b.oneOnOneSessionId as string, b]));

  // 名前の解決（相手メンバー・予約の主催者）
  const nameIds = new Set<string>();
  for (const s of sessions) { nameIds.add(s.requesterId); nameIds.add(s.responderId); }
  for (const b of myBookings) nameIds.add(b.hostMemberId);
  const nameRows = await inChunks([...nameIds], (part) =>
    db.select({ id: schema.members.id, name: schema.members.name }).from(schema.members).where(inArray(schema.members.id, part)).all());
  const nameById = new Map(nameRows.map((r) => [r.id, r.name]));

  for (const s of sessions) {
    const booking = bookingBySession.get(s.id);
    const startsAt = booking ? toSec(booking.startAtUtc) : s.scheduledFor;
    if (startsAt == null) continue;
    const endsAt = booking ? toSec(booking.endAtUtc) : startsAt + (s.customDurationMinutes ?? 30) * 60;
    if (startsAt < from || startsAt > to) continue;
    const isRequester = s.requesterId === memberId;
    const partnerId = isRequester ? s.responderId : s.requesterId;
    const partnerName = nameById.get(partnerId) ?? "メンバー";
    events.push({
      key: `oneonone:${s.id}`, kind: "oneonone", id: s.id,
      title: s.customTitle?.trim() || `${partnerName}さんとの1to1`,
      startsAt, endsAt,
      isHost: isRequester,
      myStatus: "attending",
      partnerName,
      isExternalGuest: false,
      linkPath: `/oneonone/${s.id}`,
    });
  }

  // ビジターなどとの予約（1to1のセッションに紐づくものは、上で出しているので重複させない）
  for (const b of myBookings) {
    // メンバー同士の1to1に紐づく予約は、上のセッション側で出している（出ていないものは、確定前・自分が当事者でないものなので出さない）
    if (b.oneOnOneSessionId) continue;
    const isHost = b.hostMemberId === memberId;
    const partnerName = isHost ? b.guestName : (nameById.get(b.hostMemberId) ?? "相手");
    events.push({
      key: `booking:${b.id}`, kind: "oneonone", id: b.id,
      title: `${partnerName}さんとの1to1`,
      startsAt: toSec(b.startAtUtc), endsAt: toSec(b.endAtUtc),
      isHost,
      myStatus: "attending",
      partnerName,
      isExternalGuest: isHost && !b.guestMemberId,
      linkPath: isHost ? `/scheduler/bookings/${b.id}` : `/book/confirmation/${b.cancellationToken}`,
    });
  }

  // ---------------- ミーティング・定例会 ----------------
  if (approved) {
    const rows = await db
      .select({
        m: {
          id: schema.meetings.id, title: schema.meetings.title, hostMemberId: schema.meetings.hostMemberId,
          scope: schema.meetings.scope, teamId: schema.meetings.teamId, collabTeamId: schema.meetings.collabTeamId,
          seriesId: schema.meetings.seriesId, eventTypeDefId: schema.meetings.eventTypeDefId,
        },
        cand: {
          id: schema.meetingDateCandidates.id, startsAt: schema.meetingDateCandidates.startsAt, endsAt: schema.meetingDateCandidates.endsAt,
        },
      })
      .from(schema.meetingDateCandidates)
      .innerJoin(schema.meetings, eq(schema.meetings.id, schema.meetingDateCandidates.meetingId))
      .where(and(
        eq(schema.meetings.status, "confirmed"),
        or(eq(schema.meetingDateCandidates.isConfirmed, 1), eq(schema.meetings.confirmedCandidateId, schema.meetingDateCandidates.id)),
        gte(schema.meetingDateCandidates.startsAt, from),
        lte(schema.meetingDateCandidates.startsAt, to),
      ))
      .all();

    if (rows.length > 0) {
      const meetingIds = [...new Set(rows.map((r) => r.m.id))];
      const calTitleColors = await loadTypeStyles(db, rows.map((r) => r.m.eventTypeDefId));
      const [teamRows, collabRows, inviteRows, declineRows, attendanceRows, responseRows] = await Promise.all([
        db.select({ teamId: schema.teamMembers.teamId }).from(schema.teamMembers).where(eq(schema.teamMembers.memberId, memberId)).all(),
        db.select({ teamId: schema.collabTeamMembers.teamId }).from(schema.collabTeamMembers)
          .where(and(eq(schema.collabTeamMembers.memberId, memberId), eq(schema.collabTeamMembers.status, "active"))).all(),
        inChunks(meetingIds, (part) => db.select({ meetingId: schema.meetingInvitees.meetingId }).from(schema.meetingInvitees)
          .where(and(eq(schema.meetingInvitees.memberId, memberId), inArray(schema.meetingInvitees.meetingId, part))).all()),
        inChunks(meetingIds, (part) => db.select({ meetingId: schema.meetingDeclines.meetingId }).from(schema.meetingDeclines)
          .where(and(eq(schema.meetingDeclines.memberId, memberId), inArray(schema.meetingDeclines.meetingId, part))).all()),
        inChunks(meetingIds, (part) => db.select({ meetingId: schema.meetingAttendances.meetingId, candidateId: schema.meetingAttendances.candidateId, status: schema.meetingAttendances.status })
          .from(schema.meetingAttendances)
          .where(and(eq(schema.meetingAttendances.memberId, memberId), inArray(schema.meetingAttendances.meetingId, part))).all()),
        inChunks(meetingIds, (part) => db.select({ candidateId: schema.meetingResponses.candidateId, availability: schema.meetingResponses.availability })
          .from(schema.meetingResponses)
          .where(and(eq(schema.meetingResponses.memberId, memberId), inArray(schema.meetingResponses.meetingId, part))).all()),
      ]);
      const teamIds = new Set(teamRows.map((r) => r.teamId));
      const collabIds = new Set(collabRows.map((r) => r.teamId));
      const invited = new Set(inviteRows.map((r) => r.meetingId));
      const declined = new Set(declineRows.map((r) => r.meetingId));
      const attByKey = new Map(attendanceRows.map((a) => [`${a.meetingId}|${a.candidateId ?? ""}`, a.status]));
      const answerByCand = new Map(responseRows.map((r) => [r.candidateId, r.availability]));

      for (const { m, cand } of rows) {
        const isHost = m.hostMemberId === memberId;
        const isTarget =
          m.scope === "all" ||
          (m.scope === "team" && !!m.teamId && teamIds.has(m.teamId)) ||
          (m.scope === "collab_team" && !!m.collabTeamId && collabIds.has(m.collabTeamId)) ||
          (m.scope === "selected" && invited.has(m.id));
        if (!isHost && !isTarget && !declined.has(m.id)) continue;

        let myStatus: CalendarEventMyStatus = "none";
        const att = attByKey.get(`${m.id}|${cand.id}`) ?? attByKey.get(`${m.id}|`);
        const answer = answerByCand.get(cand.id);
        if (!isHost && declined.has(m.id)) myStatus = "declined";
        else if (att === "attended") myStatus = "attending";
        else if (att === "absent") myStatus = "absent";
        else if (answer === "yes") myStatus = "attending";
        else if (answer === "no") myStatus = "absent";

        events.push({
          key: `meeting:${m.id}:${cand.id}`,
          kind: m.seriesId ? "series" : "meeting",
          id: m.id,
          title: m.title,
          ...typeStyleOf(calTitleColors, m.eventTypeDefId),
          typeId: m.eventTypeDefId ?? null,
          startsAt: cand.startsAt,
          endsAt: cand.endsAt ?? cand.startsAt + 3600,
          isHost,
          myStatus,
          partnerName: null,
          isExternalGuest: false,
          linkPath: `/meetings/${m.id}`,
        });
      }
    }
  }

  events.sort((a, b) => a.startsAt - b.startsAt || a.title.localeCompare(b.title));
  return events;
}

/** 表示を絞るための、ミーティング連携のイベント種別（セミナー・座談会など）の一覧 */
async function listMeetingTypes(db: Db): Promise<CalendarTypeInfo[]> {
  return db.select({ id: schema.eventTypeDefinitions.id, name: schema.eventTypeDefinitions.name, emoji: schema.eventTypeDefinitions.emoji })
    .from(schema.eventTypeDefinitions)
    .where(and(eq(schema.eventTypeDefinitions.linksToMeeting, 1), eq(schema.eventTypeDefinitions.isActive, 1)))
    .orderBy(schema.eventTypeDefinitions.sortOrder, schema.eventTypeDefinitions.createdAt).all();
}

calendarRoutes.get("/events", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const from = Number(c.req.query("from"));
  const to = Number(c.req.query("to"));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return c.json({ error: { code: "bad_request", message: "表示する期間を指定してください" } }, 400);
  }
  if (to - from > MAX_RANGE_SECONDS) {
    return c.json({ error: { code: "bad_request", message: "表示する期間が長すぎます（最大で約2か月です）" } }, 400);
  }

  const [events, types] = await Promise.all([buildCalendarEvents(db, memberId, from, to), listMeetingTypes(db)]);
  return c.json({ data: { events, types } });
});

/** 検索のための正規化（大文字小文字・全角半角・ひらがなカタカナの違いを無視する） */
function normalizeForSearch(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/** 検索で返す件数の上限 */
const SEARCH_LIMIT = 100;

// GET /api/calendar/search?q=<文字>&past=1  — タイトル・種別名・1to1の相手名などで予定を探す（past=1 で過去の予定も含める）
calendarRoutes.get("/search", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const words = normalizeForSearch((c.req.query("q") ?? "").trim()).split(/\s+/).filter(Boolean).slice(0, 5);
  if (words.length === 0) return c.json({ data: { events: [], truncated: false } });

  const includePast = c.req.query("past") === "1";
  const now = Math.floor(Date.now() / 1000);
  // 過去は3年前まで、先は2年先まで。今日の分は、すでに終わった予定も含めるため、今日の始まり（UTCの前日ぶんの余裕つき）から
  const from = includePast ? now - 3 * 365 * 86400 : now - 86400;
  const to = now + 2 * 365 * 86400;

  const all = await buildCalendarEvents(db, memberId, from, to);
  const typeNameById = new Map((await listMeetingTypes(db)).map((t) => [t.id, t.name]));
  const matched = all.filter((ev) => {
    if (!includePast && ev.endsAt < now) return false;
    const hay = normalizeForSearch([ev.title, ev.partnerName ?? "", ev.typeId ? typeNameById.get(ev.typeId) ?? "" : ""].join(" "));
    return words.every((w) => hay.includes(w));
  });
  // 過去を含めるときは、新しい順（これからの予定は近い順）。含めないときは、近い順
  matched.sort((a, b) => (includePast ? b.startsAt - a.startsAt : a.startsAt - b.startsAt));
  return c.json({ data: { events: matched.slice(0, SEARCH_LIMIT), truncated: matched.length > SEARCH_LIMIT } });
});
