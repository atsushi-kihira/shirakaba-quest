// =============================================================
// 定例会（繰り返しミーティング）ルート（認証必要）
// POST   /api/meeting-series              — 作成（候補パターン付き・投票開始）
// GET    /api/meeting-series              — 自分が関係する定例会一覧
// GET    /api/meeting-series/:id          — 詳細（候補パターン・投票状況・確定後は開催回一覧）
// POST   /api/meeting-series/:id/respond  — 候補パターンへの投票
// PATCH  /api/meeting-series/:id/confirm  — 1つのパターンを確定し、終了条件までの開催回を一括生成
// DELETE /api/meeting-series/:id          — 定例会をキャンセル（未来の開催回もあわせてキャンセル）
// =============================================================
import { Hono } from "hono";
import { eq, and, or, inArray, gte } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId } from "../services/auth.ts";
import { resolveEffectiveMemberId, isMemberApproved } from "../services/resolve-member.ts";
import { MailService } from "../services/mailer.ts";
import { getFrontendUrl } from "../services/frontendUrl.ts";
import { computeOccurrences, type RecurrencePattern } from "../services/recurrence.ts";
import { getAvailableConferenceTypes, autoCreateConferenceForOccurrence, cancelAutoConference } from "../services/conferenceService.ts";
import type { Env, Variables } from "../types.ts";

type Availability = "yes" | "maybe" | "no";
const MAX_CANDIDATES = 5;

export const meetingSeriesRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
meetingSeriesRoutes.use("*", authMiddleware);

const RECURRENCE_LABEL: Record<RecurrencePattern["recurrenceType"], string> = {
  weekly: "毎週", biweekly: "隔週", monthly: "毎月",
};
const DOW_LABEL = ["日", "月", "火", "水", "木", "金", "土"];
const WEEK_LABEL: Record<number, string> = { 1: "第1", 2: "第2", 3: "第3", 4: "第4", 5: "第5", [-1]: "最終" };

function patternLabel(p: { recurrenceType: string; dayOfWeek: number; weekOfMonth: number | null; startTimeLocal: string; endTimeLocal: string }): string {
  const dow = DOW_LABEL[p.dayOfWeek] ?? "?";
  const prefix = p.recurrenceType === "monthly"
    ? `毎月${WEEK_LABEL[p.weekOfMonth ?? 1] ?? ""}${dow}曜`
    : `${RECURRENCE_LABEL[p.recurrenceType as RecurrencePattern["recurrenceType"]]}${dow}曜`;
  return `${prefix} ${p.startTimeLocal}〜${p.endTimeLocal}`;
}

// 表示・投票状況の対象メンバーには常にホストを含める（通常ミーティングの getTargetMembers と同じ扱い）。
// 開催回への招待（meetingInvitees）を作る際は呼び出し側でホストを除外して使う。
async function resolveSeriesMemberIds(
  db: ReturnType<typeof createDb>,
  series: { id: string; hostMemberId: string; scope: string; teamId?: string | null; collabTeamId: string | null }
): Promise<string[]> {
  let ids: string[] = [];
  if (series.scope === "all") {
    const rows = await db.select({ id: schema.members.id }).from(schema.members)
      .where(eq(schema.members.status, "active")).all();
    ids = rows.map((r) => r.id);
  } else if (series.scope === "team" && series.teamId) {
    const rows = await db.select({ memberId: schema.teamMembers.memberId })
      .from(schema.teamMembers).where(eq(schema.teamMembers.teamId, series.teamId)).all();
    ids = rows.map((r) => r.memberId);
  } else if (series.scope === "collab_team" && series.collabTeamId) {
    const rows = await db.select({ memberId: schema.collabTeamMembers.memberId })
      .from(schema.collabTeamMembers)
      .where(and(eq(schema.collabTeamMembers.teamId, series.collabTeamId), eq(schema.collabTeamMembers.status, "active")))
      .all();
    ids = rows.map((r) => r.memberId);
  } else if (series.scope === "selected") {
    const rows = await db.select({ memberId: schema.meetingSeriesInvitees.memberId })
      .from(schema.meetingSeriesInvitees).where(eq(schema.meetingSeriesInvitees.seriesId, series.id)).all();
    ids = rows.map((r) => r.memberId);
  }
  return [...new Set([series.hostMemberId, ...ids])];
}

// ----------------------------------------------------------------
// POST /api/meeting-series — 作成
// ----------------------------------------------------------------
const MAX_FIXED_DATES = 50;

meetingSeriesRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);
  if (!(await isMemberApproved(db, memberId))) {
    return c.json({ error: { code: "not_approved", message: "承認されるまでは定例会の作成はご利用いただけません" } }, 403);
  }
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    title: string;
    description?: string;
    scope: "all" | "team" | "collab_team" | "selected";
    teamId?: string;
    collabTeamId?: string;
    inviteeIds?: string[];
    deadline?: number;
    eventTypeDefId?: string;
    mode?: "vote" | "confirmed";
    dateMode?: "recurring" | "fixed";
    endCondition?: "date" | "count";
    endDate?: number;
    occurrenceCount?: number;
    conferenceType?: "manual" | "google_meet" | "zoom";
    conferenceUrl?: string;
    candidates?: Array<{
      recurrenceType: "weekly" | "biweekly" | "monthly";
      dayOfWeek: number;
      weekOfMonth?: number;
      startTimeLocal: string;
      endTimeLocal: string;
      note?: string;
    }>;
    fixedDates?: Array<{ startsAt: number; endsAt: number }>;
  }>();

  const mode: "vote" | "confirmed" = body.mode === "confirmed" ? "confirmed" : "vote";
  const dateMode: "recurring" | "fixed" = mode === "confirmed" && body.dateMode === "fixed" ? "fixed" : "recurring";

  if (!body.title?.trim()) return c.json({ error: { code: "invalid_input", message: "タイトルを入力してください" } }, 400);
  if (body.scope === "team" && !body.teamId) {
    return c.json({ error: { code: "invalid_input", message: "ギルドを指定してください" } }, 400);
  }
  if (body.scope === "collab_team" && !body.collabTeamId) {
    return c.json({ error: { code: "invalid_input", message: "対象チームを指定してください" } }, 400);
  }
  if (body.scope === "selected" && (!body.inviteeIds || body.inviteeIds.length === 0)) {
    return c.json({ error: { code: "invalid_input", message: "招待するメンバーを1人以上選んでください" } }, 400);
  }

  let manualConferenceUrl: string | undefined;
  if (body.conferenceType === "manual") {
    manualConferenceUrl = body.conferenceUrl?.trim();
    if (!manualConferenceUrl || !/^https?:\/\//.test(manualConferenceUrl)) {
      return c.json({ error: { code: "invalid_input", message: "会議URLは http:// または https:// で始めて入力してください" } }, 400);
    }
  } else if (body.conferenceType === "google_meet" || body.conferenceType === "zoom") {
    const available = await getAvailableConferenceTypes(db, memberId);
    if (!available.includes(body.conferenceType)) {
      return c.json({ error: { code: "not_connected", message: "指定した会議ツールと連携されていません" } }, 400);
    }
  }

  // 開催回の元データを検証・確定する（dateMode で分岐）。DB書き込みより先にすべて検証し、
  // 部分的に書き込まれた不整合な定例会が残らないようにする。
  let occurrences: Array<{ startsAt: number; endsAt: number }> = [];
  let scheduleLabel = "";
  let singleCandidate: {
    recurrenceType: "weekly" | "biweekly" | "monthly"; dayOfWeek: number; weekOfMonth: number | null;
    startTimeLocal: string; endTimeLocal: string; note?: string;
  } | null = null;
  let sortedFixedDates: Array<{ startsAt: number; endsAt: number }> = [];

  if (dateMode === "fixed") {
    if (!body.fixedDates || body.fixedDates.length === 0) {
      return c.json({ error: { code: "invalid_input", message: "確定日を1つ以上設定してください" } }, 400);
    }
    if (body.fixedDates.length > MAX_FIXED_DATES) {
      return c.json({ error: { code: "too_many_candidates", message: `確定日は${MAX_FIXED_DATES}件までです` } }, 400);
    }
    for (const d of body.fixedDates) {
      if (!d.startsAt || !d.endsAt || d.endsAt <= d.startsAt) {
        return c.json({ error: { code: "invalid_input", message: "確定日の日時指定が正しくありません" } }, 400);
      }
      if (d.startsAt < now) {
        return c.json({ error: { code: "past_date", message: "過去の日時は確定日に設定できません" } }, 400);
      }
    }
    sortedFixedDates = [...body.fixedDates].sort((a, b) => a.startsAt - b.startsAt);
    occurrences = sortedFixedDates;
    scheduleLabel = `個別日程（全${sortedFixedDates.length}回）`;
  } else {
    if (!body.candidates || body.candidates.length === 0) {
      return c.json({ error: { code: "invalid_input", message: "候補パターンを1つ以上設定してください" } }, 400);
    }
    if (mode === "confirmed" && body.candidates.length !== 1) {
      return c.json({ error: { code: "invalid_input", message: "確定日として作成する場合、パターンは1つだけ指定してください" } }, 400);
    }
    if (mode === "vote" && body.candidates.length > MAX_CANDIDATES) {
      return c.json({ error: { code: "too_many_candidates", message: `候補パターンは${MAX_CANDIDATES}個までです` } }, 400);
    }
    for (const cand of body.candidates) {
      if (!["weekly", "biweekly", "monthly"].includes(cand.recurrenceType)) {
        return c.json({ error: { code: "invalid_input", message: "繰り返しの種類が正しくありません" } }, 400);
      }
      if (cand.dayOfWeek < 0 || cand.dayOfWeek > 6) {
        return c.json({ error: { code: "invalid_input", message: "曜日の指定が正しくありません" } }, 400);
      }
      if (!/^\d{2}:\d{2}$/.test(cand.startTimeLocal) || !/^\d{2}:\d{2}$/.test(cand.endTimeLocal)) {
        return c.json({ error: { code: "invalid_input", message: "時刻の指定が正しくありません" } }, 400);
      }
      if (cand.startTimeLocal >= cand.endTimeLocal) {
        return c.json({ error: { code: "invalid_input", message: "終了時刻は開始時刻より後にしてください" } }, 400);
      }
    }
    if (body.endCondition === "date") {
      if (!body.endDate || body.endDate <= now) {
        return c.json({ error: { code: "invalid_input", message: "終了日は未来の日付を指定してください" } }, 400);
      }
    } else if (body.endCondition === "count") {
      if (!body.occurrenceCount || body.occurrenceCount < 1 || body.occurrenceCount > 200) {
        return c.json({ error: { code: "invalid_input", message: "開催回数は1〜200回で指定してください" } }, 400);
      }
    } else {
      return c.json({ error: { code: "invalid_input", message: "終了条件（日付 または 回数）を指定してください" } }, 400);
    }

    if (mode === "confirmed") {
      const cand = body.candidates[0];
      singleCandidate = {
        recurrenceType: cand.recurrenceType, dayOfWeek: cand.dayOfWeek,
        weekOfMonth: cand.recurrenceType === "monthly" ? (cand.weekOfMonth ?? 1) : null,
        startTimeLocal: cand.startTimeLocal, endTimeLocal: cand.endTimeLocal, note: cand.note?.trim() || undefined,
      };
      const pattern: RecurrencePattern = {
        recurrenceType: singleCandidate.recurrenceType, dayOfWeek: singleCandidate.dayOfWeek,
        weekOfMonth: singleCandidate.weekOfMonth, startTimeLocal: singleCandidate.startTimeLocal, endTimeLocal: singleCandidate.endTimeLocal,
      };
      occurrences = computeOccurrences(
        pattern, now,
        body.endCondition === "date" ? { type: "date", endDate: body.endDate! } : { type: "count", count: body.occurrenceCount! }
      );
      if (occurrences.length === 0) {
        return c.json({ error: { code: "invalid_input", message: "指定した条件では開催回が1つも作成できません" } }, 400);
      }
      scheduleLabel = patternLabel(singleCandidate);
    }
  }

  const seriesId = newId();
  await db.insert(schema.meetingSeries).values({
    id: seriesId,
    title: body.title.trim(),
    description: body.description?.trim() || null,
    hostMemberId: memberId,
    scope: body.scope,
    teamId: body.scope === "team" ? body.teamId ?? null : null,
    collabTeamId: body.scope === "collab_team" ? body.collabTeamId ?? null : null,
    status: mode === "confirmed" ? "confirmed" : "voting",
    deadline: body.deadline ?? null,
    endCondition: dateMode === "fixed" ? null : body.endCondition ?? null,
    endDate: dateMode === "recurring" && body.endCondition === "date" ? body.endDate ?? null : null,
    occurrenceCount: dateMode === "recurring" && body.endCondition === "count" ? body.occurrenceCount ?? null : null,
    conferenceType: body.conferenceType ?? null,
    conferenceUrl: manualConferenceUrl ?? null,
    dateMode,
    eventTypeDefId: body.eventTypeDefId ?? null,
    createdAt: now,
    updatedAt: now,
  });

  if (body.scope === "selected" && body.inviteeIds?.length) {
    for (const mid of body.inviteeIds) {
      await db.insert(schema.meetingSeriesInvitees).values({ id: newId(), seriesId, memberId: mid });
    }
  }

  if (mode === "vote") {
    for (let i = 0; i < body.candidates!.length; i++) {
      const cand = body.candidates![i];
      await db.insert(schema.meetingSeriesPatternCandidates).values({
        id: newId(),
        seriesId,
        recurrenceType: cand.recurrenceType,
        dayOfWeek: cand.dayOfWeek,
        weekOfMonth: cand.recurrenceType === "monthly" ? (cand.weekOfMonth ?? 1) : null,
        startTimeLocal: cand.startTimeLocal,
        endTimeLocal: cand.endTimeLocal,
        note: cand.note?.trim() || null,
        sortOrder: i,
      });
    }

    // 投票招待通知（既存ミーティングの招待メールテンプレートを流用する）
    const targetIds = await resolveSeriesMemberIds(db, { id: seriesId, hostMemberId: memberId, scope: body.scope, teamId: body.teamId ?? null, collabTeamId: body.collabTeamId ?? null });
    const targets = targetIds.length > 0
      ? await db.select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
          .from(schema.members).where(inArray(schema.members.id, targetIds)).all()
      : [];
    const host = await db.select({ name: schema.members.name }).from(schema.members).where(eq(schema.members.id, memberId)).get();
    const appUrl = getFrontendUrl(c.env);
    const design = await db.select({ appTitle: schema.cardDesigns.appTitle }).from(schema.cardDesigns).get();
    const mailer = new MailService(db, c.env);
    const mailPromises: Promise<void>[] = [];
    for (const m of targets) {
      if (m.id === memberId || !m.email) continue;
      mailPromises.push(
        mailer.send("meeting_invitation", m.email, {
          appTitle: design?.appTitle ?? "白樺クエスト",
          memberName: m.name,
          hostName: host?.name ?? "主催者",
          meetingTitle: `【定例会】${body.title.trim()}`,
          meetingDescription: body.description?.trim() ?? "",
          deadlineStr: "",
          meetingUrl: `${appUrl}/meetings/series/${seriesId}`,
        }).catch(console.error)
      );
    }
    c.executionCtx.waitUntil(Promise.all(mailPromises));

    return c.json({ data: { id: seriesId } }, 201);
  }

  // mode === "confirmed": 投票を経ずに、作成と同時に開催回を一括生成する
  if (dateMode === "fixed") {
    for (let i = 0; i < sortedFixedDates.length; i++) {
      await db.insert(schema.meetingSeriesFixedDates).values({
        id: newId(), seriesId, startsAt: sortedFixedDates[i].startsAt, endsAt: sortedFixedDates[i].endsAt, sortOrder: i,
      });
    }
  } else if (singleCandidate) {
    const candidateId = newId();
    await db.insert(schema.meetingSeriesPatternCandidates).values({
      id: candidateId, seriesId,
      recurrenceType: singleCandidate.recurrenceType, dayOfWeek: singleCandidate.dayOfWeek, weekOfMonth: singleCandidate.weekOfMonth,
      startTimeLocal: singleCandidate.startTimeLocal, endTimeLocal: singleCandidate.endTimeLocal,
      note: singleCandidate.note ?? null, sortOrder: 0, isConfirmed: 1,
    });
    await db.update(schema.meetingSeries).set({ confirmedPatternId: candidateId }).where(eq(schema.meetingSeries.id, seriesId));
  }

  const series = await db.select().from(schema.meetingSeries).where(eq(schema.meetingSeries.id, seriesId)).get();
  const result = await generateSeriesOccurrences(
    db, c.env, (p) => c.executionCtx.waitUntil(p),
    series!, occurrences, scheduleLabel, manualConferenceUrl,
  );

  return c.json({ data: { id: seriesId, occurrenceCount: result.occurrenceCount } }, 201);
});

// ----------------------------------------------------------------
// GET /api/meeting-series/conference-types — 自分が連携済みの会議ツール一覧（定例会作成フォーム用）
// ----------------------------------------------------------------
meetingSeriesRoutes.get("/conference-types", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ data: [] });
  const types = await getAvailableConferenceTypes(db, memberId);
  return c.json({ data: types });
});

// ----------------------------------------------------------------
// GET /api/meeting-series — 自分が関係する定例会一覧
// ----------------------------------------------------------------
meetingSeriesRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ data: [] });

  const all = await db.select().from(schema.meetingSeries).all();
  const myTeamIds = new Set(
    (await db.select({ teamId: schema.teamMembers.teamId }).from(schema.teamMembers)
      .where(eq(schema.teamMembers.memberId, memberId)).all())
      .map((r) => r.teamId)
  );
  const myCollabTeamIds = new Set(
    (await db.select({ teamId: schema.collabTeamMembers.teamId }).from(schema.collabTeamMembers)
      .where(and(eq(schema.collabTeamMembers.memberId, memberId), eq(schema.collabTeamMembers.status, "active"))).all())
      .map((r) => r.teamId)
  );
  const myInviteSeriesIds = new Set(
    (await db.select({ seriesId: schema.meetingSeriesInvitees.seriesId }).from(schema.meetingSeriesInvitees)
      .where(eq(schema.meetingSeriesInvitees.memberId, memberId)).all())
      .map((r) => r.seriesId)
  );

  const mine = all.filter((s) =>
    s.hostMemberId === memberId ||
    s.scope === "all" ||
    (s.scope === "team" && s.teamId && myTeamIds.has(s.teamId)) ||
    (s.scope === "collab_team" && s.collabTeamId && myCollabTeamIds.has(s.collabTeamId)) ||
    (s.scope === "selected" && myInviteSeriesIds.has(s.id))
  );

  const hostIds = [...new Set(mine.map((s) => s.hostMemberId))];
  const hosts = hostIds.length > 0
    ? await db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji })
        .from(schema.members).where(inArray(schema.members.id, hostIds)).all()
    : [];
  const hostMap = new Map(hosts.map((h) => [h.id, h]));

  // 投票中の定例会について、自分が既に何かに回答済みかどうか（通常ミーティングの hasResponded と同じ考え方）
  const votingSeriesIds = mine.filter((s) => s.status === "voting").map((s) => s.id);
  const myRespondedSeriesIds = votingSeriesIds.length > 0
    ? new Set(
        (await db.select({ seriesId: schema.meetingSeriesResponses.seriesId }).from(schema.meetingSeriesResponses)
          .where(and(inArray(schema.meetingSeriesResponses.seriesId, votingSeriesIds), eq(schema.meetingSeriesResponses.memberId, memberId))).all())
          .map((r) => r.seriesId)
      )
    : new Set<string>();

  const data = mine
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((s) => ({
      id: s.id, title: s.title, status: s.status,
      isHost: s.hostMemberId === memberId,
      hasResponded: myRespondedSeriesIds.has(s.id),
      host: hostMap.get(s.hostMemberId) ?? null,
    }));

  return c.json({ data });
});

// ----------------------------------------------------------------
// GET /api/meeting-series/:id — 詳細
// ----------------------------------------------------------------
meetingSeriesRoutes.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);
  const { id } = c.req.param();

  const series = await db.select().from(schema.meetingSeries).where(eq(schema.meetingSeries.id, id)).get();
  if (!series) return c.json({ error: { code: "not_found", message: "定例会が見つかりません" } }, 404);

  const candidates = await db.select().from(schema.meetingSeriesPatternCandidates)
    .where(eq(schema.meetingSeriesPatternCandidates.seriesId, id))
    .orderBy(schema.meetingSeriesPatternCandidates.sortOrder).all();

  const responses = await db.select().from(schema.meetingSeriesResponses)
    .where(eq(schema.meetingSeriesResponses.seriesId, id)).all();

  const targetIds = await resolveSeriesMemberIds(db, series);
  const targets = targetIds.length > 0
    ? await db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
        .from(schema.members).where(inArray(schema.members.id, targetIds)).all()
    : [];

  const respondentsByCandidate: Record<string, Array<{ memberId: string; name: string; emoji: string; availability: Availability }>> = {};
  for (const cand of candidates) respondentsByCandidate[cand.id] = [];
  const memberMap = new Map(targets.map((m) => [m.id, m]));
  for (const r of responses) {
    const m = memberMap.get(r.memberId);
    if (!m) continue;
    (respondentsByCandidate[r.candidateId] ??= []).push({ memberId: r.memberId, name: m.name, emoji: m.emoji, availability: r.availability as Availability });
  }

  const myResponses: Record<string, Availability> = {};
  for (const r of responses) if (r.memberId === memberId) myResponses[r.candidateId] = r.availability as Availability;

  let occurrences: Array<{ id: string; startsAt: number; endsAt: number | null; status: string; seriesOccurrenceIndex: number | null }> = [];
  if (series.status === "confirmed" || series.status === "ended" || series.status === "cancelled") {
    const meetingsRows = await db.select().from(schema.meetings).where(eq(schema.meetings.seriesId, id)).all();
    const candidateIds = meetingsRows.map((m) => m.confirmedCandidateId).filter((x): x is string => !!x);
    const dateCandidates = candidateIds.length > 0
      ? await db.select().from(schema.meetingDateCandidates).where(inArray(schema.meetingDateCandidates.id, candidateIds)).all()
      : [];
    const dateCandidateMap = new Map(dateCandidates.map((d) => [d.id, d]));
    occurrences = meetingsRows
      .map((m) => {
        const dc = m.confirmedCandidateId ? dateCandidateMap.get(m.confirmedCandidateId) : null;
        return {
          id: m.id, startsAt: dc?.startsAt ?? 0, endsAt: dc?.endsAt ?? null,
          status: m.status, seriesOccurrenceIndex: m.seriesOccurrenceIndex,
        };
      })
      .sort((a, b) => a.startsAt - b.startsAt);
  }

  return c.json({
    data: {
      id: series.id, title: series.title, description: series.description,
      hostMemberId: series.hostMemberId, isHost: series.hostMemberId === memberId,
      scope: series.scope, teamId: series.teamId, collabTeamId: series.collabTeamId,
      status: series.status, deadline: series.deadline,
      endCondition: series.endCondition, endDate: series.endDate, occurrenceCount: series.occurrenceCount,
      conferenceType: series.conferenceType,
      candidates: candidates.map((cand) => ({
        id: cand.id, recurrenceType: cand.recurrenceType, dayOfWeek: cand.dayOfWeek, weekOfMonth: cand.weekOfMonth,
        startTimeLocal: cand.startTimeLocal, endTimeLocal: cand.endTimeLocal, note: cand.note,
        label: patternLabel(cand), isConfirmed: cand.isConfirmed === 1,
        respondents: respondentsByCandidate[cand.id] ?? [],
      })),
      myResponses,
      targetMembers: targets,
      occurrences,
    },
  });
});

// ----------------------------------------------------------------
// POST /api/meeting-series/:id/respond — 候補パターンへの投票
// ----------------------------------------------------------------
meetingSeriesRoutes.post("/:id/respond", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);
  const { id } = c.req.param();
  const now = Math.floor(Date.now() / 1000);

  const series = await db.select().from(schema.meetingSeries).where(eq(schema.meetingSeries.id, id)).get();
  if (!series) return c.json({ error: { code: "not_found", message: "定例会が見つかりません" } }, 404);
  if (series.status !== "voting") {
    return c.json({ error: { code: "invalid_status", message: "投票を受け付けていません" } }, 400);
  }

  const { responses } = await c.req.json<{ responses: Record<string, Availability> }>();
  for (const [candidateId, availability] of Object.entries(responses ?? {})) {
    await db.delete(schema.meetingSeriesResponses)
      .where(and(eq(schema.meetingSeriesResponses.candidateId, candidateId), eq(schema.meetingSeriesResponses.memberId, memberId)));
    await db.insert(schema.meetingSeriesResponses).values({
      id: newId(), seriesId: id, candidateId, memberId, availability, comment: null, respondedAt: now,
    });
  }

  return c.json({ ok: true });
});

// ----------------------------------------------------------------
// 開催回の一括生成＋会議URL発行＋招待＋確定通知（投票後の確定・作成時点での即時確定の両方から呼ばれる）
// ----------------------------------------------------------------
type SeriesRow = typeof schema.meetingSeries.$inferSelect;
type OccurrenceConference = { conferenceType: "manual" | "google_meet" | "zoom"; conferenceUrl: string | null; conferenceMetaJson: string | null; calendarEventId: string | null };

async function generateSeriesOccurrences(
  db: ReturnType<typeof createDb>,
  env: Env,
  waitUntil: (p: Promise<unknown>) => void,
  series: SeriesRow,
  occurrences: Array<{ startsAt: number; endsAt: number }>,
  scheduleLabel: string,
  manualConferenceUrl?: string,
): Promise<{ occurrenceCount: number; createdMeetingIds: string[] }> {
  const now = Math.floor(Date.now() / 1000);
  const memberIds = await resolveSeriesMemberIds(db, series);
  const inviteeIds = memberIds.filter((mid) => mid !== series.hostMemberId);

  const createdMeetingIds: string[] = [];
  for (let i = 0; i < occurrences.length; i++) {
    const occ = occurrences[i];
    const meetingId = newId();
    const dateLabel = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" }).format(new Date(occ.startsAt * 1000));

    // 会議ツールが指定されていれば、この回の会議URLを先に発行しておく（失敗しても開催回自体は作成する）
    let conf: OccurrenceConference | null = null;
    if (manualConferenceUrl) {
      conf = { conferenceType: "manual", conferenceUrl: manualConferenceUrl, conferenceMetaJson: null, calendarEventId: null };
    } else if (series.conferenceType === "google_meet" || series.conferenceType === "zoom") {
      conf = await autoCreateConferenceForOccurrence(
        db, env, series.hostMemberId, series.conferenceType,
        `${series.title}（第${i + 1}回・${dateLabel}）`, series.description ?? "",
        occ.startsAt, occ.endsAt
      );
    }

    await db.insert(schema.meetings).values({
      id: meetingId,
      title: `${series.title}（第${i + 1}回・${dateLabel}）`,
      description: series.description,
      hostMemberId: series.hostMemberId,
      scope: "selected",
      status: "confirmed",
      eventTypeDefId: series.eventTypeDefId,
      seriesId: series.id,
      seriesOccurrenceIndex: i + 1,
      conferenceType: conf?.conferenceType ?? "manual",
      conferenceUrl: conf?.conferenceUrl ?? null,
      conferenceMetaJson: conf?.conferenceMetaJson ?? null,
      calendarEventId: conf?.calendarEventId ?? null,
      createdAt: now,
      updatedAt: now,
    });
    const candidateId = newId();
    await db.insert(schema.meetingDateCandidates).values({
      id: candidateId, meetingId, startsAt: occ.startsAt, endsAt: occ.endsAt,
      sortOrder: 0, isConfirmed: 1, addedByMemberId: series.hostMemberId,
      conferenceUrl: conf?.conferenceUrl ?? null,
    });
    await db.update(schema.meetings).set({ confirmedCandidateId: candidateId }).where(eq(schema.meetings.id, meetingId));
    for (const mid of inviteeIds) {
      await db.insert(schema.meetingInvitees).values({ id: newId(), meetingId, memberId: mid });
    }
    createdMeetingIds.push(meetingId);
  }

  // 確定通知（開催回ごとにメールは送らず、シリーズ確定として1通にまとめる）
  const targets = inviteeIds.length > 0
    ? await db.select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
        .from(schema.members).where(inArray(schema.members.id, inviteeIds)).all()
    : [];
  const host = await db.select({ name: schema.members.name, email: schema.members.email }).from(schema.members).where(eq(schema.members.id, series.hostMemberId)).get();
  const appUrl = getFrontendUrl(env);
  const design = await db.select({ appTitle: schema.cardDesigns.appTitle }).from(schema.cardDesigns).get();
  const mailer = new MailService(db, env);
  const firstDate = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" }).format(new Date(occurrences[0].startsAt * 1000));
  const confNote = manualConferenceUrl
    ? "会議URLは毎回同じURLをご利用ください。"
    : series.conferenceType ? "会議URLも各回に自動で発行されます。" : "";
  const notifyMsg = `「${series.title}」が「${scheduleLabel}」で確定しました（全${occurrences.length}回、初回：${firstDate}〜）${confNote}`;
  const confirmedDateText = `${scheduleLabel}（全${occurrences.length}回、初回：${firstDate}〜）`;
  const mailPromises: Promise<void>[] = [];
  for (const m of targets) {
    await db.insert(schema.meetingNotifications).values({
      id: newId(), meetingId: createdMeetingIds[0], memberId: m.id, type: "confirmed", message: notifyMsg, readAt: null, createdAt: now,
    });
    if (m.email) {
      mailPromises.push(
        mailer.send("meeting_confirmed_member", m.email, {
          appTitle: design?.appTitle ?? "白樺クエスト", memberName: m.name, meetingTitle: `【定例会】${series.title}`,
          hostName: host?.name ?? "主催者", confirmedDate: confirmedDateText,
          urlPendingNote: "", meetingUrl: `${appUrl}/meetings/series/${series.id}`,
        }).catch(console.error)
      );
    }
  }
  if (host?.email) {
    mailPromises.push(
      mailer.send("meeting_confirmed_member", host.email, {
        appTitle: design?.appTitle ?? "白樺クエスト", memberName: host.name, meetingTitle: `【定例会】${series.title}`,
        hostName: host.name, confirmedDate: confirmedDateText,
        urlPendingNote: "", meetingUrl: `${appUrl}/meetings/series/${series.id}`,
      }).catch(console.error)
    );
  }
  waitUntil(Promise.all(mailPromises));

  return { occurrenceCount: occurrences.length, createdMeetingIds };
}

// ----------------------------------------------------------------
// PATCH /api/meeting-series/:id/confirm — パターン確定＋全開催回を一括生成
// ----------------------------------------------------------------
meetingSeriesRoutes.patch("/:id/confirm", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);
  const { id } = c.req.param();
  const now = Math.floor(Date.now() / 1000);

  const series = await db.select().from(schema.meetingSeries).where(eq(schema.meetingSeries.id, id)).get();
  if (!series) return c.json({ error: { code: "not_found", message: "定例会が見つかりません" } }, 404);
  if (series.hostMemberId !== memberId) return c.json({ error: { code: "forbidden", message: "主催者のみ確定できます" } }, 403);
  if (series.status !== "voting") return c.json({ error: { code: "invalid_status", message: "すでに確定またはキャンセル済みです" } }, 400);

  const body = await c.req.json<{ candidateId: string }>();
  const candidate = await db.select().from(schema.meetingSeriesPatternCandidates)
    .where(and(eq(schema.meetingSeriesPatternCandidates.id, body.candidateId), eq(schema.meetingSeriesPatternCandidates.seriesId, id)))
    .get();
  if (!candidate) return c.json({ error: { code: "invalid_input", message: "候補パターンが見つかりません" } }, 400);

  // 終了条件は作成時に必須指定済み。念のため再検証する（終了日が既に過ぎている等）。
  if (series.endCondition === "date") {
    if (!series.endDate || series.endDate <= now) {
      return c.json({ error: { code: "invalid_input", message: "終了日を過ぎています。定例会を作り直してください" } }, 400);
    }
  } else if (series.endCondition === "count") {
    if (!series.occurrenceCount || series.occurrenceCount < 1 || series.occurrenceCount > 200) {
      return c.json({ error: { code: "invalid_input", message: "開催回数の指定が不正です" } }, 400);
    }
  } else {
    return c.json({ error: { code: "invalid_input", message: "終了条件が設定されていません" } }, 400);
  }

  const pattern: RecurrencePattern = {
    recurrenceType: candidate.recurrenceType as RecurrencePattern["recurrenceType"],
    dayOfWeek: candidate.dayOfWeek,
    weekOfMonth: candidate.weekOfMonth,
    startTimeLocal: candidate.startTimeLocal,
    endTimeLocal: candidate.endTimeLocal,
  };
  const occurrences = computeOccurrences(
    pattern, now,
    series.endCondition === "date" ? { type: "date", endDate: series.endDate! } : { type: "count", count: series.occurrenceCount! }
  );
  if (occurrences.length === 0) {
    return c.json({ error: { code: "invalid_input", message: "指定した条件では開催回が1つも作成できません" } }, 400);
  }

  await db.update(schema.meetingSeriesPatternCandidates).set({ isConfirmed: 1 }).where(eq(schema.meetingSeriesPatternCandidates.id, candidate.id));
  await db.update(schema.meetingSeries).set({
    status: "confirmed",
    confirmedPatternId: candidate.id,
    updatedAt: now,
  }).where(eq(schema.meetingSeries.id, id));

  const result = await generateSeriesOccurrences(
    db, c.env, (p) => c.executionCtx.waitUntil(p),
    series, occurrences, patternLabel(candidate),
    series.conferenceType === "manual" ? (series.conferenceUrl ?? undefined) : undefined,
  );

  return c.json({ data: { occurrenceCount: result.occurrenceCount } });
});

// ----------------------------------------------------------------
// DELETE /api/meeting-series/:id — 定例会をキャンセル
// ----------------------------------------------------------------
meetingSeriesRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);
  const { id } = c.req.param();
  const now = Math.floor(Date.now() / 1000);

  const series = await db.select().from(schema.meetingSeries).where(eq(schema.meetingSeries.id, id)).get();
  if (!series) return c.json({ error: { code: "not_found", message: "定例会が見つかりません" } }, 404);
  if (series.hostMemberId !== memberId) return c.json({ error: { code: "forbidden", message: "主催者のみキャンセルできます" } }, 403);

  await db.update(schema.meetingSeries).set({ status: "cancelled", updatedAt: now }).where(eq(schema.meetingSeries.id, id));

  // まだ開催されていない（開始前の）回だけキャンセルする。過去の回は履歴として残す。
  const futureMeetings = await db.select().from(schema.meetings)
    .where(and(eq(schema.meetings.seriesId, id), or(eq(schema.meetings.status, "confirmed"), eq(schema.meetings.status, "open"))))
    .all();
  const candidateIds = futureMeetings.map((m) => m.confirmedCandidateId).filter((x): x is string => !!x);
  const dateCandidates = candidateIds.length > 0
    ? await db.select({ id: schema.meetingDateCandidates.id, startsAt: schema.meetingDateCandidates.startsAt }).from(schema.meetingDateCandidates)
        .where(inArray(schema.meetingDateCandidates.id, candidateIds)).all()
    : [];
  const startsAtMap = new Map(dateCandidates.map((d) => [d.id, d.startsAt]));
  const toCancel = futureMeetings.filter((m) => {
    const startsAt = m.confirmedCandidateId ? startsAtMap.get(m.confirmedCandidateId) : undefined;
    return !startsAt || startsAt >= now;
  });
  if (toCancel.length > 0) {
    await db.update(schema.meetings).set({ status: "cancelled", updatedAt: now })
      .where(inArray(schema.meetings.id, toCancel.map((m) => m.id)));
    // 自動発行済みの会議URLもあわせてキャンセル（失敗しても致命的ではない）
    c.executionCtx.waitUntil(Promise.all(
      toCancel
        .filter((m) => m.conferenceType === "zoom" || m.conferenceType === "google_meet")
        .map((m) => cancelAutoConference(db, c.env, series.hostMemberId, m.conferenceType, m.conferenceMetaJson, m.calendarEventId))
    ));
  }

  return c.json({ ok: true, cancelledOccurrences: toCancel.length });
});
