// =============================================================
// 日程確定後の、複数人ミーティングの日程変更（主催者）
//   ・ある日を「中止」にする
//   ・ある日の「日時を変更」する
//   ・新しい日を「追加」する（追加した日は、そのまま開催日として確定する）
// をまとめて1回の操作で行い、関係者への連絡は「1人に1通」にまとめて送る。
//
// 連絡の相手
//   ・中止／日時変更：その日に参加表明していた人（○をつけた人）。参加を選び直してもらう
//     （出欠を確認しない「お知らせのみ」の会は、参加表明がないので、対象者全員にお知らせする）
//   ・追加：もともとの案内の対象者全員（辞退した人は除く）
//   複数に当てはまる人には、中止・変更・追加の内容を1通にまとめる
// 中止・日時変更になった日の回答（○△×・出欠の記録）は、取り消して、選び直してもらう。
// =============================================================
import { and, eq, inArray } from "drizzle-orm";
import type { createDb } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { newId } from "./auth.ts";
import { MailService } from "./mailer.ts";
import { candidateEndSeconds } from "./candidate-length.ts";
import { queueMeetingCalendarSync } from "./memberCalendarSync.ts";
import { blockHostCalendarForDate, calendarDescription, deleteHostCalendarEvent, updateHostCalendarEventFields } from "./conferenceService.ts";
import type { Env } from "../types.ts";

type Db = ReturnType<typeof createDb>;
type Meeting = typeof schema.meetings.$inferSelect;
type Candidate = typeof schema.meetingDateCandidates.$inferSelect;
type Person = { id: string; name: string; email: string | null };

export const MAX_MEETING_CANDIDATES = 20;

export type ScheduleChangeInput = {
  /** 中止する日（確定済みの候補日のID） */
  cancel?: string[];
  /** 日時を変更する日 */
  reschedule?: Array<{ candidateId: string; startsAt: number; endsAt?: number | null }>;
  /** 新しく追加する日 */
  add?: Array<{ startsAt: number; endsAt?: number | null }>;
};

export type ScheduleChangeSummary = {
  cancelCount: number;
  rescheduleCount: number;
  addCount: number;
  /** 中止・日時変更の連絡をする人（参加表明していた人）の名前 */
  declaredNames: string[];
  /** 追加の連絡をする人数 */
  addRecipientCount: number;
  /** 送るメールの通数（1人1通） */
  mailCount: number;
};

type Failure = { ok: false; status: 400 | 404; code: string; message: string };
type Success = { ok: true; summary: ScheduleChangeSummary };

/** 1人に伝える内容 */
type Notice = {
  cancelled: Array<{ startsAt: number; endsAt: number | null }>;
  changed: Array<{ fromStartsAt: number; fromEndsAt: number | null; toStartsAt: number; toEndsAt: number | null }>;
  addedAny: boolean;
};

const emptyNotice = (): Notice => ({ cancelled: [], changed: [], addedAny: false });

export async function runScheduleChange(opts: {
  db: Db;
  env: Env;
  ctx: { waitUntil: (p: Promise<unknown>) => void };
  meeting: Meeting;
  input: ScheduleChangeInput;
  /** もともとの案内の対象メンバー（辞退した人は含まない。主催者を含んでよい） */
  targets: Person[];
  preview: boolean;
  tz: string;
  appTitle: string;
  appUrl: string;
  formatRange: (startsAt: number, endsAt: number | null, tz: string) => string;
}): Promise<Failure | Success> {
  const { db, env, meeting, preview, tz } = opts;
  const now = Math.floor(Date.now() / 1000);
  const fail = (code: string, message: string, status: 400 | 404 = 400): Failure => ({ ok: false, status, code, message });

  if (meeting.status !== "confirmed") return fail("invalid_status", "日程が確定しているミーティングだけ、日程を変更できます");
  if (meeting.seriesId) return fail("series_meeting", "定例会の各回は、定例会の画面から変更してください");

  const all = await db.select().from(schema.meetingDateCandidates).where(eq(schema.meetingDateCandidates.meetingId, meeting.id)).all();
  const byId = new Map(all.map((c) => [c.id, c]));
  const isConfirmed = (c: Candidate) => c.isConfirmed === 1 || meeting.confirmedCandidateId === c.id;
  const endOf = (c: { startsAt: number; endsAt: number | null }) => c.endsAt ?? c.startsAt + 3600;

  // ---- 入力の確認 ----
  const cancelIds = [...new Set(opts.input.cancel ?? [])];
  const cancels: Candidate[] = [];
  for (const id of cancelIds) {
    const c = byId.get(id);
    if (!c || !isConfirmed(c)) return fail("invalid_input", "中止する日程が見つかりません。画面を開き直して、もう一度お試しください");
    if (endOf(c) < now) return fail("past_date", "すでに終わった日程は、中止にできません");
    cancels.push(c);
  }

  const reschedules: Array<{ cand: Candidate; startsAt: number; endsAt: number | null }> = [];
  const seenResched = new Set<string>();
  for (const r of opts.input.reschedule ?? []) {
    const c = byId.get(r.candidateId);
    if (!c || !isConfirmed(c) || cancelIds.includes(r.candidateId) || seenResched.has(r.candidateId)) {
      return fail("invalid_input", "日時を変更する日程が見つかりません。画面を開き直して、もう一度お試しください");
    }
    seenResched.add(r.candidateId);
    if (!r.startsAt || r.startsAt < now) return fail("past_date", "過去の日時には変更できません。未来の日時を指定してください");
    const endsAt = candidateEndSeconds(r.startsAt, r.endsAt ?? null);
    if (r.startsAt === c.startsAt && endsAt === c.endsAt) continue; // 変わっていない日は、何もしない
    if (endOf(c) < now) return fail("past_date", "すでに終わった日程は、変更できません");
    reschedules.push({ cand: c, startsAt: r.startsAt, endsAt });
  }

  const adds: Array<{ startsAt: number; endsAt: number | null }> = [];
  for (const a of opts.input.add ?? []) {
    if (!a.startsAt || a.startsAt < now) return fail("past_date", "過去の日時は追加できません。未来の日時を指定してください");
    const endsAt = candidateEndSeconds(a.startsAt, a.endsAt ?? null);
    const dup = all.some((c) => c.startsAt === a.startsAt && !cancelIds.includes(c.id)) || adds.some((x) => x.startsAt === a.startsAt);
    if (dup) return fail("duplicate_date", "同じ日時の日程がすでにあります。別の日時を指定してください");
    adds.push({ startsAt: a.startsAt, endsAt });
  }

  if (cancels.length + reschedules.length + adds.length === 0) return fail("no_change", "変更する内容がありません");

  const remainingConfirmed = all.filter((c) => isConfirmed(c) && !cancelIds.includes(c.id)).length + adds.length;
  if (remainingConfirmed === 0) {
    return fail("no_dates_left", "すべての日程を中止するときは、「ミーティングをキャンセル」をご利用ください。開催する日が1日も残らなくなります");
  }
  if (all.length - cancels.length + adds.length > MAX_MEETING_CANDIDATES) {
    return fail("too_many_candidates", `日程は最大${MAX_MEETING_CANDIDATES}個までです。不要な日程を中止してから、追加してください`);
  }

  // ---- 連絡する相手と、伝える内容（変更を反映する前に求める） ----
  const hostId = meeting.hostMemberId;
  const memberTargets = opts.targets.filter((m) => m.id !== hostId);
  const targetIds = new Set(memberTargets.map((m) => m.id));
  const changedIds = [...cancels.map((c) => c.id), ...reschedules.map((r) => r.cand.id)];
  const externals = await db.select().from(schema.meetingExternalInvitees).where(eq(schema.meetingExternalInvitees.meetingId, meeting.id)).all();
  const externalIds = new Set(externals.map((e) => e.id));

  // 日ごとに、参加表明していた人（○をつけた人・出席にした人）
  const declaredBy = new Map<string, Set<string>>(); // candidateId -> 人（"m:ID" / "e:ID"）
  for (const id of changedIds) declaredBy.set(id, new Set());
  if (changedIds.length > 0) {
    if (meeting.noAttendanceCheck) {
      // 出欠を確認しない会は、参加表明がない。対象者全員が、連絡の相手
      for (const id of changedIds) {
        for (const m of memberTargets) declaredBy.get(id)!.add(`m:${m.id}`);
        for (const e of externals) declaredBy.get(id)!.add(`e:${e.id}`);
      }
    } else {
      const responses = await db.select({ candidateId: schema.meetingResponses.candidateId, memberId: schema.meetingResponses.memberId, externalId: schema.meetingResponses.externalInviteeId, availability: schema.meetingResponses.availability })
        .from(schema.meetingResponses).where(inArray(schema.meetingResponses.candidateId, changedIds)).all();
      for (const r of responses) {
        if (r.availability !== "yes") continue;
        if (r.memberId) declaredBy.get(r.candidateId)?.add(`m:${r.memberId}`);
        if (r.externalId) declaredBy.get(r.candidateId)?.add(`e:${r.externalId}`);
      }
      const attended = await db.select({ candidateId: schema.meetingAttendances.candidateId, memberId: schema.meetingAttendances.memberId })
        .from(schema.meetingAttendances)
        .where(and(inArray(schema.meetingAttendances.candidateId, changedIds), eq(schema.meetingAttendances.status, "attended"))).all();
      for (const a of attended) if (a.candidateId) declaredBy.get(a.candidateId)?.add(`m:${a.memberId}`);
    }
  }

  const notices = new Map<string, Notice>(); // "m:ID" / "e:ID" -> 内容
  const noticeOf = (key: string): Notice => { let n = notices.get(key); if (!n) { n = emptyNotice(); notices.set(key, n); } return n; };
  const isValidKey = (key: string) => key.startsWith("m:") ? targetIds.has(key.slice(2)) : externalIds.has(key.slice(2));
  for (const c of cancels) {
    for (const key of declaredBy.get(c.id) ?? []) if (isValidKey(key)) noticeOf(key).cancelled.push({ startsAt: c.startsAt, endsAt: c.endsAt });
  }
  for (const r of reschedules) {
    for (const key of declaredBy.get(r.cand.id) ?? []) {
      if (isValidKey(key)) noticeOf(key).changed.push({ fromStartsAt: r.cand.startsAt, fromEndsAt: r.cand.endsAt, toStartsAt: r.startsAt, toEndsAt: r.endsAt });
    }
  }
  const declaredKeys = new Set(notices.keys());
  if (adds.length > 0) {
    for (const m of memberTargets) noticeOf(`m:${m.id}`).addedAny = true;
    for (const e of externals) noticeOf(`e:${e.id}`).addedAny = true;
  }

  const nameOf = new Map<string, string>([...memberTargets.map((m) => [`m:${m.id}`, m.name] as const), ...externals.map((e) => [`e:${e.id}`, e.name || "ゲスト"] as const)]);
  const emailOf = new Map<string, string | null>([...memberTargets.map((m) => [`m:${m.id}`, m.email] as const), ...externals.map((e) => [`e:${e.id}`, e.email] as const)]);
  const summary: ScheduleChangeSummary = {
    cancelCount: cancels.length,
    rescheduleCount: reschedules.length,
    addCount: adds.length,
    declaredNames: [...declaredKeys].map((k) => nameOf.get(k) ?? "").filter(Boolean),
    addRecipientCount: adds.length > 0 ? memberTargets.length + externals.length : 0,
    mailCount: [...notices.keys()].filter((k) => !!emailOf.get(k)).length,
  };
  if (preview) return { ok: true, summary };

  // ---- 変更の反映 ----
  const toIso = (ts: number) => new Date(ts * 1000).toISOString();

  // 中止：主催者のGoogleカレンダーの予定・回答・出欠の記録を消し、日程そのものを消す
  for (const c of cancels) {
    if (c.calendarEventId) await deleteHostCalendarEvent(db, env, hostId, c.calendarEventId);
  }
  if (changedIds.length > 0) {
    await db.delete(schema.meetingResponses).where(inArray(schema.meetingResponses.candidateId, changedIds));
    await db.delete(schema.meetingAttendances).where(inArray(schema.meetingAttendances.candidateId, changedIds));
  }
  if (cancels.length > 0) {
    await db.delete(schema.meetingDateCandidates).where(inArray(schema.meetingDateCandidates.id, cancels.map((c) => c.id)));
  }

  // 日時変更：回答を取り消して（上で削除済み）、日時を更新。主催者のカレンダーの予定も、新しい日時に動かす
  for (const r of reschedules) {
    await db.update(schema.meetingDateCandidates).set({ startsAt: r.startsAt, endsAt: r.endsAt }).where(eq(schema.meetingDateCandidates.id, r.cand.id));
    const endsAt = r.endsAt ?? r.startsAt + 3600;
    if (r.cand.calendarEventId) {
      await updateHostCalendarEventFields(db, env, hostId, r.cand.calendarEventId, { startAtUtc: toIso(r.startsAt), endAtUtc: toIso(endsAt) });
    } else {
      const blocked = await blockHostCalendarForDate({
        db, env, hostMemberId: hostId, summary: meeting.title,
        description: calendarDescription(meeting.description, r.cand.conferenceUrl ?? meeting.conferenceUrl),
        startAtUtc: toIso(r.startsAt), endAtUtc: toIso(endsAt), requestId: `${meeting.id}-${r.cand.id}-${now}`,
      });
      if (blocked.eventId) await db.update(schema.meetingDateCandidates).set({ calendarEventId: blocked.eventId }).where(eq(schema.meetingDateCandidates.id, r.cand.id));
    }
  }

  // 追加：新しい日を、そのまま確定した開催日として登録
  let nextSort = all.length > 0 ? Math.max(...all.map((c) => c.sortOrder)) + 1 : 0;
  for (const a of adds) {
    const candId = newId();
    const endsAt = a.endsAt ?? a.startsAt + 3600;
    const blocked = await blockHostCalendarForDate({
      db, env, hostMemberId: hostId, summary: meeting.title,
      description: calendarDescription(meeting.description, meeting.conferenceUrl),
      startAtUtc: toIso(a.startsAt), endAtUtc: toIso(endsAt), requestId: `${meeting.id}-${candId}`,
    });
    await db.insert(schema.meetingDateCandidates).values({
      id: candId, meetingId: meeting.id, startsAt: a.startsAt, endsAt: a.endsAt, note: null, sortOrder: nextSort++,
      isConfirmed: 1, addedByMemberId: hostId, calendarEventId: blocked.eventId ?? null,
    });
  }

  // 確定している日の先頭を、ミーティングに記録し直す
  const after = await db.select().from(schema.meetingDateCandidates)
    .where(and(eq(schema.meetingDateCandidates.meetingId, meeting.id), eq(schema.meetingDateCandidates.isConfirmed, 1)))
    .orderBy(schema.meetingDateCandidates.startsAt).all();
  await db.update(schema.meetings).set({ confirmedCandidateId: after[0]?.id ?? null, updatedAt: now }).where(eq(schema.meetings.id, meeting.id));

  // 招待された人のGoogleカレンダー（参加表明した日だけ登録される）も、最新にそろえる
  queueMeetingCalendarSync(opts.ctx, db, env, meeting.id);

  // ---- 連絡（1人に1通） ----
  const host = await db.select({ name: schema.members.name }).from(schema.members).where(eq(schema.members.id, hostId)).get();
  const hostName = host?.name ?? "主催者";
  const scheduleNowText = after.map((c) => `・${opts.formatRange(c.startsAt, c.endsAt, tz)}`).join("\n");
  const mailer = new MailService(db, env);
  const jobs: Promise<unknown>[] = [];

  for (const [key, notice] of notices) {
    const hasLoss = notice.cancelled.length > 0 || notice.changed.length > 0;
    const sections: string[] = [];
    if (notice.cancelled.length > 0) {
      sections.push(`▼ 中止になった日程\n${notice.cancelled.map((d) => `・${opts.formatRange(d.startsAt, d.endsAt, tz)}`).join("\n")}`);
    }
    if (notice.changed.length > 0) {
      sections.push(`▼ 日時が変更になった日程\n${notice.changed.map((d) => `・${opts.formatRange(d.fromStartsAt, d.fromEndsAt, tz)}\n　→ ${opts.formatRange(d.toStartsAt, d.toEndsAt, tz)}`).join("\n")}`);
    }
    if (notice.addedAny) {
      sections.push(`▼ 新しく追加された日程\n${adds.map((a) => `・${opts.formatRange(a.startsAt, a.endsAt, tz)}`).join("\n")}`);
    }
    sections.push(`▼ 現在の開催日程\n${scheduleNowText}`);
    const changesText = sections.join("\n\n");

    const actionNote = meeting.noAttendanceCheck
      ? "ご予定の変更をお願いします。"
      : hasLoss
        ? `あなたが参加表明をしていた日程に変更があったため、お知らせしています。お手数ですが、下のURLから、あらためて参加できる日を選び直してください。${notice.addedAny ? "新しく追加された日程も、あわせてご確認ください。" : ""}`
        : "ご都合のよい日がありましたら、下のURLから、参加できる日を登録してください。";

    const id = key.slice(2);
    if (key.startsWith("m:")) {
      const parts: string[] = [];
      if (notice.cancelled.length > 0) parts.push(`中止${notice.cancelled.length}日`);
      if (notice.changed.length > 0) parts.push(`日時変更${notice.changed.length}日`);
      if (notice.addedAny) parts.push(`追加${adds.length}日`);
      await db.insert(schema.meetingNotifications).values({
        id: newId(), meetingId: meeting.id, memberId: id, type: "schedule_changed",
        message: `「${meeting.title}」の日程が変わりました（${parts.join("・")}）。${meeting.noAttendanceCheck ? "ご確認ください" : hasLoss ? "参加できる日を選び直してください" : "参加できる日があれば登録してください"}`,
        readAt: null, createdAt: now,
      });
      const email = emailOf.get(key);
      if (email) {
        jobs.push(mailer.send("meeting_schedule_changed_member", email, {
          appTitle: opts.appTitle, memberName: nameOf.get(key) ?? "", hostName, meetingTitle: meeting.title,
          changesText, actionNote, meetingUrl: `${opts.appUrl}/meetings/${meeting.id}`,
        }).catch(console.error));
      }
    } else {
      const ext = externals.find((e) => e.id === id);
      if (ext?.email) {
        jobs.push(mailer.send("meeting_schedule_changed_guest", ext.email, {
          appTitle: opts.appTitle, guestName: ext.name || "ゲスト", hostName, meetingTitle: meeting.title,
          changesText, actionNote, scheduleUrl: `${opts.appUrl}/schedule/${ext.token}`,
        }).catch(console.error));
      }
    }
  }
  opts.ctx.waitUntil(Promise.all(jobs));

  return { ok: true, summary };
}
