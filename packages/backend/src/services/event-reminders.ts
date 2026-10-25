// =============================================================
// 確定済みの予定（1to1・ミーティング・定例会）のリマインド通知
//
// 届ける相手が自分で決める設定（主催者が相手に一方的に送るものではない）
//   ・初期設定: マイページで決める（行がなければ「1日前・ホーム画面とメールの両方」）
//   ・予定ごとの設定: その予定だけ違う設定にしたいとき（定例会は、全回まとめて設定できる）
//   ・何日前か: 1〜14日前から最大2つ（例: 3日前と1日前）／届け方: ホーム画面・メール・両方
//
// 届く時刻と届ける相手
//   ・「N日前」は、予定の日のN日前の朝8時（その人のタイムゾーン）。毎時の定期実行で、その時刻を過ぎたものを届ける
//   ・時刻を24時間以上過ぎてから設定が追いついたもの（設定の変更直後など）は、届けない
//   ・同じ予定で、2つの設定がどちらも時刻を過ぎているときは、近いほう（日数が少ないほう）だけ届ける
//   ・文面は「明日」「3日後」など、届けた時点の本当の残り日数で書く
//   ・相手は、承認済みメンバーで、その予定に参加するはずの人（主催者・招待されたメンバーから、不参加の人を除く）
// =============================================================
import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { newId } from "./auth.ts";
import { getFrontendUrl } from "./frontendUrl.ts";
import { MailService } from "./mailer.ts";
import { formatRange } from "./schedule-text.ts";
import type { Env } from "../types.ts";

export type ReminderChannel = "home" | "email" | "both";
export type ReminderSetting = { days: number[]; channel: ReminderChannel };
export type ReminderTargetKind = "oneonone" | "meeting" | "series" | "booking";

export const DEFAULT_REMINDER: ReminderSetting = { days: [1], channel: "both" };
export const MAX_REMIND_DAYS = 14;
const SEND_HOUR = 8;
const GRACE_SECONDS = 24 * 3600;
const HORIZON_DAYS = MAX_REMIND_DAYS + 2;
const MAIL_CONCURRENCY = 5;

export const TARGET_KINDS: ReminderTargetKind[] = ["oneonone", "meeting", "series", "booking"];

/** 入力された設定を検証して整える（不正なら null） */
export function normalizeSetting(raw: { days?: unknown; channel?: unknown }): ReminderSetting | null {
  if (!Array.isArray(raw.days)) return null;
  const days = [...new Set(raw.days.map(Number))].filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_REMIND_DAYS);
  if (days.length !== new Set(raw.days.map(Number)).size || days.length > 2) return null;
  if (raw.channel !== "home" && raw.channel !== "email" && raw.channel !== "both") return null;
  return { days: days.sort((a, b) => b - a), channel: raw.channel };
}

export function parseSetting(daysJson: string | null | undefined, channel: string | null | undefined): ReminderSetting {
  try {
    const parsed = normalizeSetting({ days: JSON.parse(daysJson ?? "[1]"), channel });
    if (parsed) return parsed;
  } catch { /* 既定に戻す */ }
  return { ...DEFAULT_REMINDER };
}

// ---- タイムゾーン計算 ----
type Parts = { y: number; m: number; d: number; h: number; mi: number };
function tzParts(ts: number, tz: string): Parts {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(new Date(ts * 1000));
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), mi: get("minute") };
}
/** その地域の「y年m月d日 h:mi」の瞬間（UNIX秒） */
function zonedEpoch(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const wanted = Date.UTC(y, m - 1, d, h, mi) / 1000;
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const p = tzParts(guess, tz);
    guess += wanted - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) / 1000;
  }
  return guess;
}
const dayNumber = (p: { y: number; m: number; d: number }): number => Date.UTC(p.y, p.m - 1, p.d) / 86400000;

/** N日前の朝8時（その人のタイムゾーン）の瞬間 */
export function reminderTime(startsAt: number, daysBefore: number, tz: string): number {
  const s = tzParts(startsAt, tz);
  const day = new Date(Date.UTC(s.y, s.m - 1, s.d - daysBefore));
  return zonedEpoch(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), SEND_HOUR, 0, tz);
}
function whenWord(startsAt: number, now: number, tz: string): string {
  const diff = dayNumber(tzParts(startsAt, tz)) - dayNumber(tzParts(now, tz));
  return diff <= 0 ? "今日" : diff === 1 ? "明日" : `${diff}日後`;
}

// ---- 予定の洗い出し ----
type Occurrence = {
  kind: "oneonone" | "meeting" | "booking";
  refId: string;
  seriesId: string | null;
  startsAt: number;
  endsAt: number | null;
  title: string;
  kindLabel: string;
  participants: Set<string>;
  conferenceUrl: string | null;
  hostId: string | null;
  hostName: string | null;
  path: string;
};

type MemberRow = { id: string; name: string; email: string; timezone: string | null };

async function loadOccurrences(db: Db, now: number, activeIds: Set<string>, nameById: Map<string, string>): Promise<Occurrence[]> {
  const to = now + HORIZON_DAYS * 86400;
  const out: Occurrence[] = [];

  // ---- ミーティング・定例会の開催回 ----
  const rows = await db
    .select({ m: schema.meetings, cand: schema.meetingDateCandidates })
    .from(schema.meetingDateCandidates)
    .innerJoin(schema.meetings, eq(schema.meetings.id, schema.meetingDateCandidates.meetingId))
    .where(and(
      eq(schema.meetings.status, "confirmed"),
      or(eq(schema.meetingDateCandidates.isConfirmed, 1), eq(schema.meetings.confirmedCandidateId, schema.meetingDateCandidates.id)),
      gte(schema.meetingDateCandidates.startsAt, now),
      lte(schema.meetingDateCandidates.startsAt, to),
    ))
    .all();
  if (rows.length > 0) {
    const meetingIds = [...new Set(rows.map((r) => r.m.id))];
    const teamIds = [...new Set(rows.filter((r) => r.m.scope === "team" && r.m.teamId).map((r) => r.m.teamId as string))];
    const collabIds = [...new Set(rows.filter((r) => r.m.scope === "collab_team" && r.m.collabTeamId).map((r) => r.m.collabTeamId as string))];
    const [invitees, declines, absences, noResponses, teamRows, collabRows] = await Promise.all([
      db.select().from(schema.meetingInvitees).where(inArray(schema.meetingInvitees.meetingId, meetingIds)).all(),
      db.select().from(schema.meetingDeclines).where(inArray(schema.meetingDeclines.meetingId, meetingIds)).all(),
      db.select().from(schema.meetingAttendances)
        .where(and(inArray(schema.meetingAttendances.meetingId, meetingIds), eq(schema.meetingAttendances.status, "absent"))).all(),
      db.select().from(schema.meetingResponses)
        .where(and(inArray(schema.meetingResponses.meetingId, meetingIds), eq(schema.meetingResponses.availability, "no"))).all(),
      teamIds.length > 0 ? db.select().from(schema.teamMembers).where(inArray(schema.teamMembers.teamId, teamIds)).all() : Promise.resolve([]),
      collabIds.length > 0
        ? db.select().from(schema.collabTeamMembers)
            .where(and(inArray(schema.collabTeamMembers.teamId, collabIds), eq(schema.collabTeamMembers.status, "active"))).all()
        : Promise.resolve([]),
    ]);
    const group = <T,>(list: T[], key: (x: T) => string, val: (x: T) => string) => {
      const map = new Map<string, Set<string>>();
      for (const x of list) { const k = key(x); (map.get(k) ?? map.set(k, new Set()).get(k)!).add(val(x)); }
      return map;
    };
    const inviteesBy = group(invitees, (x) => x.meetingId, (x) => x.memberId);
    const declinesBy = group(declines, (x) => x.meetingId, (x) => x.memberId);
    const teamBy = group(teamRows, (x) => x.teamId, (x) => x.memberId);
    const collabBy = group(collabRows, (x) => x.teamId, (x) => x.memberId);
    const absentBy = new Set(absences.map((a) => `${a.meetingId}|${a.candidateId ?? ""}|${a.memberId}`));
    const noBy = new Set(noResponses.filter((r) => r.memberId).map((r) => `${r.meetingId}|${r.candidateId}|${r.memberId}`));

    for (const { m, cand } of rows) {
      const base: Iterable<string> =
        m.scope === "all" ? activeIds
        : m.scope === "team" ? (teamBy.get(m.teamId ?? "") ?? [])
        : m.scope === "collab_team" ? (collabBy.get(m.collabTeamId ?? "") ?? [])
        : (inviteesBy.get(m.id) ?? []);
      const participants = new Set<string>();
      for (const id of [...base, m.hostMemberId]) {
        if (!activeIds.has(id)) continue;
        if (id !== m.hostMemberId) {
          if (declinesBy.get(m.id)?.has(id)) continue;
          if (absentBy.has(`${m.id}|${cand.id}|${id}`) || absentBy.has(`${m.id}||${id}`)) continue;
          if (noBy.has(`${m.id}|${cand.id}|${id}`)) continue;
        }
        participants.add(id);
      }
      out.push({
        kind: "meeting", refId: m.id, seriesId: m.seriesId ?? null,
        startsAt: cand.startsAt, endsAt: cand.endsAt,
        title: m.title, kindLabel: m.seriesId ? "定例会" : "ミーティング",
        participants, conferenceUrl: cand.conferenceUrl ?? m.conferenceUrl ?? null,
        hostId: m.hostMemberId, hostName: nameById.get(m.hostMemberId) ?? null, path: `/meetings/${m.id}`,
      });
    }
  }

  // ---- 1to1（メンバー同士。日時が決まっているもの） ----
  const sessions = await db.select().from(schema.oneOnOneSessions)
    .where(and(
      eq(schema.oneOnOneSessions.status, "accepted"),
      gte(schema.oneOnOneSessions.scheduledFor, now - 86400),
      lte(schema.oneOnOneSessions.scheduledFor, to + 86400),
    )).all();
  const sessionIds = sessions.map((s) => s.id);
  const sessionBookings = sessionIds.length > 0
    ? await db.select().from(schema.bookings)
        .where(and(inArray(schema.bookings.oneOnOneSessionId, sessionIds), eq(schema.bookings.status, "confirmed"))).all()
    : [];
  const bookingBySession = new Map(sessionBookings.map((b) => [b.oneOnOneSessionId as string, b]));
  for (const s of sessions) {
    const booking = bookingBySession.get(s.id);
    const startsAt = booking ? Math.floor(new Date(booking.startAtUtc).getTime() / 1000) : (s.scheduledFor as number);
    if (!(startsAt >= now && startsAt <= to)) continue;
    const endsAt = booking ? Math.floor(new Date(booking.endAtUtc).getTime() / 1000) : startsAt + (s.customDurationMinutes ?? 30) * 60;
    for (const [me, partner] of [[s.requesterId, s.responderId], [s.responderId, s.requesterId]] as const) {
      if (!activeIds.has(me)) continue;
      out.push({
        kind: "oneonone", refId: s.id, seriesId: null, startsAt, endsAt,
        title: s.customTitle?.trim() || `${nameById.get(partner) ?? "メンバー"}さんとの1to1`,
        kindLabel: "1to1", participants: new Set([me]),
        conferenceUrl: booking?.conferenceUrl ?? s.manualConferenceUrl ?? null,
        hostId: null, hostName: null, path: `/oneonone/${s.id}`,
      });
    }
  }

  // ---- 外部ゲストとの1to1（メンバー同士の1to1に結びついていない予約）。予約を受けた側のメンバーに届ける ----
  const nowIso = new Date(now * 1000).toISOString();
  const bookingRows = await db.select().from(schema.bookings)
    .where(and(
      eq(schema.bookings.status, "confirmed"),
      gte(schema.bookings.startAtUtc, nowIso),
      lte(schema.bookings.startAtUtc, new Date(to * 1000).toISOString()),
    )).all();
  for (const b of bookingRows) {
    if (b.oneOnOneSessionId) continue;
    const participants = new Set([b.hostMemberId, ...(b.guestMemberId ? [b.guestMemberId] : [])].filter((id) => activeIds.has(id)));
    if (participants.size === 0) continue;
    const startsAt = Math.floor(new Date(b.startAtUtc).getTime() / 1000);
    out.push({
      kind: "booking", refId: b.id, seriesId: null, startsAt, endsAt: Math.floor(new Date(b.endAtUtc).getTime() / 1000),
      title: `${b.guestName}さんとの1to1`, kindLabel: "1to1", participants,
      conferenceUrl: b.conferenceUrl ?? null, hostId: null, hostName: null, path: "/meetings",
    });
  }
  return out;
}

// ---- 実行 ----
export type ReminderRunResult = { occurrences: number; sent: number; skipped: number };

export async function runEventReminders(db: Db, env: Env, now: number = Math.floor(Date.now() / 1000)): Promise<ReminderRunResult> {
  const design = await db.select({ appTitle: schema.cardDesigns.appTitle, timezone: schema.cardDesigns.timezone }).from(schema.cardDesigns).get();
  const appTitle = design?.appTitle ?? "白樺クエスト";
  const systemTz = design?.timezone ?? "Asia/Tokyo";
  const appUrl = getFrontendUrl(env);

  const members: MemberRow[] = await db.select({
    id: schema.members.id, name: schema.members.name, email: schema.members.email, timezone: schema.members.timezone,
  }).from(schema.members).where(eq(schema.members.status, "active")).all();
  const memberById = new Map(members.map((m) => [m.id, m]));
  const activeIds = new Set(members.map((m) => m.id));
  const nameById = new Map(members.map((m) => [m.id, m.name]));

  const occurrences = await loadOccurrences(db, now, activeIds, nameById);
  if (occurrences.length === 0) return { occurrences: 0, sent: 0, skipped: 0 };

  const [defaultRows, overrideRows, noticeRows] = await Promise.all([
    db.select().from(schema.memberReminderSettings).all(),
    db.select().from(schema.reminderOverrides).all(),
    db.select({
      memberId: schema.reminderNotices.memberId, kind: schema.reminderNotices.kind, refId: schema.reminderNotices.refId,
      startsAt: schema.reminderNotices.startsAt, daysBefore: schema.reminderNotices.daysBefore,
    }).from(schema.reminderNotices).where(gte(schema.reminderNotices.startsAt, now)).all(),
  ]);
  const defaults = new Map(defaultRows.map((r) => [r.memberId, parseSetting(r.daysJson, r.channel)]));
  const overrides = new Map(overrideRows.map((r) => [`${r.memberId}|${r.targetKind}|${r.targetId}`, parseSetting(r.daysJson, r.channel)]));
  const done = new Set(noticeRows.map((r) => `${r.memberId}|${r.kind}|${r.refId}|${r.startsAt}|${r.daysBefore}`));

  const mailer = new MailService(db, env);
  const mailJobs: Array<() => Promise<void>> = [];
  let sent = 0;
  let skipped = 0;

  for (const occ of occurrences) {
    for (const memberId of occ.participants) {
      const member = memberById.get(memberId);
      if (!member) continue;
      const setting =
        overrides.get(`${memberId}|${occ.kind}|${occ.refId}`)
        ?? (occ.seriesId ? overrides.get(`${memberId}|series|${occ.seriesId}`) : undefined)
        ?? defaults.get(memberId) ?? DEFAULT_REMINDER;
      if (setting.days.length === 0) continue;

      const tz = member.timezone ?? systemTz;
      // 時刻を過ぎていて、まだ記録のないものを、日数の少ない順に並べる
      const due = [...setting.days].sort((a, b) => a - b)
        .filter((d) => reminderTime(occ.startsAt, d, tz) <= now && !done.has(`${memberId}|${occ.kind}|${occ.refId}|${occ.startsAt}|${d}`));
      if (due.length === 0) continue;

      const [nearest, ...older] = due;
      const fresh = now - reminderTime(occ.startsAt, nearest, tz) <= GRACE_SECONDS;
      const skipRows = (fresh ? older : due).map((d) => ({ d }));
      for (const { d } of skipRows) {
        await db.insert(schema.reminderNotices).values({
          id: newId(), memberId, kind: occ.kind, refId: occ.refId, startsAt: occ.startsAt, daysBefore: d, status: "skipped",
          channel: setting.channel, title: occ.title, body: "", linkPath: occ.path, readAt: now, createdAt: now,
        }).onConflictDoNothing();
        skipped++;
      }
      if (!fresh) continue;

      const word = whenWord(occ.startsAt, now, tz);
      const dateText = formatRange(occ.startsAt, occ.endsAt, tz);
      const title = `⏰ ${word}は「${occ.title}」です`;
      const body = `${dateText}${occ.conferenceUrl ? `\n📹 ${occ.conferenceUrl}` : ""}`;
      await db.insert(schema.reminderNotices).values({
        id: newId(), memberId, kind: occ.kind, refId: occ.refId, startsAt: occ.startsAt, daysBefore: nearest, status: "sent",
        channel: setting.channel, title, body, linkPath: occ.path, readAt: null, createdAt: now,
      }).onConflictDoNothing();
      sent++;

      if ((setting.channel === "email" || setting.channel === "both") && member.email) {
        const detailLines = [
          occ.hostName && occ.hostId !== memberId ? `👤 主催：${occ.hostName}` : "",
          occ.conferenceUrl ? `📹 会議URL\n${occ.conferenceUrl}` : "",
        ].filter(Boolean);
        mailJobs.push(() => mailer.send("event_reminder", member.email, {
          appTitle, memberName: member.name, whenWord: word, kindLabel: occ.kindLabel, title: occ.title, dateText,
          detailBlock: detailLines.length > 0 ? `${detailLines.join("\n")}\n\n` : "",
          pageUrl: `${appUrl}${occ.path}`, settingsUrl: `${appUrl}/me`,
        }).catch((e) => console.error("[reminder mail] failed", memberId, occ.kind, occ.refId, e)));
      }
    }
  }

  for (let i = 0; i < mailJobs.length; i += MAIL_CONCURRENCY) {
    await Promise.all(mailJobs.slice(i, i + MAIL_CONCURRENCY).map((job) => job()));
  }
  return { occurrences: occurrences.length, sent, skipped };
}

// ---- ホーム画面に出すリマインド ----
export type ReminderNoticeView = { id: string; kind: string; title: string; body: string; linkPath: string | null; startsAt: number; createdAt: number };

/** 自分宛てのホーム画面のリマインド（まだ始まっていない予定で、いまも有効なもの）。中止・日程変更で無効になったものは出さない */
export async function listHomeNotices(db: Db, memberId: string, now: number = Math.floor(Date.now() / 1000)): Promise<ReminderNoticeView[]> {
  const rows = await db.select().from(schema.reminderNotices)
    .where(and(
      eq(schema.reminderNotices.memberId, memberId), eq(schema.reminderNotices.status, "sent"),
      gte(schema.reminderNotices.startsAt, now),
    )).all();
  const shown = rows.filter((r) => r.readAt === null && (r.channel === "home" || r.channel === "both"));
  if (shown.length === 0) return [];

  const meetingIds = shown.filter((r) => r.kind === "meeting").map((r) => r.refId);
  const sessionIds = shown.filter((r) => r.kind === "oneonone").map((r) => r.refId);
  const bookingIds = shown.filter((r) => r.kind === "booking").map((r) => r.refId);
  const [meetingRows, sessionRows, bookingRows] = await Promise.all([
    meetingIds.length > 0
      ? db.select({ id: schema.meetings.id, status: schema.meetings.status, startsAt: schema.meetingDateCandidates.startsAt })
          .from(schema.meetingDateCandidates)
          .innerJoin(schema.meetings, eq(schema.meetings.id, schema.meetingDateCandidates.meetingId))
          .where(and(inArray(schema.meetings.id, meetingIds),
            or(eq(schema.meetingDateCandidates.isConfirmed, 1), eq(schema.meetings.confirmedCandidateId, schema.meetingDateCandidates.id)))).all()
      : Promise.resolve([]),
    sessionIds.length > 0 ? db.select().from(schema.oneOnOneSessions).where(inArray(schema.oneOnOneSessions.id, sessionIds)).all() : Promise.resolve([]),
    bookingIds.length > 0 ? db.select().from(schema.bookings).where(inArray(schema.bookings.id, bookingIds)).all() : Promise.resolve([]),
  ]);
  const meetingStarts = new Map<string, Set<number>>();
  for (const m of meetingRows) {
    if (m.status !== "confirmed") continue;
    (meetingStarts.get(m.id) ?? meetingStarts.set(m.id, new Set()).get(m.id)!).add(m.startsAt);
  }
  const sessionStart = new Map<string, number>();
  const sessionBookings = sessionIds.length > 0
    ? await db.select().from(schema.bookings)
        .where(and(inArray(schema.bookings.oneOnOneSessionId, sessionIds), eq(schema.bookings.status, "confirmed"))).all()
    : [];
  const bookingOfSession = new Map(sessionBookings.map((b) => [b.oneOnOneSessionId as string, b]));
  for (const s of sessionRows) {
    if (s.status !== "accepted") continue;
    const b = bookingOfSession.get(s.id);
    sessionStart.set(s.id, b ? Math.floor(new Date(b.startAtUtc).getTime() / 1000) : (s.scheduledFor ?? 0));
  }
  const bookingStart = new Map(bookingRows.filter((b) => b.status === "confirmed").map((b) => [b.id, Math.floor(new Date(b.startAtUtc).getTime() / 1000)]));

  return shown
    .filter((r) =>
      r.kind === "meeting" ? meetingStarts.get(r.refId)?.has(r.startsAt)
      : r.kind === "oneonone" ? sessionStart.get(r.refId) === r.startsAt
      : bookingStart.get(r.refId) === r.startsAt)
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, linkPath: r.linkPath, startsAt: r.startsAt, createdAt: r.createdAt }));
}
