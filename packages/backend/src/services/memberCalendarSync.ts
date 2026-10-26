// =============================================================
// 招待されたメンバーのGoogleカレンダーへの予定の自動登録
//
// 主催者のカレンダーだけでなく、招待された人（白樺クエストでGoogleカレンダーを連携している人）の
// カレンダーにも、確定した予定を自動で登録する。登録先は、その人が設定した「予定を書き込むカレンダー」。
// Googleの招待メールは使わず、その人自身の連携で直接書き込むため、アプリ登録のメールアドレスと
// Googleアカウントのメールが違っていても登録される。
//
// 仕組み：メンバーごとに「登録されているべき予定」を求め、記録済みの予定との差分を埋める（reconcile）。
//   ・新しく確定した → 登録
//   ・日時・件名・会議URLが変わった → 作り直す
//   ・キャンセル・不参加・辞退・対象から外れた → 削除（まだ始まっていない予定のみ。過去の予定は消さない）
// 何度実行しても同じ結果になるため、変更の直後（push）と、アプリを開いたとき（取りこぼしの補正）の両方から呼ぶ。
// 定例会は、直近の一定件数ずつ登録し、開催が近づくにつれて順に補っていく。
// =============================================================
import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { newId } from "./auth.ts";
import { getFrontendUrl } from "./frontendUrl.ts";
import { deleteCalendarEvent, insertCalendarEvent } from "./googleClient.ts";
import { getValidGoogleAccessToken, getValidGoogleAccessTokenForAccount } from "./conferenceService.ts";
import type { Env } from "../types.ts";

/** 先の予定をどこまで登録するか（日数）と、1回の処理で作る予定の最大数 */
const HORIZON_DAYS = 60;
const MAX_CREATE_PER_RUN = 25;
/** 開始から何秒前までの予定を「これから」として扱うか（開始直後の変更に追従するため） */
const GRACE_SECONDS = 3600;

type Desired = {
  kind: "meeting" | "oneonone";
  refId: string;
  slotId: string;
  title: string;
  description: string;
  startsAt: number;
  endsAt: number;
};

function keyOf(kind: string, refId: string, slotId: string): string {
  return `${kind}|${refId}|${slotId}`;
}

function signatureOf(d: Desired): string {
  return [d.title, d.startsAt, d.endsAt, d.description].join("\u0001");
}

function describe(base: string | null | undefined, conferenceUrl: string | null | undefined, appLink: string, appTitle: string): string {
  const parts: string[] = [];
  if (base?.trim()) parts.push(base.trim());
  if (conferenceUrl) parts.push(`会議URL: ${conferenceUrl}`);
  parts.push(`${appTitle}で詳細を見る: ${appLink}`);
  return parts.join("\n\n");
}

/** このメンバーのカレンダーに、いま登録されているべき予定の一覧 */
export async function buildDesired(db: Db, env: Env, memberId: string, googleEmail: string | null): Promise<Desired[]> {
  const now = Math.floor(Date.now() / 1000);
  const from = now - GRACE_SECONDS;
  const to = now + HORIZON_DAYS * 86400;
  const appUrl = getFrontendUrl(env);
  const design = await db.select({ appTitle: schema.cardDesigns.appTitle }).from(schema.cardDesigns).get();
  const appTitle = design?.appTitle ?? "白樺クエスト";
  const desired: Desired[] = [];

  // ---- ミーティング・定例会の開催回（確定済みの候補日） ----
  const rows = await db
    .select({ m: schema.meetings, cand: schema.meetingDateCandidates })
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
    const [teamRows, collabRows, inviteRows, declineRows, absentRows] = await Promise.all([
      db.select({ teamId: schema.teamMembers.teamId }).from(schema.teamMembers).where(eq(schema.teamMembers.memberId, memberId)).all(),
      db.select({ teamId: schema.collabTeamMembers.teamId }).from(schema.collabTeamMembers)
        .where(and(eq(schema.collabTeamMembers.memberId, memberId), eq(schema.collabTeamMembers.status, "active"))).all(),
      db.select({ meetingId: schema.meetingInvitees.meetingId }).from(schema.meetingInvitees).where(eq(schema.meetingInvitees.memberId, memberId)).all(),
      db.select({ meetingId: schema.meetingDeclines.meetingId }).from(schema.meetingDeclines).where(eq(schema.meetingDeclines.memberId, memberId)).all(),
      db.select({ meetingId: schema.meetingAttendances.meetingId, candidateId: schema.meetingAttendances.candidateId })
        .from(schema.meetingAttendances)
        .where(and(eq(schema.meetingAttendances.memberId, memberId), eq(schema.meetingAttendances.status, "absent"))).all(),
    ]);
    const teamIds = new Set(teamRows.map((r) => r.teamId));
    const collabIds = new Set(collabRows.map((r) => r.teamId));
    const invited = new Set(inviteRows.map((r) => r.meetingId));
    const declined = new Set(declineRows.map((r) => r.meetingId));
    const absent = new Set(absentRows.map((r) => `${r.meetingId}|${r.candidateId ?? ""}`));
    const absentAll = new Set(absentRows.filter((r) => !r.candidateId).map((r) => r.meetingId));

    // 確定した日が複数あるミーティングでは、自分が参加する日（○・△をつけた日、または出席予定で「参加」にした日）だけを登録する。
    // 無回答・×の日は登録しない（自分の予定でない日が、カレンダーの枠をふさがないようにするため）。確定した日が1日だけなら、従来どおり（×の人を除く）
    const meetingIds = [...new Set(rows.map((r) => r.m.id))];
    const [confirmedCounts, myResponses, myAttended] = await Promise.all([
      db.select({ meetingId: schema.meetingDateCandidates.meetingId, id: schema.meetingDateCandidates.id })
        .from(schema.meetingDateCandidates)
        .innerJoin(schema.meetings, eq(schema.meetings.id, schema.meetingDateCandidates.meetingId))
        .where(and(inArray(schema.meetingDateCandidates.meetingId, meetingIds),
          or(eq(schema.meetingDateCandidates.isConfirmed, 1), eq(schema.meetings.confirmedCandidateId, schema.meetingDateCandidates.id)))).all(),
      db.select({ meetingId: schema.meetingResponses.meetingId, candidateId: schema.meetingResponses.candidateId, availability: schema.meetingResponses.availability })
        .from(schema.meetingResponses)
        .where(and(inArray(schema.meetingResponses.meetingId, meetingIds), eq(schema.meetingResponses.memberId, memberId))).all(),
      db.select({ meetingId: schema.meetingAttendances.meetingId, candidateId: schema.meetingAttendances.candidateId })
        .from(schema.meetingAttendances)
        .where(and(inArray(schema.meetingAttendances.meetingId, meetingIds), eq(schema.meetingAttendances.memberId, memberId), eq(schema.meetingAttendances.status, "attended"))).all(),
    ]);
    const confirmedCountByMeeting = new Map<string, number>();
    for (const r of confirmedCounts) confirmedCountByMeeting.set(r.meetingId, (confirmedCountByMeeting.get(r.meetingId) ?? 0) + 1);
    const answerOf = new Map(myResponses.map((r) => [`${r.meetingId}|${r.candidateId}`, r.availability]));
    const attendedKeys = new Set(myAttended.filter((r) => r.candidateId).map((r) => `${r.meetingId}|${r.candidateId}`));

    for (const { m, cand } of rows) {
      if (m.hostMemberId === memberId) continue; // 主催者の予定は、主催者側の処理で登録される
      const isTarget =
        m.scope === "all" ||
        (m.scope === "team" && !!m.teamId && teamIds.has(m.teamId)) ||
        (m.scope === "collab_team" && !!m.collabTeamId && collabIds.has(m.collabTeamId)) ||
        (m.scope === "selected" && invited.has(m.id));
      if (!isTarget || declined.has(m.id) || absentAll.has(m.id) || absent.has(`${m.id}|${cand.id}`)) continue;
      const answer = answerOf.get(`${m.id}|${cand.id}`);
      if (answer === "no" && !attendedKeys.has(`${m.id}|${cand.id}`)) continue;
      if ((confirmedCountByMeeting.get(m.id) ?? 1) > 1) {
        const joining = answer === "yes" || answer === "maybe" || attendedKeys.has(`${m.id}|${cand.id}`);
        if (!joining) continue;
      }
      desired.push({
        kind: "meeting", refId: m.id, slotId: cand.id,
        title: m.title,
        description: describe(m.description, cand.conferenceUrl ?? m.conferenceUrl, `${appUrl}/meetings/${m.id}`, appTitle),
        startsAt: cand.startsAt, endsAt: cand.endsAt ?? cand.startsAt + 3600,
      });
    }
  }

  // ---- 1to1（日時が決まっているもの） ----
  const sessions = await db
    .select()
    .from(schema.oneOnOneSessions)
    .where(and(
      eq(schema.oneOnOneSessions.status, "accepted"),
      or(eq(schema.oneOnOneSessions.requesterId, memberId), eq(schema.oneOnOneSessions.responderId, memberId)),
      gte(schema.oneOnOneSessions.scheduledFor, from),
      lte(schema.oneOnOneSessions.scheduledFor, to),
    ))
    .all();
  if (sessions.length > 0) {
    const ids = sessions.map((s) => s.id);
    const [bookings, partners] = await Promise.all([
      db.select().from(schema.bookings)
        .where(and(inArray(schema.bookings.oneOnOneSessionId, ids), eq(schema.bookings.status, "confirmed"))).all(),
      db.select({ id: schema.members.id, name: schema.members.name })
        .from(schema.members)
        .where(inArray(schema.members.id, [...new Set(sessions.flatMap((s) => [s.requesterId, s.responderId]))])).all(),
    ]);
    const bookingBySession = new Map(bookings.map((b) => [b.oneOnOneSessionId as string, b]));
    const nameById = new Map(partners.map((p) => [p.id, p.name]));
    const me = await db.select({ email: schema.members.email }).from(schema.members).where(eq(schema.members.id, memberId)).get();

    for (const s of sessions) {
      const booking = bookingBySession.get(s.id);
      const isRequester = s.requesterId === memberId;
      // 主催者側にGoogleの予定が作られている1to1は、主催者はその予定を持っている。
      // 相手（招待された側）も、Googleアカウントのメールが一致していれば、Googleの招待で入るため重複させない。
      if (booking?.hostCalendarEventId) {
        if (isRequester) continue;
        if (googleEmail && me?.email && googleEmail.toLowerCase() === me.email.toLowerCase()) continue;
      }
      const partnerId = isRequester ? s.responderId : s.requesterId;
      const startsAt = booking ? Math.floor(new Date(booking.startAtUtc).getTime() / 1000) : (s.scheduledFor as number);
      const endsAt = booking ? Math.floor(new Date(booking.endAtUtc).getTime() / 1000) : startsAt + (s.customDurationMinutes ?? 30) * 60;
      desired.push({
        kind: "oneonone", refId: s.id, slotId: "",
        title: s.customTitle?.trim() || `${nameById.get(partnerId) ?? "メンバー"}さんとの1to1`,
        description: describe(s.customNote, booking?.conferenceUrl ?? s.manualConferenceUrl, `${appUrl}/oneonone`, appTitle),
        startsAt, endsAt,
      });
    }
  }

  return desired.sort((a, b) => a.startsAt - b.startsAt);
}

/**
 * 1人分のカレンダーを、あるべき状態にそろえる。Google未連携・連携切れの人は何もしない（失敗しても処理は止めない）。
 */
export async function reconcileMemberCalendar(db: Db, env: Env, memberId: string): Promise<{ created: number; deleted: number }> {
  const result = { created: 0, deleted: 0 };
  try {
    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) return result;
    const account = await db.select({ id: schema.googleCalendarAccounts.id, email: schema.googleCalendarAccounts.googleAccountEmail })
      .from(schema.googleCalendarAccounts)
      .where(and(eq(schema.googleCalendarAccounts.memberId, memberId), eq(schema.googleCalendarAccounts.isDefault, 1))).get();
    if (!account) return result;
    const cred = await getValidGoogleAccessToken(db, memberId, env.SCHEDULER_TOKEN_KEY, env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET);
    if (cred.status !== "ok") return result;

    const now = Math.floor(Date.now() / 1000);
    const desired = await buildDesired(db, env, memberId, account.email);
    const desiredMap = new Map(desired.map((d) => [keyOf(d.kind, d.refId, d.slotId), d]));
    const existing = await db.select().from(schema.memberCalendarEvents).where(eq(schema.memberCalendarEvents.memberId, memberId)).all();
    const existingMap = new Map(existing.map((r) => [keyOf(r.kind, r.refId, r.slotId), r]));

    // 登録済みの予定の古い記録は、30日たったら整理する（Google上の予定は消さない）
    const stale = existing.filter((r) => r.startsAt < now - 30 * 86400);
    for (const r of stale) {
      await db.delete(schema.memberCalendarEvents).where(eq(schema.memberCalendarEvents.id, r.id));
      existingMap.delete(keyOf(r.kind, r.refId, r.slotId));
    }

    async function removeRow(row: typeof existing[number]): Promise<void> {
      try {
        const old = await getValidGoogleAccessTokenForAccount(db, row.googleAccountId, memberId, env.SCHEDULER_TOKEN_KEY, env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET);
        if (old.status === "ok") await deleteCalendarEvent(old.accessToken, row.calendarId, row.eventId);
      } catch (e) {
        console.error("[member calendar] delete failed", memberId, row.eventId, e);
      }
      await db.delete(schema.memberCalendarEvents).where(eq(schema.memberCalendarEvents.id, row.id));
      result.deleted++;
    }

    // 不要になった予定を削除（これから始まるものだけ。過去の予定は残す）
    for (const row of existing) {
      const key = keyOf(row.kind, row.refId, row.slotId);
      if (!existingMap.has(key)) continue; // すでに整理済み
      if (!desiredMap.has(key) && row.startsAt > now) {
        await removeRow(row);
        existingMap.delete(key);
      }
    }

    // 登録・作り直し
    let createdThisRun = 0;
    for (const d of desired) {
      if (createdThisRun >= MAX_CREATE_PER_RUN) break;
      const key = keyOf(d.kind, d.refId, d.slotId);
      const row = existingMap.get(key);
      const sig = signatureOf(d);
      if (row && row.signature === sig) continue;
      if (row) {
        await removeRow(row);
        existingMap.delete(key);
      }
      try {
        const ev = await insertCalendarEvent({
          accessToken: cred.accessToken,
          calendarId: cred.calendarId,
          summary: d.title,
          description: d.description,
          startAtUtc: new Date(d.startsAt * 1000).toISOString(),
          endAtUtc: new Date(d.endsAt * 1000).toISOString(),
          attendeeEmails: [],
          requestId: newId(),
          withMeet: false,
        });
        await db.insert(schema.memberCalendarEvents).values({
          id: newId(), memberId, kind: d.kind, refId: d.refId, slotId: d.slotId,
          googleAccountId: account.id, calendarId: cred.calendarId, eventId: ev.eventId, signature: sig,
          startsAt: d.startsAt, createdAt: now, updatedAt: now,
        }).onConflictDoNothing();
        result.created++;
        createdThisRun++;
      } catch (e) {
        console.error("[member calendar] insert failed", memberId, d.kind, d.refId, e);
      }
    }
  } catch (e) {
    console.error("[member calendar] reconcile failed", memberId, e);
  }
  return result;
}

/** 複数人分を順に処理する（Googleへの同時リクエストを増やしすぎないよう、少数ずつ並列） */
export async function reconcileMembersCalendar(db: Db, env: Env, memberIds: string[]): Promise<void> {
  const ids = [...new Set(memberIds)];
  const CONCURRENCY = 4;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    await Promise.all(ids.slice(i, i + CONCURRENCY).map((id) => reconcileMemberCalendar(db, env, id)));
  }
}

/** ミーティングの変更で、カレンダーを更新する必要がある人（対象者＋すでに登録済みの人） */
export async function membersAffectedByMeeting(db: Db, meetingId: string): Promise<string[]> {
  const m = await db.select().from(schema.meetings).where(eq(schema.meetings.id, meetingId)).get();
  const ids = new Set<string>();
  if (m) {
    if (m.scope === "all") {
      for (const r of await db.select({ id: schema.members.id }).from(schema.members).where(eq(schema.members.status, "active")).all()) ids.add(r.id);
    } else if (m.scope === "team" && m.teamId) {
      for (const r of await db.select({ id: schema.teamMembers.memberId }).from(schema.teamMembers).where(eq(schema.teamMembers.teamId, m.teamId)).all()) ids.add(r.id);
    } else if (m.scope === "collab_team" && m.collabTeamId) {
      for (const r of await db.select({ id: schema.collabTeamMembers.memberId }).from(schema.collabTeamMembers)
        .where(and(eq(schema.collabTeamMembers.teamId, m.collabTeamId), eq(schema.collabTeamMembers.status, "active"))).all()) ids.add(r.id);
    } else if (m.scope === "selected") {
      for (const r of await db.select({ id: schema.meetingInvitees.memberId }).from(schema.meetingInvitees).where(eq(schema.meetingInvitees.meetingId, meetingId)).all()) ids.add(r.id);
    }
    ids.delete(m.hostMemberId);
  }
  for (const r of await db.select({ id: schema.memberCalendarEvents.memberId }).from(schema.memberCalendarEvents)
    .where(and(eq(schema.memberCalendarEvents.kind, "meeting"), eq(schema.memberCalendarEvents.refId, meetingId))).all()) ids.add(r.id);
  return [...ids];
}

export async function membersAffectedBySeries(db: Db, seriesId: string): Promise<string[]> {
  const ms = await db.select({ id: schema.meetings.id }).from(schema.meetings).where(eq(schema.meetings.seriesId, seriesId)).all();
  const ids = new Set<string>();
  // 開催回は同じ対象者なので、直近の1回分だけから対象者を求め、登録済みの人も加える
  if (ms.length > 0) for (const id of await membersAffectedByMeeting(db, ms[0].id)) ids.add(id);
  if (ms.length > 0) {
    for (const r of await db.select({ id: schema.memberCalendarEvents.memberId }).from(schema.memberCalendarEvents)
      .where(and(eq(schema.memberCalendarEvents.kind, "meeting"), inArray(schema.memberCalendarEvents.refId, ms.map((m) => m.id)))).all()) ids.add(r.id);
  }
  return [...ids];
}

export async function membersAffectedByOneOnOne(db: Db, sessionId: string): Promise<string[]> {
  const s = await db.select({ a: schema.oneOnOneSessions.requesterId, b: schema.oneOnOneSessions.responderId })
    .from(schema.oneOnOneSessions).where(eq(schema.oneOnOneSessions.id, sessionId)).get();
  const ids = new Set<string>(s ? [s.a, s.b] : []);
  for (const r of await db.select({ id: schema.memberCalendarEvents.memberId }).from(schema.memberCalendarEvents)
    .where(and(eq(schema.memberCalendarEvents.kind, "oneonone"), eq(schema.memberCalendarEvents.refId, sessionId))).all()) ids.add(r.id);
  return [...ids];
}

// ---- 呼び出し用（変更の直後にバックグラウンドで実行する） ----
type Ctx = { waitUntil: (p: Promise<unknown>) => void };

function run(ctx: Ctx, label: string, job: () => Promise<void>): void {
  ctx.waitUntil(job().catch((e) => console.error(`[member calendar] ${label} failed`, e)));
}

export function queueMeetingCalendarSync(ctx: Ctx, db: Db, env: Env, meetingId: string): void {
  run(ctx, "meeting", async () => reconcileMembersCalendar(db, env, await membersAffectedByMeeting(db, meetingId)));
}

export function queueSeriesCalendarSync(ctx: Ctx, db: Db, env: Env, seriesId: string): void {
  run(ctx, "series", async () => reconcileMembersCalendar(db, env, await membersAffectedBySeries(db, seriesId)));
}

export function queueOneOnOneCalendarSync(ctx: Ctx, db: Db, env: Env, sessionId: string): void {
  run(ctx, "oneonone", async () => reconcileMembersCalendar(db, env, await membersAffectedByOneOnOne(db, sessionId)));
}

export function queueMemberCalendarSync(ctx: Ctx, db: Db, env: Env, memberId: string): void {
  run(ctx, "member", async () => { await reconcileMemberCalendar(db, env, memberId); });
}

/**
 * アプリを開いたときの取りこぼしの補正（直近の登録の補充・不参加の反映など）。
 * 5分に1回までに間引く。
 */
export function queueSelfCalendarSync(ctx: Ctx, db: Db, env: Env, memberId: string): void {
  run(ctx, "self", async () => {
    const key = `calsync:${memberId}`;
    if (await env.KV.get(key)) return;
    await env.KV.put(key, "1", { expirationTtl: 300 });
    await reconcileMemberCalendar(db, env, memberId);
  });
}


// ---- 1回だけの整理（複数日確定のミーティングで、参加しない日まで登録されていた予定を、まとめて直す） ----
// 毎時の定期実行から呼ぶ。Googleカレンダーを連携しているメンバーを順に、カレンダーをあるべき状態にそろえる（不要な予定は削除される）。
// 進み具合は KV に記録し、全員が済んだら、以後は何もしない
const CLEANUP_KEY = "maint:calendar-cleanup:multi-date-v1";
const CLEANUP_TIME_BUDGET_MS = 15_000;
const CLEANUP_GROUP = 4;

export async function runCalendarCleanupBatch(db: Db, env: Env): Promise<{ done: boolean; processed: number }> {
  const raw = await env.KV.get(CLEANUP_KEY);
  const state: { offset: number; done: boolean } = raw ? JSON.parse(raw) : { offset: 0, done: false };
  if (state.done) return { done: true, processed: 0 };

  const ids = (await db.select({ id: schema.googleCalendarAccounts.memberId }).from(schema.googleCalendarAccounts)
    .where(eq(schema.googleCalendarAccounts.isDefault, 1)).all()).map((r) => r.id).sort();
  const started = Date.now();
  let offset = state.offset;
  let processed = 0;
  while (offset < ids.length && Date.now() - started < CLEANUP_TIME_BUDGET_MS) {
    const group = ids.slice(offset, offset + CLEANUP_GROUP);
    await reconcileMembersCalendar(db, env, group);
    offset += group.length;
    processed += group.length;
    await env.KV.put(CLEANUP_KEY, JSON.stringify({ offset, done: false }));
  }
  const done = offset >= ids.length;
  await env.KV.put(CLEANUP_KEY, JSON.stringify({ offset, done }));
  return { done, processed };
}
