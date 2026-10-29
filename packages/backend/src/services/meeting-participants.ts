// =============================================================
// ミーティング・定例会に、あとから人（メンバー・外部ゲスト）を追加する
//   ・追加した人は、すでに確定した回（まだ終わっていない回）にも入れる。確定済みなら日程を、募集中なら投票のお願いを、メールとアプリ内のお知らせで伝える
//   ・定例会の外部ゲストは、定例会に1人として登録する（ゲスト用ページに、確定済みの全開催日が並ぶ）
//   ・「グループ」で作成したミーティング・定例会へは、グループに人が加わったときに propagateGroupAdditions でまとめて追加する
//   ・ギルドにメンバーが加わった・メンバーが承認された（休会から戻った）ときは、そのギルド／全員を対象にした確定済みの定例会の、これから開催される回に入れる
//     （管理者がまとめて作業するため、メールは送らず、ホーム・通知画面のお知らせだけ出す）（addMemberToScopedSeries）
//   ・グループから人が外れたときは、そのグループで作成した、これから開催される会から、その人を外す（propagateGroupRemovals）。終わった回は、そのまま
// 通知メールは、waitUntil でレスポンス後に送る。
// =============================================================
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import type { Env } from "../types.ts";
import { newId, generateRawToken } from "./auth.ts";
import { MailService } from "./mailer.ts";
import { getFrontendUrl } from "./frontendUrl.ts";
import { formatScheduleBlock } from "./schedule-text.ts";
import { queueMeetingCalendarSync, queueMemberCalendarSync, reconcileMembersCalendar } from "./memberCalendarSync.ts";

export type ParticipantsCtx = { db: Db; env: Env; waitUntil: (p: Promise<unknown>) => void };
export type GuestToAdd = { name: string; email: string; contactId?: string | null };

type MeetingRow = typeof schema.meetings.$inferSelect;
type SeriesRow = typeof schema.meetingSeries.$inferSelect;

const FALLBACK_LENGTH_SECONDS = 3600;
const nowSec = (): number => Math.floor(Date.now() / 1000);

function chunkOf<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

type Common = { appTitle: string; tz: string; appUrl: string; hostName: string };
async function loadCommon(ctx: ParticipantsCtx, hostMemberId: string): Promise<Common> {
  const design = await ctx.db.select({ appTitle: schema.cardDesigns.appTitle, timezone: schema.cardDesigns.timezone }).from(schema.cardDesigns).get();
  const host = await ctx.db.select({ name: schema.members.name }).from(schema.members).where(eq(schema.members.id, hostMemberId)).get();
  return { appTitle: design?.appTitle ?? "白樺クエスト", tz: design?.timezone ?? "Asia/Tokyo", appUrl: getFrontendUrl(ctx.env), hostName: host?.name ?? "主催者" };
}

// ----------------------------------------------------------------
// 定例会の対象メンバー（ホストを含む）
//   全員・ギルド・チームは、そのときの所属から。個別に追加したメンバー（meeting_series_invitees）は、どの対象でも加える
// ----------------------------------------------------------------
export async function resolveSeriesMemberIds(
  db: Db,
  series: { id: string; hostMemberId: string; scope: string; teamId?: string | null; collabTeamId: string | null },
): Promise<string[]> {
  let ids: string[] = [];
  if (series.scope === "all") {
    const rows = await db.select({ id: schema.members.id }).from(schema.members).where(eq(schema.members.status, "active")).all();
    ids = rows.map((r) => r.id);
  } else if (series.scope === "team" && series.teamId) {
    const rows = await db.select({ memberId: schema.teamMembers.memberId }).from(schema.teamMembers).where(eq(schema.teamMembers.teamId, series.teamId)).all();
    ids = rows.map((r) => r.memberId);
  } else if (series.scope === "collab_team" && series.collabTeamId) {
    const rows = await db.select({ memberId: schema.collabTeamMembers.memberId }).from(schema.collabTeamMembers)
      .where(and(eq(schema.collabTeamMembers.teamId, series.collabTeamId), eq(schema.collabTeamMembers.status, "active"))).all();
    ids = rows.map((r) => r.memberId);
  }
  if (series.scope !== "all") {
    const rows = await db.select({ memberId: schema.meetingSeriesInvitees.memberId }).from(schema.meetingSeriesInvitees)
      .where(eq(schema.meetingSeriesInvitees.seriesId, series.id)).all();
    ids = [...ids, ...rows.map((r) => r.memberId)];
  }
  return [...new Set([series.hostMemberId, ...ids])];
}

// ----------------------------------------------------------------
// 通常のミーティング
// ----------------------------------------------------------------
type MeetingDates = Array<{ startsAt: number; endsAt: number | null; url: string | null; confirmed: boolean }>;
async function loadMeetingDates(db: Db, meeting: MeetingRow): Promise<MeetingDates> {
  const rows = await db.select().from(schema.meetingDateCandidates).where(eq(schema.meetingDateCandidates.meetingId, meeting.id))
    .orderBy(schema.meetingDateCandidates.startsAt).all();
  const anyFlag = rows.some((r) => r.isConfirmed === 1);
  return rows.map((r) => ({
    startsAt: r.startsAt, endsAt: r.endsAt, url: r.conferenceUrl ?? meeting.conferenceUrl ?? null,
    // 確定日のフラグがない旧形式は、confirmed_candidate_id の日を確定日として扱う
    confirmed: anyFlag ? r.isConfirmed === 1 : r.id === meeting.confirmedCandidateId,
  }));
}
const isUpcoming = (d: { startsAt: number; endsAt: number | null }, now: number): boolean => (d.endsAt ?? d.startsAt + FALLBACK_LENGTH_SECONDS) >= now;

/** まだ追加できるミーティングか（キャンセル済み・開催済みの確定済みミーティングは対象外） */
export async function isOpenForAdditions(db: Db, meeting: MeetingRow): Promise<boolean> {
  if (meeting.status === "open") return true;
  if (meeting.status !== "confirmed") return false;
  const now = nowSec();
  return (await loadMeetingDates(db, meeting)).some((d) => d.confirmed && isUpcoming(d, now));
}

function deadlineText(deadline: number | null, tz: string): string {
  if (!deadline) return "";
  return `（回答期限: ${new Intl.DateTimeFormat("ja-JP", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" }).format(new Date(deadline * 1000))}）`;
}

/** 通常のミーティングに、メンバーを追加する。追加した人数を返す（すでにいる人・ホスト・無効なメンバーは数えない） */
export async function addMembersToMeeting(ctx: ParticipantsCtx, meeting: MeetingRow, memberIds: string[]): Promise<number> {
  const { db, env } = ctx;
  if (memberIds.length === 0) return 0;
  const existing = new Set((await db.select({ id: schema.meetingInvitees.memberId }).from(schema.meetingInvitees)
    .where(eq(schema.meetingInvitees.meetingId, meeting.id)).all()).map((r) => r.id));
  const candidates = [...new Set(memberIds)].filter((id) => id !== meeting.hostMemberId && !existing.has(id));
  if (candidates.length === 0) return 0;
  const targets = await db.select({ id: schema.members.id, name: schema.members.name, email: schema.members.email }).from(schema.members)
    .where(and(inArray(schema.members.id, candidates), eq(schema.members.status, "active"))).all();
  if (targets.length === 0) return 0;

  const now = nowSec();
  for (const m of targets) await db.insert(schema.meetingInvitees).values({ id: newId(), meetingId: meeting.id, memberId: m.id });

  const common = await loadCommon(ctx, meeting.hostMemberId);
  const mailer = new MailService(db, env);
  const meetingUrl = `${common.appUrl}/meetings/${meeting.id}`;
  const confirmed = meeting.status === "confirmed";
  const dates = (await loadMeetingDates(db, meeting)).filter((d) => d.confirmed && isUpcoming(d, now));
  const block = formatScheduleBlock(dates.map((d) => ({ startsAt: d.startsAt, endsAt: d.endsAt, url: d.url })), common.tz);
  const hasUrl = dates.some((d) => !!d.url);

  const jobs: Promise<void>[] = [];
  for (const m of targets) {
    await db.insert(schema.meetingNotifications).values({
      id: newId(), meetingId: meeting.id, memberId: m.id, type: confirmed ? "confirmed" : "invited", readAt: null, createdAt: now,
      message: confirmed ? `「${meeting.title}」に招待されました（${block.dateText.split("\n")[0]}）` : `「${meeting.title}」に招待されました`,
    });
    if (!m.email) continue;
    jobs.push((confirmed
      ? mailer.send("meeting_confirmed_member", m.email, {
          appTitle: common.appTitle, memberName: m.name, meetingTitle: meeting.title, hostName: common.hostName,
          confirmedDate: block.dateText, urlPendingNote: hasUrl ? `\n${block.urlText}\n` : "", meetingUrl,
        })
      : mailer.send("meeting_invitation", m.email, {
          appTitle: common.appTitle, memberName: m.name, hostName: common.hostName, meetingTitle: meeting.title,
          meetingDescription: meeting.description ?? "", deadlineStr: deadlineText(meeting.deadline, common.tz), meetingUrl,
        })).catch(console.error));
  }
  ctx.waitUntil(Promise.all(jobs));
  queueMeetingCalendarSync(ctx, db, env, meeting.id);
  return targets.length;
}

/** 通常のミーティングに、外部ゲストを追加する。追加した人数を返す（同じメールアドレスの人がすでにいれば、数えない） */
export async function addGuestsToMeeting(ctx: ParticipantsCtx, meeting: MeetingRow, guests: GuestToAdd[]): Promise<number> {
  const { db, env } = ctx;
  if (guests.length === 0) return 0;
  const existing = new Set((await db.select({ email: schema.meetingExternalInvitees.email }).from(schema.meetingExternalInvitees)
    .where(eq(schema.meetingExternalInvitees.meetingId, meeting.id)).all()).map((r) => (r.email ?? "").toLowerCase()).filter(Boolean));
  const fresh = guests.filter((g, i) => {
    const email = g.email.trim().toLowerCase();
    return email && !existing.has(email) && guests.findIndex((x) => x.email.trim().toLowerCase() === email) === i;
  });
  if (fresh.length === 0) return 0;

  const now = nowSec();
  const common = await loadCommon(ctx, meeting.hostMemberId);
  const mailer = new MailService(db, env);
  const confirmed = meeting.status === "confirmed";
  const dates = (await loadMeetingDates(db, meeting)).filter((d) => d.confirmed && isUpcoming(d, now));
  const block = formatScheduleBlock(dates.map((d) => ({ startsAt: d.startsAt, endsAt: d.endsAt, url: d.url })), common.tz);
  const hasUrl = dates.some((d) => !!d.url);

  const jobs: Promise<void>[] = [];
  for (const g of fresh) {
    const token = generateRawToken();
    const email = g.email.trim().toLowerCase();
    await db.insert(schema.meetingExternalInvitees).values({
      id: newId(), meetingId: meeting.id, name: g.name, email, token, contactId: g.contactId ?? null, createdAt: now, invitedAt: now,
    });
    const scheduleUrl = `${common.appUrl}/schedule/${token}`;
    jobs.push((confirmed
      ? mailer.send("meeting_confirmed_guest", email, {
          appTitle: common.appTitle, guestName: g.name || "ゲスト", hostName: common.hostName, meetingTitle: meeting.title,
          confirmedDate: block.dateText, urlPendingNote: hasUrl ? block.urlText : "📹 会議URLは別途お知らせします", scheduleUrl,
        })
      : mailer.send("meeting_invitation_guest", email, {
          appTitle: common.appTitle, guestName: g.name || "ゲスト", hostName: common.hostName, meetingTitle: meeting.title,
          meetingDescription: meeting.description ?? "", deadlineStr: deadlineText(meeting.deadline, common.tz), scheduleUrl,
        })).catch(console.error));
  }
  ctx.waitUntil(Promise.all(jobs));
  return fresh.length;
}

// ----------------------------------------------------------------
// 定例会
// ----------------------------------------------------------------
export type SeriesOccurrence = { meetingId: string; startsAt: number; endsAt: number | null; url: string | null };

/** 定例会の、まだ終わっていない開催回（キャンセル済みを除く）。日付の早い順 */
export async function upcomingSeriesOccurrences(db: Db, seriesId: string): Promise<SeriesOccurrence[]> {
  const meetings = await db.select({ id: schema.meetings.id, conferenceUrl: schema.meetings.conferenceUrl }).from(schema.meetings)
    .where(and(eq(schema.meetings.seriesId, seriesId), eq(schema.meetings.status, "confirmed"))).all();
  if (meetings.length === 0) return [];
  const urlByMeeting = new Map(meetings.map((m) => [m.id, m.conferenceUrl]));
  const cands = (await Promise.all(chunkOf(meetings.map((m) => m.id), 50).map((ids) =>
    db.select().from(schema.meetingDateCandidates)
      .where(and(inArray(schema.meetingDateCandidates.meetingId, ids), eq(schema.meetingDateCandidates.isConfirmed, 1))).all()
  ))).flat();
  const now = nowSec();
  return cands
    .filter((cd) => isUpcoming(cd, now))
    .map((cd) => ({ meetingId: cd.meetingId, startsAt: cd.startsAt, endsAt: cd.endsAt, url: cd.conferenceUrl ?? urlByMeeting.get(cd.meetingId) ?? null }))
    .sort((a, b) => a.startsAt - b.startsAt);
}

/** まだ追加できる定例会か（投票中、または、これから開催される回がある確定済みの定例会） */
export async function seriesIsOpenForAdditions(db: Db, series: SeriesRow): Promise<boolean> {
  if (series.status === "voting") return true;
  if (series.status !== "confirmed") return false;
  return (await upcomingSeriesOccurrences(db, series.id)).length > 0;
}

/** 定例会に、メンバーを追加する。確定済みの定例会では、これから開催されるすべての回にも入れる。追加した人数を返す */
export async function addMembersToSeries(ctx: ParticipantsCtx, series: SeriesRow, memberIds: string[]): Promise<number> {
  const { db, env } = ctx;
  if (memberIds.length === 0 || series.scope === "all") return 0;
  const current = new Set(await resolveSeriesMemberIds(db, series));
  const candidates = [...new Set(memberIds)].filter((id) => !current.has(id));
  if (candidates.length === 0) return 0;
  const targets = await db.select({ id: schema.members.id, name: schema.members.name, email: schema.members.email }).from(schema.members)
    .where(and(inArray(schema.members.id, candidates), eq(schema.members.status, "active"))).all();
  if (targets.length === 0) return 0;

  const now = nowSec();
  for (const m of targets) await db.insert(schema.meetingSeriesInvitees).values({ id: newId(), seriesId: series.id, memberId: m.id });

  const common = await loadCommon(ctx, series.hostMemberId);
  const mailer = new MailService(db, env);
  const seriesUrl = `${common.appUrl}/meetings/series/${series.id}`;
  const title = `【定例会】${series.title}`;
  const jobs: Promise<void>[] = [];

  if (series.status === "voting") {
    for (const m of targets) {
      if (!m.email) continue;
      jobs.push(mailer.send("meeting_invitation", m.email, {
        appTitle: common.appTitle, memberName: m.name, hostName: common.hostName, meetingTitle: title,
        meetingDescription: series.description ?? "", deadlineStr: "", meetingUrl: seriesUrl,
      }).catch(console.error));
    }
  } else {
    // 確定済み: これから開催されるすべての回に入れ、日程を1通にまとめて伝える
    const occ = await upcomingSeriesOccurrences(db, series.id);
    const meetingIds = occ.map((o) => o.meetingId);
    const already = new Map<string, Set<string>>();
    for (const ids of chunkOf(meetingIds, 50)) {
      const rows = await db.select({ meetingId: schema.meetingInvitees.meetingId, memberId: schema.meetingInvitees.memberId }).from(schema.meetingInvitees)
        .where(and(inArray(schema.meetingInvitees.meetingId, ids), inArray(schema.meetingInvitees.memberId, targets.map((t) => t.id)))).all();
      for (const r of rows) (already.get(r.meetingId) ?? already.set(r.meetingId, new Set()).get(r.meetingId)!).add(r.memberId);
    }
    for (const meetingId of meetingIds) {
      for (const m of targets) {
        if (already.get(meetingId)?.has(m.id)) continue;
        await db.insert(schema.meetingInvitees).values({ id: newId(), meetingId, memberId: m.id });
      }
    }
    const sharedUrl = series.conferenceUrl ?? null;
    const block = formatScheduleBlock(occ.map((o) => ({ startsAt: o.startsAt, endsAt: o.endsAt, url: o.url ?? sharedUrl })), common.tz);
    const hasUrl = occ.some((o) => !!(o.url ?? sharedUrl));
    for (const m of targets) {
      if (meetingIds[0]) {
        await db.insert(schema.meetingNotifications).values({
          id: newId(), meetingId: meetingIds[0], memberId: m.id, type: "confirmed", readAt: null, createdAt: now,
          message: `「${series.title}」の定例会に招待されました（これから全${occ.length}回）`,
        });
      }
      if (!m.email) continue;
      jobs.push(mailer.send("meeting_confirmed_member", m.email, {
        appTitle: common.appTitle, memberName: m.name, meetingTitle: title, hostName: common.hostName,
        confirmedDate: block.dateText, urlPendingNote: hasUrl ? `\n${block.urlText}\n` : "", meetingUrl: seriesUrl,
      }).catch(console.error));
    }
    ctx.waitUntil(reconcileMembersCalendar(db, env, targets.map((t) => t.id)).catch((e) => console.error("[series add members] calendar sync failed", e)));
  }
  ctx.waitUntil(Promise.all(jobs));
  return targets.length;
}

/** 定例会に、外部ゲストを追加する。確定済みなら、ゲスト用ページにこれからの全開催日が並ぶ。追加した人数を返す */
export async function addGuestsToSeries(ctx: ParticipantsCtx, series: SeriesRow, guests: GuestToAdd[]): Promise<number> {
  const { db, env } = ctx;
  if (guests.length === 0) return 0;
  const existing = new Set((await db.select({ email: schema.meetingSeriesExternalInvitees.email }).from(schema.meetingSeriesExternalInvitees)
    .where(eq(schema.meetingSeriesExternalInvitees.seriesId, series.id)).all()).map((r) => (r.email ?? "").toLowerCase()).filter(Boolean));
  const fresh = guests.filter((g, i) => {
    const email = g.email.trim().toLowerCase();
    return email && !existing.has(email) && guests.findIndex((x) => x.email.trim().toLowerCase() === email) === i;
  });
  if (fresh.length === 0) return 0;

  const now = nowSec();
  const common = await loadCommon(ctx, series.hostMemberId);
  const mailer = new MailService(db, env);
  const title = `【定例会】${series.title}`;
  const confirmed = series.status !== "voting";
  const occ = confirmed ? await upcomingSeriesOccurrences(db, series.id) : [];
  const sharedUrl = series.conferenceUrl ?? null;
  const block = formatScheduleBlock(occ.map((o) => ({ startsAt: o.startsAt, endsAt: o.endsAt, url: o.url ?? sharedUrl })), common.tz);
  const hasUrl = occ.some((o) => !!(o.url ?? sharedUrl));

  const jobs: Promise<void>[] = [];
  for (const g of fresh) {
    const token = generateRawToken();
    const email = g.email.trim().toLowerCase();
    await db.insert(schema.meetingSeriesExternalInvitees).values({
      id: newId(), seriesId: series.id, name: g.name, email, token, contactId: g.contactId ?? null, createdAt: now, invitedAt: now,
    });
    const scheduleUrl = `${common.appUrl}/schedule/series/${token}`;
    jobs.push((confirmed
      ? mailer.send("meeting_confirmed_guest", email, {
          appTitle: common.appTitle, guestName: g.name || "ゲスト", meetingTitle: title, hostName: common.hostName,
          confirmedDate: block.dateText, urlPendingNote: hasUrl ? `\n${block.urlText}\n` : "", scheduleUrl,
        })
      : mailer.send("meeting_invitation_guest", email, {
          appTitle: common.appTitle, guestName: g.name || "ゲスト", hostName: common.hostName, meetingTitle: title,
          meetingDescription: series.description ?? "", deadlineStr: "", scheduleUrl,
        })).catch(console.error));
  }
  ctx.waitUntil(Promise.all(jobs));
  return fresh.length;
}

// ----------------------------------------------------------------
// グループに人が加わったとき、そのグループで作成した、まだ終わっていないミーティング・定例会へも追加する
// ----------------------------------------------------------------
export type GroupAdditions = { memberIds: string[]; guests: GuestToAdd[] };

export async function propagateGroupAdditions(
  ctx: ParticipantsCtx, groupId: string, add: GroupAdditions,
): Promise<{ meetings: number; series: number }> {
  const { db } = ctx;
  if (add.memberIds.length === 0 && add.guests.length === 0) return { meetings: 0, series: 0 };
  let meetingCount = 0;
  let seriesCount = 0;

  const meetings = await db.select().from(schema.meetings)
    .where(and(eq(schema.meetings.groupId, groupId), isNull(schema.meetings.seriesId), inArray(schema.meetings.status, ["open", "confirmed"]))).all();
  for (const meeting of meetings) {
    if (!(await isOpenForAdditions(db, meeting))) continue;
    const m = await addMembersToMeeting(ctx, meeting, add.memberIds);
    const g = await addGuestsToMeeting(ctx, meeting, add.guests);
    if (m + g > 0) meetingCount++;
  }

  const seriesList = await db.select().from(schema.meetingSeries)
    .where(and(eq(schema.meetingSeries.groupId, groupId), inArray(schema.meetingSeries.status, ["voting", "confirmed"]))).all();
  for (const series of seriesList) {
    if (!(await seriesIsOpenForAdditions(db, series))) continue;
    const m = await addMembersToSeries(ctx, series, add.memberIds);
    const g = await addGuestsToSeries(ctx, series, add.guests);
    if (m + g > 0) seriesCount++;
  }
  return { meetings: meetingCount, series: seriesCount };
}

// ----------------------------------------------------------------
// グループから人が外れたとき、そのグループで作成した、これから開催される会から、その人を外す
//   ・終わった回・キャンセル済みの会は、そのまま（出欠の記録を残すため）
//   ・外した人には、通知は送らない
// ----------------------------------------------------------------
export type GroupRemovals = { memberIds: string[]; guestEmails: string[] };

async function removeMembersFromMeeting(db: Db, meetingId: string, memberIds: string[]): Promise<void> {
  await db.delete(schema.meetingInvitees).where(and(eq(schema.meetingInvitees.meetingId, meetingId), inArray(schema.meetingInvitees.memberId, memberIds)));
  await db.delete(schema.meetingResponses).where(and(eq(schema.meetingResponses.meetingId, meetingId), inArray(schema.meetingResponses.memberId, memberIds)));
  await db.delete(schema.meetingDeclines).where(and(eq(schema.meetingDeclines.meetingId, meetingId), inArray(schema.meetingDeclines.memberId, memberIds)));
}

async function removeGuestsFromMeeting(db: Db, meetingId: string, emails: string[]): Promise<number> {
  const rows = await db.select({ id: schema.meetingExternalInvitees.id }).from(schema.meetingExternalInvitees)
    .where(and(eq(schema.meetingExternalInvitees.meetingId, meetingId), inArray(sql`lower(${schema.meetingExternalInvitees.email})`, emails))).all();
  if (rows.length === 0) return 0;
  const ids = rows.map((r) => r.id);
  await db.delete(schema.meetingResponses).where(and(eq(schema.meetingResponses.meetingId, meetingId), inArray(schema.meetingResponses.externalInviteeId, ids)));
  await db.delete(schema.meetingExternalInvitees).where(inArray(schema.meetingExternalInvitees.id, ids));
  return rows.length;
}

/** 定例会から、メンバーを外す。投票・個別の追加と、これから開催される各回の招待・回答・辞退を消す（終わった回は、そのまま） */
export async function removeMembersFromSeries(ctx: ParticipantsCtx, series: SeriesRow, memberIds: string[]): Promise<void> {
  const { db, env } = ctx;
  const ids = memberIds.filter((id) => id !== series.hostMemberId);
  if (ids.length === 0) return;
  await db.delete(schema.meetingSeriesInvitees).where(and(eq(schema.meetingSeriesInvitees.seriesId, series.id), inArray(schema.meetingSeriesInvitees.memberId, ids)));
  await db.delete(schema.meetingSeriesResponses).where(and(eq(schema.meetingSeriesResponses.seriesId, series.id), inArray(schema.meetingSeriesResponses.memberId, ids)));
  for (const o of await upcomingSeriesOccurrences(db, series.id)) await removeMembersFromMeeting(db, o.meetingId, ids);
  ctx.waitUntil(reconcileMembersCalendar(db, env, ids).catch((e) => console.error("[series remove members] calendar sync failed", e)));
}

export async function propagateGroupRemovals(
  ctx: ParticipantsCtx, groupId: string, rem: GroupRemovals,
): Promise<{ meetings: number; series: number }> {
  const { db, env } = ctx;
  const memberIds = [...new Set(rem.memberIds)];
  const emails = [...new Set(rem.guestEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (memberIds.length === 0 && emails.length === 0) return { meetings: 0, series: 0 };
  let meetingCount = 0;
  let seriesCount = 0;

  const meetings = await db.select().from(schema.meetings)
    .where(and(eq(schema.meetings.groupId, groupId), isNull(schema.meetings.seriesId), inArray(schema.meetings.status, ["open", "confirmed"]))).all();
  for (const meeting of meetings) {
    if (!(await isOpenForAdditions(db, meeting))) continue;
    if (memberIds.length > 0) await removeMembersFromMeeting(db, meeting.id, memberIds);
    if (emails.length > 0) await removeGuestsFromMeeting(db, meeting.id, emails);
    meetingCount++;
    if (memberIds.length > 0) queueMeetingCalendarSync(ctx, db, env, meeting.id);
  }

  const seriesList = await db.select().from(schema.meetingSeries)
    .where(and(eq(schema.meetingSeries.groupId, groupId), inArray(schema.meetingSeries.status, ["voting", "confirmed"]))).all();
  for (const series of seriesList) {
    if (!(await seriesIsOpenForAdditions(db, series))) continue;
    if (memberIds.length > 0) await removeMembersFromSeries(ctx, series, memberIds);
    if (emails.length > 0) {
      const rows = await db.select({ id: schema.meetingSeriesExternalInvitees.id }).from(schema.meetingSeriesExternalInvitees)
        .where(and(eq(schema.meetingSeriesExternalInvitees.seriesId, series.id), inArray(sql`lower(${schema.meetingSeriesExternalInvitees.email})`, emails))).all();
      if (rows.length > 0) {
        const ids = rows.map((r) => r.id);
        await db.delete(schema.meetingSeriesExternalResponses).where(inArray(schema.meetingSeriesExternalResponses.externalInviteeId, ids));
        await db.delete(schema.meetingSeriesExternalInvitees).where(inArray(schema.meetingSeriesExternalInvitees.id, ids));
      }
    }
    seriesCount++;
  }
  return { meetings: meetingCount, series: seriesCount };
}

// ----------------------------------------------------------------
// ギルドにメンバーが加わった・メンバーが承認された（休会から戻った）とき、
// そのギルド／全員を対象にした確定済みの定例会の、これから開催される回に、そのメンバーを入れる
//   ・確定済みの各回の招待は、確定した時点の名簿で固定されるため、後から対象になった人は、ここで入れないと各回の対象から漏れる
//   ・管理者がまとめて作業するため、メールは送らない。ホーム・通知画面に出るお知らせ（アプリ内）だけを、定例会ごとに1件出す
//   ・投票中の定例会は、対象がそのときの所属から決まるため、何もしなくてよい
// ----------------------------------------------------------------
export async function addMemberToScopedSeries(
  ctx: ParticipantsCtx, memberId: string, scope: { kind: "all" } | { kind: "team"; teamId: string },
): Promise<number> {
  const { db, env } = ctx;
  const member = await db.select({ id: schema.members.id }).from(schema.members)
    .where(and(eq(schema.members.id, memberId), eq(schema.members.status, "active"))).get();
  if (!member) return 0;

  const seriesList = await db.select().from(schema.meetingSeries).where(and(
    eq(schema.meetingSeries.status, "confirmed"),
    scope.kind === "all" ? eq(schema.meetingSeries.scope, "all") : and(eq(schema.meetingSeries.scope, "team"), eq(schema.meetingSeries.teamId, scope.teamId)),
  )).all();

  const now = nowSec();
  let count = 0;
  for (const series of seriesList) {
    if (series.hostMemberId === memberId) continue;
    const occ = await upcomingSeriesOccurrences(db, series.id);
    if (occ.length === 0) continue;
    const have = new Set<string>();
    for (const ids of chunkOf(occ.map((o) => o.meetingId), 50)) {
      const rows = await db.select({ meetingId: schema.meetingInvitees.meetingId }).from(schema.meetingInvitees)
        .where(and(inArray(schema.meetingInvitees.meetingId, ids), eq(schema.meetingInvitees.memberId, memberId))).all();
      for (const r of rows) have.add(r.meetingId);
    }
    const missing = occ.filter((o) => !have.has(o.meetingId));
    if (missing.length === 0) continue;
    for (const o of missing) await db.insert(schema.meetingInvitees).values({ id: newId(), meetingId: o.meetingId, memberId });
    await db.insert(schema.meetingNotifications).values({
      id: newId(), meetingId: missing[0].meetingId, memberId, type: "invited", readAt: null, createdAt: now,
      message: `定例会「${series.title}」の対象になりました（これから全${missing.length}回）`,
    });
    count++;
  }
  if (count > 0) queueMemberCalendarSync(ctx, db, env, memberId);
  return count;
}
