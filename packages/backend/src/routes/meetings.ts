// =============================================================
// ミーティング（日程調整）ルート（認証必要）
// POST   /api/meetings                      — 作成
// GET    /api/meetings                      — 自分が関係する会の一覧
// GET    /api/meetings/upcoming             — 確定済み近日ミーティング（ホーム用）
// GET    /api/meetings/notifications        — 未読通知一覧
// POST   /api/meetings/notifications/read-all — 全通知既読
// GET    /api/meetings/:id                  — 詳細（グリッドデータ含む）
// POST   /api/meetings/:id/respond          — 自分の回答を投稿・更新
// PATCH  /api/meetings/:id/confirm          — 日程確定（主催者のみ）＋メール通知
// PATCH  /api/meetings/:id/description      — 詳細情報更新（主催者のみ）＋メール通知
// POST   /api/meetings/:id/read-notifications — このミーティングの通知を既読にする
// DELETE /api/meetings/:id                  — キャンセル（主催者のみ）
// POST   /api/meetings/:id/external         — 外部招待URLを生成
// POST   /api/meetings/:id/invite-member    — メンバーを追加招待（ステータス不問）
// DELETE /api/meetings/:id/invitees/:memberId    — メンバー招待を削除
// DELETE /api/meetings/:id/external/:externalId  — 外部ゲスト招待を削除
// =============================================================
import { Hono } from "hono";
import { eq, inArray, and, sql, isNull } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId, generateRawToken } from "../services/auth.ts";
import {
  sendMeetingInvitationMail,
  sendMeetingConfirmedMemberMail,
  sendMeetingConfirmedGuestMail,
  sendMeetingDetailsUpdatedMemberMail,
  sendMeetingDetailsUpdatedGuestMail,
} from "../services/mailer.ts";
import type { Env, Variables } from "../types.ts";

type Availability = "yes" | "maybe" | "no";

export const meetingRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
meetingRoutes.use("*", authMiddleware);

// ----------------------------------------------------------------
// POST /api/meetings — 作成
// ----------------------------------------------------------------
meetingRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    title: string;
    description?: string;
    scope: "all" | "team" | "selected";
    teamId?: string;
    inviteeIds?: string[];   // scope=selected 用
    deadline?: number;
    eventCampaignId?: string;
    eventTypeDefId?: string;
    registrationDeadline?: number;
    candidates: Array<{ startsAt: number; endsAt?: number; note?: string }>;
  }>();

  if (!body.title?.trim()) {
    return c.json({ error: { code: "invalid_input", message: "タイトルを入力してください" } }, 400);
  }
  if (!body.candidates || body.candidates.length === 0) {
    return c.json({ error: { code: "invalid_input", message: "候補日を1つ以上設定してください" } }, 400);
  }

  const meetingId = newId();

  await db.insert(schema.meetings).values({
    id: meetingId,
    title: body.title.trim(),
    description: body.description?.trim() || null,
    hostMemberId: memberId,
    scope: body.scope ?? "all",
    teamId: body.teamId ?? null,
    status: "open",
    confirmedCandidateId: null,
    deadline: body.deadline ?? null,
    eventCampaignId: body.eventCampaignId ?? null,
    eventTypeDefId: body.eventTypeDefId ?? null,
    registrationDeadline: body.registrationDeadline ?? null,
    createdAt: now,
    updatedAt: now,
  });

  // 候補日を挿入
  for (let i = 0; i < body.candidates.length; i++) {
    const c2 = body.candidates[i];
    await db.insert(schema.meetingDateCandidates).values({
      id: newId(),
      meetingId,
      startsAt: c2.startsAt,
      endsAt: c2.endsAt ?? null,
      note: c2.note ?? null,
      sortOrder: i,
    });
  }

  // scope=selected の場合は招待メンバーを挿入
  if (body.scope === "selected" && body.inviteeIds?.length) {
    for (const mid of body.inviteeIds) {
      await db.insert(schema.meetingInvitees).values({
        id: newId(),
        meetingId,
        memberId: mid,
      });
    }
  }

  // 招待メール送信（主催者を除く対象メンバーへ）
  const tempMeeting = { id: meetingId, scope: body.scope ?? "all", teamId: body.teamId ?? null, hostMemberId: memberId };
  const inviteTargets = await getTargetMembers(db, tempMeeting);
  const host = await db.select({ name: schema.members.name }).from(schema.members)
    .where(eq(schema.members.id, memberId)).get();
  const hostName = host?.name ?? "主催者";
  const isDev = c.env.ENVIRONMENT !== "production";
  const appUrl = c.env.CORS_ORIGIN ?? "https://shirakaba-quest.pages.dev";
  const systemTzForInvite = (await db.select({ timezone: schema.cardDesigns.timezone }).from(schema.cardDesigns).get())?.timezone ?? "Asia/Tokyo";

  for (const m of inviteTargets) {
    if (m.id === memberId || !m.email) continue;
    sendMeetingInvitationMail({
      to: m.email,
      memberName: m.name,
      meetingTitle: body.title.trim(),
      hostName,
      description: body.description?.trim() || null,
      deadline: body.deadline ?? null,
      appUrl,
      meetingId,
      appTitle: "白樺クエスト",
      apiKey: c.env.SENDGRID_API_KEY,
      isDev,
      fromEmail: c.env.SENDGRID_FROM_EMAIL,
      timezone: systemTzForInvite,
    }).catch(console.error);
  }

  return c.json({ data: { id: meetingId } }, 201);
});

// ----------------------------------------------------------------
// GET /api/meetings/upcoming — ホーム画面用の近日確定ミーティング
// ----------------------------------------------------------------
meetingRoutes.get("/upcoming", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);
  const weekLater = now + 7 * 86400;

  // 確定済みミーティング一覧
  const confirmed = await db
    .select()
    .from(schema.meetings)
    .where(eq(schema.meetings.status, "confirmed"))
    .all();

  if (confirmed.length === 0) return c.json({ data: [] });

  // 候補日を確定候補IDで絞り込み
  const candidateIds = confirmed.map((m) => m.confirmedCandidateId).filter(Boolean) as string[];
  const candidates = await db
    .select()
    .from(schema.meetingDateCandidates)
    .where(inArray(schema.meetingDateCandidates.id, candidateIds))
    .all();

  const candidateMap = new Map(candidates.map((c) => [c.id, c]));

  // 近日（7日以内）のもの
  const upcoming = confirmed.filter((m) => {
    if (!m.confirmedCandidateId) return false;
    const cand = candidateMap.get(m.confirmedCandidateId);
    if (!cand) return false;
    return cand.startsAt >= now && cand.startsAt <= weekLater;
  });

  if (upcoming.length === 0) return c.json({ data: [] });

  // 私が関わっているかチェック
  const upcomingIds = upcoming.map((m) => m.id);

  // 自分が "yes" で回答したミーティング
  const yesResponses = await db
    .select({ meetingId: schema.meetingResponses.meetingId })
    .from(schema.meetingResponses)
    .where(
      and(
        inArray(schema.meetingResponses.meetingId, upcomingIds),
        eq(schema.meetingResponses.memberId, memberId),
        eq(schema.meetingResponses.availability, "yes")
      )
    )
    .all();
  const yesSet = new Set(yesResponses.map((r) => r.meetingId));

  // チームメンバーシップ確認
  const teamIds = upcoming.filter((m) => m.scope === "team" && m.teamId).map((m) => m.teamId!) ;
  const myTeamIds = teamIds.length > 0
    ? (await db
        .select({ teamId: schema.teamMembers.teamId })
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.memberId, memberId))
        .all()
      ).map((r) => r.teamId)
    : [];

  // scope=selected の招待確認
  const selectedMeetingIds = upcoming.filter((m) => m.scope === "selected").map((m) => m.id);
  const invitedIds = selectedMeetingIds.length > 0
    ? (await db
        .select({ meetingId: schema.meetingInvitees.meetingId })
        .from(schema.meetingInvitees)
        .where(
          and(
            inArray(schema.meetingInvitees.meetingId, selectedMeetingIds),
            eq(schema.meetingInvitees.memberId, memberId)
          )
        )
        .all()
      ).map((r) => r.meetingId)
    : [];
  const invitedSet = new Set(invitedIds);

  const relevant = upcoming.filter((m) => {
    if (m.hostMemberId === memberId) return true;
    if (m.scope === "all") return yesSet.has(m.id) || true; // all = 全員
    if (m.scope === "team") return myTeamIds.includes(m.teamId ?? "");
    if (m.scope === "selected") return invitedSet.has(m.id);
    return false;
  });

  // 主催者情報を付与
  const hostIds = [...new Set(relevant.map((m) => m.hostMemberId))];
  const hosts = hostIds.length > 0
    ? await db
        .select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji })
        .from(schema.members)
        .where(inArray(schema.members.id, hostIds))
        .all()
    : [];
  const hostMap = new Map(hosts.map((h) => [h.id, h]));

  return c.json({
    data: relevant.map((m) => {
      const cand = candidateMap.get(m.confirmedCandidateId!);
      return {
        id: m.id,
        title: m.title,
        description: m.description,
        host: hostMap.get(m.hostMemberId) ?? null,
        isHost: m.hostMemberId === memberId,
        confirmedDate: cand ? { startsAt: cand.startsAt, endsAt: cand.endsAt } : null,
        createdAt: m.createdAt,
      };
    }),
  });
});

// ----------------------------------------------------------------
// GET /api/meetings — 自分が関係する会の一覧
// ----------------------------------------------------------------
meetingRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");

  // 主催ミーティング
  const hosted = await db
    .select()
    .from(schema.meetings)
    .where(eq(schema.meetings.hostMemberId, memberId))
    .all();

  // scope=all の全員対象ミーティング（主催除く）
  const allScope = await db
    .select()
    .from(schema.meetings)
    .where(and(eq(schema.meetings.scope, "all"), sql`${schema.meetings.hostMemberId} != ${memberId}`))
    .all();

  // 自分が招待されている selected ミーティング
  const inviteRows = await db
    .select({ meetingId: schema.meetingInvitees.meetingId })
    .from(schema.meetingInvitees)
    .where(eq(schema.meetingInvitees.memberId, memberId))
    .all();
  const invitedMeetingIds = inviteRows.map((r) => r.meetingId);

  const selectedInvited = invitedMeetingIds.length > 0
    ? await db
        .select()
        .from(schema.meetings)
        .where(inArray(schema.meetings.id, invitedMeetingIds))
        .all()
    : [];

  // チームミーティング
  const myTeams = await db
    .select({ teamId: schema.teamMembers.teamId })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.memberId, memberId))
    .all();
  const myTeamIds = myTeams.map((r) => r.teamId);

  const teamMeetings = myTeamIds.length > 0
    ? await db
        .select()
        .from(schema.meetings)
        .where(
          and(
            eq(schema.meetings.scope, "team"),
            inArray(schema.meetings.teamId, myTeamIds),
            sql`${schema.meetings.hostMemberId} != ${memberId}`
          )
        )
        .all()
    : [];

  // 重複排除して統合
  const seen = new Set<string>();
  const all: typeof hosted = [];
  for (const m of [...hosted, ...allScope, ...selectedInvited, ...teamMeetings]) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      all.push(m);
    }
  }

  // 確定候補日情報を取得
  const confCandIds = all.map((m) => m.confirmedCandidateId).filter(Boolean) as string[];
  const confCandidates = confCandIds.length > 0
    ? await db
        .select()
        .from(schema.meetingDateCandidates)
        .where(inArray(schema.meetingDateCandidates.id, confCandIds))
        .all()
    : [];
  const confCandMap = new Map(confCandidates.map((c) => [c.id, c]));

  // 候補日数取得
  const meetingIds = all.map((m) => m.id);
  const candidateCounts = meetingIds.length > 0
    ? await db
        .select({
          meetingId: schema.meetingDateCandidates.meetingId,
          count: sql<number>`count(*)`.as("count"),
        })
        .from(schema.meetingDateCandidates)
        .where(inArray(schema.meetingDateCandidates.meetingId, meetingIds))
        .groupBy(schema.meetingDateCandidates.meetingId)
        .all()
    : [];
  const countMap = new Map(candidateCounts.map((r) => [r.meetingId, Number(r.count)]));

  // 主催者情報
  const hostIds = [...new Set(all.map((m) => m.hostMemberId))];
  const hosts = hostIds.length > 0
    ? await db
        .select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
        .from(schema.members)
        .where(inArray(schema.members.id, hostIds))
        .all()
    : [];
  const hostMap = new Map(hosts.map((h) => [h.id, h]));

  // 自分の回答有無
  const myResponses = meetingIds.length > 0
    ? await db
        .select({ meetingId: schema.meetingResponses.meetingId })
        .from(schema.meetingResponses)
        .where(
          and(
            inArray(schema.meetingResponses.meetingId, meetingIds),
            eq(schema.meetingResponses.memberId, memberId)
          )
        )
        .all()
    : [];
  const respondedSet = new Set(myResponses.map((r) => r.meetingId));

  const result = all
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((m) => {
      const confCand = m.confirmedCandidateId ? confCandMap.get(m.confirmedCandidateId) : null;
      return {
        id: m.id,
        title: m.title,
        description: m.description,
        host: hostMap.get(m.hostMemberId) ?? null,
        isHost: m.hostMemberId === memberId,
        scope: m.scope,
        status: m.status,
        candidateCount: countMap.get(m.id) ?? 0,
        deadline: m.deadline,
        registrationDeadline: m.registrationDeadline,
        confirmedDate: confCand ? { startsAt: confCand.startsAt, endsAt: confCand.endsAt } : null,
        hasResponded: respondedSet.has(m.id),
        createdAt: m.createdAt,
      };
    });

  return c.json({ data: result });
});

// ----------------------------------------------------------------
// GET /api/meetings/notifications — 未読通知一覧（ホーム画面用）
// ----------------------------------------------------------------
meetingRoutes.get("/notifications", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");

  const rows = await db
    .select()
    .from(schema.meetingNotifications)
    .where(
      and(
        eq(schema.meetingNotifications.memberId, memberId),
        isNull(schema.meetingNotifications.readAt)
      )
    )
    .all();

  return c.json({ data: rows });
});

// ----------------------------------------------------------------
// POST /api/meetings/notifications/read-all — 全通知既読
// ----------------------------------------------------------------
meetingRoutes.post("/notifications/read-all", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);

  await db
    .update(schema.meetingNotifications)
    .set({ readAt: now })
    .where(
      and(
        eq(schema.meetingNotifications.memberId, memberId),
        isNull(schema.meetingNotifications.readAt)
      )
    );

  return c.json({ ok: true });
});

// ----------------------------------------------------------------
// GET /api/meetings/pending-attendance — 出席確認が必要なミーティング（ホーム画面用）
// ----------------------------------------------------------------
meetingRoutes.get("/pending-attendance", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);

  // 確定済みで時間が過ぎたミーティングを取得
  const confirmedMeetings = await db.select().from(schema.meetings)
    .where(eq(schema.meetings.status, "confirmed"))
    .all();

  // すでに自分の出席記録があるミーティングID
  const attendedIds = new Set(
    (await db.select({ meetingId: schema.meetingAttendances.meetingId })
      .from(schema.meetingAttendances)
      .where(eq(schema.meetingAttendances.memberId, memberId))
      .all()).map((a) => a.meetingId)
  );

  const result = [];
  for (const meeting of confirmedMeetings) {
    if (attendedIds.has(meeting.id)) continue;

    // 確定済み候補日のうち最も早い日時が過去か確認
    const confirmedCands = await db
      .select({ startsAt: schema.meetingDateCandidates.startsAt })
      .from(schema.meetingDateCandidates)
      .where(and(
        eq(schema.meetingDateCandidates.meetingId, meeting.id),
        eq(schema.meetingDateCandidates.isConfirmed, 1)
      ))
      .orderBy(schema.meetingDateCandidates.startsAt)
      .all();
    const earliest = confirmedCands[0];
    if (!earliest || earliest.startsAt >= now) continue;

    // 自分がこのミーティングの対象か確認
    const targets = await getTargetMembers(db, meeting);
    const isTarget = targets.some((m) => m.id === memberId) || meeting.hostMemberId === memberId;
    if (!isTarget) continue;

    result.push({ id: meeting.id, title: meeting.title, confirmedStartsAt: earliest.startsAt });
  }

  return c.json({ data: result });
});

// ----------------------------------------------------------------
// GET /api/meetings/:id — 詳細（グリッドデータ含む）
// ----------------------------------------------------------------
meetingRoutes.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");
  const { id } = c.req.param();

  const meeting = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id)).get();
  if (!meeting) return c.json({ error: { code: "not_found", message: "ミーティングが見つかりません" } }, 404);

  // 候補日
  const candidates = await db
    .select()
    .from(schema.meetingDateCandidates)
    .where(eq(schema.meetingDateCandidates.meetingId, id))
    .orderBy(schema.meetingDateCandidates.sortOrder)
    .all();

  // 全回答
  const allResponses = await db
    .select()
    .from(schema.meetingResponses)
    .where(eq(schema.meetingResponses.meetingId, id))
    .all();

  // 回答したメンバーのID一覧
  const respondingMemberIds = [...new Set(allResponses.map((r) => r.memberId).filter(Boolean) as string[])];

  // 対象メンバー一覧（scope によって異なる）
  let targetMembers: Array<{ id: string; name: string; emoji: string; bgColor: string }> = [];
  if (meeting.scope === "all") {
    targetMembers = await db
      .select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
      .from(schema.members)
      .where(eq(schema.members.status, "active"))
      .all();
  } else if (meeting.scope === "team" && meeting.teamId) {
    const teamMemberRows = await db
      .select({ memberId: schema.teamMembers.memberId })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.teamId, meeting.teamId))
      .all();
    const tmIds = teamMemberRows.map((r) => r.memberId);
    if (tmIds.length > 0) {
      targetMembers = await db
        .select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
        .from(schema.members)
        .where(and(inArray(schema.members.id, tmIds), eq(schema.members.status, "active")))
        .all();
    }
  } else if (meeting.scope === "selected") {
    const invitees = await db
      .select({ memberId: schema.meetingInvitees.memberId })
      .from(schema.meetingInvitees)
      .where(eq(schema.meetingInvitees.meetingId, id))
      .all();
    const inviteeIds = invitees.map((r) => r.memberId);
    // ホストも含める
    const allIds = [...new Set([meeting.hostMemberId, ...inviteeIds])];
    targetMembers = await db
      .select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
      .from(schema.members)
      .where(inArray(schema.members.id, allIds))
      .all();
  }

  // scope=all/team でも実際に回答したメンバーを追加で補完
  const targetMemberIds = new Set(targetMembers.map((m) => m.id));
  const extraIds = respondingMemberIds.filter((mid) => !targetMemberIds.has(mid));
  let extraMembers: Array<{ id: string; name: string; emoji: string; bgColor: string }> = [];
  if (extraIds.length > 0) {
    extraMembers = await db
      .select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
      .from(schema.members)
      .where(inArray(schema.members.id, extraIds))
      .all();
  }
  const allTargetMembers = [...targetMembers, ...extraMembers];

  // ホスト情報
  const host = allTargetMembers.find((m) => m.id === meeting.hostMemberId)
    ?? (await db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
        .from(schema.members).where(eq(schema.members.id, meeting.hostMemberId)).get());

  // 外部招待者
  const externalInvitees = await db
    .select()
    .from(schema.meetingExternalInvitees)
    .where(eq(schema.meetingExternalInvitees.meetingId, id))
    .all();

  // 回答をグリッド構造に変換
  const responseByCandidateAndMember = new Map<string, Map<string, Availability>>();
  const responseByCandidateAndExternal = new Map<string, Map<string, Availability>>();
  for (const r of allResponses) {
    if (r.memberId) {
      if (!responseByCandidateAndMember.has(r.candidateId)) {
        responseByCandidateAndMember.set(r.candidateId, new Map());
      }
      responseByCandidateAndMember.get(r.candidateId)!.set(r.memberId, r.availability as Availability);
    } else if (r.externalInviteeId) {
      if (!responseByCandidateAndExternal.has(r.candidateId)) {
        responseByCandidateAndExternal.set(r.candidateId, new Map());
      }
      responseByCandidateAndExternal.get(r.candidateId)!.set(r.externalInviteeId, r.availability as Availability);
    }
  }

  // 各メンバーの回答マップ
  const memberRespondents = allTargetMembers.map((m) => {
    const answers: Record<string, Availability> = {};
    for (const cand of candidates) {
      const a = responseByCandidateAndMember.get(cand.id)?.get(m.id);
      if (a) answers[cand.id] = a;
    }
    return {
      type: "member" as const,
      id: m.id,
      name: m.name,
      emoji: m.emoji,
      bgColor: m.bgColor,
      answers,
      hasResponded: Object.keys(answers).length > 0,
    };
  });

  // 各外部招待者の回答マップ
  const externalRespondents = externalInvitees.map((ext) => {
    const answers: Record<string, Availability> = {};
    for (const cand of candidates) {
      const a = responseByCandidateAndExternal.get(cand.id)?.get(ext.id);
      if (a) answers[cand.id] = a;
    }
    return {
      type: "external" as const,
      id: ext.id,
      name: ext.name || "（未回答）",
      emoji: "👤",
      bgColor: "bg-gray-100",
      answers,
      hasResponded: Object.keys(answers).length > 0,
    };
  });

  // 自分の回答
  const myAnswers: Record<string, Availability> = {};
  for (const r of allResponses) {
    if (r.memberId === memberId) myAnswers[r.candidateId] = r.availability as Availability;
  }

  // 紐付きイベント
  let linkedEvent: { id: string; title: string; multiplier: number | null } | null = null;
  if (meeting.eventCampaignId) {
    const ev = await db.select({ id: schema.eventCampaigns.id, title: schema.eventCampaigns.title, multiplier: schema.eventCampaigns.multiplier })
      .from(schema.eventCampaigns)
      .where(eq(schema.eventCampaigns.id, meeting.eventCampaignId))
      .get();
    linkedEvent = ev ?? null;
  }

  // 出席記録
  const attendanceRows = await db.select()
    .from(schema.meetingAttendances)
    .where(eq(schema.meetingAttendances.meetingId, id))
    .all();
  const myAttendance = attendanceRows.find((a) => a.memberId === memberId) ?? null;

  // 確定済み候補日（複数対応）— 最も早い日時を confirmedStartsAt として返す
  // 旧形式（isConfirmed が未設定）の確定済みミーティングは confirmedCandidateId を参照してフォールバック
  let confirmedCandidates = candidates
    .filter((c) => c.isConfirmed === 1)
    .sort((a, b) => a.startsAt - b.startsAt);
  if (confirmedCandidates.length === 0 && meeting.confirmedCandidateId) {
    const legacy = candidates.find((c) => c.id === meeting.confirmedCandidateId);
    if (legacy) confirmedCandidates = [legacy];
  }
  const confirmedStartsAt = confirmedCandidates[0]?.startsAt ?? null;

  return c.json({
    data: {
      meeting: {
        id: meeting.id,
        title: meeting.title,
        description: meeting.description,
        host: host ?? null,
        hostMemberId: meeting.hostMemberId,
        scope: meeting.scope,
        teamId: meeting.teamId,
        status: meeting.status,
        confirmedCandidateId: meeting.confirmedCandidateId,
        confirmedStartsAt,
        deadline: meeting.deadline,
        registrationDeadline: meeting.registrationDeadline,
        eventCampaignId: meeting.eventCampaignId,
        eventTypeDefId: meeting.eventTypeDefId,
        createdAt: meeting.createdAt,
        updatedAt: meeting.updatedAt,
      },
      candidates: candidates.map((c) => ({
        id: c.id, startsAt: c.startsAt, endsAt: c.endsAt, note: c.note, sortOrder: c.sortOrder,
        // 旧形式確定ミーティングの候補は isConfirmed が 0 でも confirmedCandidateId が指す場合は 1 として返す
        isConfirmed: c.isConfirmed === 1 || c.id === meeting.confirmedCandidateId ? 1 : 0,
      })),
      respondents: [...memberRespondents, ...externalRespondents],
      externalInvitees: externalInvitees.map((e) => ({
        id: e.id, name: e.name, email: e.email, token: e.token, createdAt: e.createdAt,
      })),
      myAnswers,
      isHost: meeting.hostMemberId === memberId,
      linkedEvent,
      myAttendance: myAttendance ? { status: myAttendance.status, pointsAwarded: myAttendance.pointsAwarded } : null,
      attendances: attendanceRows.map((a) => ({ memberId: a.memberId, status: a.status, pointsAwarded: a.pointsAwarded })),
    },
  });
});

// ----------------------------------------------------------------
// POST /api/meetings/:id/respond — 回答を投稿（upsert）
// ----------------------------------------------------------------
meetingRoutes.post("/:id/respond", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");
  const { id } = c.req.param();
  const now = Math.floor(Date.now() / 1000);

  const meeting = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id)).get();
  if (!meeting) return c.json({ error: { code: "not_found", message: "ミーティングが見つかりません" } }, 404);
  if (meeting.status !== "open") {
    return c.json({ error: { code: "meeting_closed", message: "このミーティングは既に締め切られています" } }, 400);
  }

  const body = await c.req.json<{ answers: Record<string, Availability> }>();

  for (const [candidateId, availability] of Object.entries(body.answers)) {
    // 既存の回答を削除して再挿入（upsert代わり）
    await db
      .delete(schema.meetingResponses)
      .where(
        and(
          eq(schema.meetingResponses.candidateId, candidateId),
          eq(schema.meetingResponses.memberId, memberId)
        )
      );
    await db.insert(schema.meetingResponses).values({
      id: newId(),
      meetingId: id,
      candidateId,
      memberId,
      externalInviteeId: null,
      availability,
      comment: null,
      respondedAt: now,
    });
  }

  return c.json({ ok: true });
});

// ----------------------------------------------------------------
// 共通：日程テキスト生成
// ----------------------------------------------------------------
function formatCandidateDateText(startsAt: number, endsAt: number | null, tz = "Asia/Tokyo"): string {
  const fmt = (ts: number) => new Intl.DateTimeFormat("ja-JP", {
    timeZone: tz,
    year: "numeric", month: "numeric", day: "numeric",
    weekday: "narrow", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ts * 1000));

  const parts = fmt(startsAt);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("year")}年${get("month")}月${get("day")}日(${get("weekday")})`;
  const startT = `${get("hour")}:${get("minute")}`;

  if (endsAt) {
    const ep = fmt(endsAt);
    const eGet = (type: string) => ep.find((p) => p.type === type)?.value ?? "";
    return `${date} ${startT}〜${eGet("hour")}:${eGet("minute")}`;
  }
  return startT === "00:00" ? date : `${date} ${startT}`;
}

// 共通：ミーティングの対象メンバーをscope別に取得
async function getTargetMembers(db: ReturnType<typeof import("../db/index.ts").createDb>, meeting: { id: string; scope: string; teamId: string | null; hostMemberId: string }) {
  if (meeting.scope === "all") {
    return await db
      .select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
      .from(schema.members).where(eq(schema.members.status, "active")).all();
  } else if (meeting.scope === "team" && meeting.teamId) {
    const tms = await db.select({ memberId: schema.teamMembers.memberId }).from(schema.teamMembers)
      .where(eq(schema.teamMembers.teamId, meeting.teamId)).all();
    const ids = tms.map((r) => r.memberId);
    if (ids.length === 0) return [];
    return await db
      .select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
      .from(schema.members).where(and(inArray(schema.members.id, ids), eq(schema.members.status, "active"))).all();
  } else if (meeting.scope === "selected") {
    const inv = await db.select({ memberId: schema.meetingInvitees.memberId }).from(schema.meetingInvitees)
      .where(eq(schema.meetingInvitees.meetingId, meeting.id)).all();
    const ids = [...new Set([meeting.hostMemberId, ...inv.map((r) => r.memberId)])];
    return await db
      .select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
      .from(schema.members).where(inArray(schema.members.id, ids)).all();
  }
  return [];
}

// ----------------------------------------------------------------
// PATCH /api/meetings/:id/confirm — 日程確定トグル（主催者のみ）複数日程対応
// ----------------------------------------------------------------
meetingRoutes.patch("/:id/confirm", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");
  const { id } = c.req.param();
  const now = Math.floor(Date.now() / 1000);

  const meeting = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id)).get();
  if (!meeting) return c.json({ error: { code: "not_found", message: "ミーティングが見つかりません" } }, 404);
  if (meeting.hostMemberId !== memberId) {
    return c.json({ error: { code: "forbidden", message: "主催者のみ日程を確定できます" } }, 403);
  }
  if (meeting.status === "cancelled") {
    return c.json({ error: { code: "invalid_status", message: "キャンセル済みのミーティングは変更できません" } }, 400);
  }

  const { candidateId } = await c.req.json<{ candidateId: string }>();
  const candidate = await db
    .select().from(schema.meetingDateCandidates)
    .where(and(eq(schema.meetingDateCandidates.id, candidateId), eq(schema.meetingDateCandidates.meetingId, id)))
    .get();
  if (!candidate) {
    return c.json({ error: { code: "invalid_input", message: "候補日が見つかりません" } }, 400);
  }

  // is_confirmed をトグル
  const wasConfirmed = candidate.isConfirmed === 1;
  const newValue = wasConfirmed ? 0 : 1;
  await db.update(schema.meetingDateCandidates)
    .set({ isConfirmed: newValue })
    .where(eq(schema.meetingDateCandidates.id, candidateId));

  // 確定済み候補日を最新取得（最も早い日時順）
  const confirmedCandidates = await db
    .select()
    .from(schema.meetingDateCandidates)
    .where(and(
      eq(schema.meetingDateCandidates.meetingId, id),
      eq(schema.meetingDateCandidates.isConfirmed, 1)
    ))
    .orderBy(schema.meetingDateCandidates.startsAt)
    .all();

  const newStatus = confirmedCandidates.length > 0 ? "confirmed" : "open";
  const newConfirmedCandidateId = confirmedCandidates[0]?.id ?? null;

  await db.update(schema.meetings)
    .set({ status: newStatus, confirmedCandidateId: newConfirmedCandidateId, updatedAt: now })
    .where(eq(schema.meetings.id, id));

  // 確定に追加した場合のみ通知
  if (newValue === 1) {
    const wasAlreadyConfirmed = meeting.status === "confirmed";
    const host = await db.select({ name: schema.members.name, email: schema.members.email }).from(schema.members)
      .where(eq(schema.members.id, meeting.hostMemberId)).get();
    const hostName = host?.name ?? "主催者";
    const systemTz = (await db.select({ timezone: schema.cardDesigns.timezone }).from(schema.cardDesigns).get())?.timezone ?? "Asia/Tokyo";
    const confirmedDateText = formatCandidateDateText(candidate.startsAt, candidate.endsAt, systemTz);
    const isDev = c.env.ENVIRONMENT !== "production";
    const appUrl = c.env.CORS_ORIGIN ?? "https://shirakaba-quest.pages.dev";

    const notifyMsg = wasAlreadyConfirmed
      ? `「${meeting.title}」に${confirmedDateText}が追加されました`
      : `「${meeting.title}」の日程が${confirmedDateText}に確定しました`;

    const targetMembers = await getTargetMembers(db, meeting);
    const notifyMembers = targetMembers.filter((m) => m.id !== meeting.hostMemberId);

    for (const m of notifyMembers) {
      await db.insert(schema.meetingNotifications).values({
        id: newId(),
        meetingId: id,
        memberId: m.id,
        type: "confirmed",
        message: notifyMsg,
        readAt: null,
        createdAt: now,
      });
      if (m.email) {
        sendMeetingConfirmedMemberMail({
          to: m.email, memberName: m.name, meetingTitle: meeting.title,
          hostName, confirmedDate: confirmedDateText,
          appUrl, meetingId: id,
          appTitle: "白樺クエスト",
          apiKey: c.env.SENDGRID_API_KEY, isDev, fromEmail: c.env.SENDGRID_FROM_EMAIL,
        }).catch(console.error);
      }
    }

    // 主催者本人にも確定メールを送信（操作確認のため）
    if (host?.email) {
      sendMeetingConfirmedMemberMail({
        to: host.email, memberName: hostName, meetingTitle: meeting.title,
        hostName, confirmedDate: confirmedDateText,
        appUrl, meetingId: id,
        appTitle: "白樺クエスト",
        apiKey: c.env.SENDGRID_API_KEY, isDev, fromEmail: c.env.SENDGRID_FROM_EMAIL,
      }).catch(console.error);
    }

    const extInvitees = await db.select().from(schema.meetingExternalInvitees)
      .where(eq(schema.meetingExternalInvitees.meetingId, id)).all();
    for (const ext of extInvitees) {
      if (ext.email && ext.name) {
        const scheduleUrl = `${appUrl}/schedule/${ext.token}`;
        sendMeetingConfirmedGuestMail({
          to: ext.email, guestName: ext.name, meetingTitle: meeting.title,
          hostName, confirmedDate: confirmedDateText, scheduleUrl,
          appTitle: "白樺クエスト",
          apiKey: c.env.SENDGRID_API_KEY, isDev, fromEmail: c.env.SENDGRID_FROM_EMAIL,
        }).catch(console.error);
      }
    }
  }

  return c.json({ ok: true, confirmed: newValue === 1 });
});

// ----------------------------------------------------------------
// DELETE /api/meetings/:id — キャンセル（主催者のみ）
// ----------------------------------------------------------------
meetingRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");
  const { id } = c.req.param();
  const now = Math.floor(Date.now() / 1000);

  const meeting = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id)).get();
  if (!meeting) return c.json({ error: { code: "not_found", message: "ミーティングが見つかりません" } }, 404);
  if (meeting.hostMemberId !== memberId) {
    return c.json({ error: { code: "forbidden", message: "主催者のみキャンセルできます" } }, 403);
  }

  await db
    .update(schema.meetings)
    .set({ status: "cancelled", updatedAt: now })
    .where(eq(schema.meetings.id, id));

  return c.json({ ok: true });
});

// ----------------------------------------------------------------
// POST /api/meetings/:id/external — 外部招待URLを生成
// ----------------------------------------------------------------
meetingRoutes.post("/:id/external", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");
  const { id } = c.req.param();
  const now = Math.floor(Date.now() / 1000);

  const meeting = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id)).get();
  if (!meeting) return c.json({ error: { code: "not_found", message: "ミーティングが見つかりません" } }, 404);

  const token = generateRawToken();
  const inviteeId = newId();

  await db.insert(schema.meetingExternalInvitees).values({
    id: inviteeId,
    meetingId: id,
    name: "",
    email: null,
    token,
    createdAt: now,
  });

  return c.json({ data: { id: inviteeId, token } }, 201);
});

// ----------------------------------------------------------------
// PATCH /api/meetings/:id/description — 詳細情報更新（主催者のみ）＋メール通知
// ----------------------------------------------------------------
meetingRoutes.patch("/:id/description", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");
  const { id } = c.req.param();
  const now = Math.floor(Date.now() / 1000);

  const meeting = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id)).get();
  if (!meeting) return c.json({ error: { code: "not_found", message: "ミーティングが見つかりません" } }, 404);
  if (meeting.hostMemberId !== memberId) {
    return c.json({ error: { code: "forbidden", message: "主催者のみ詳細を更新できます" } }, 403);
  }

  const { description } = await c.req.json<{ description: string }>();

  await db.update(schema.meetings)
    .set({ description, updatedAt: now })
    .where(eq(schema.meetings.id, id));

  const host = await db.select({ name: schema.members.name }).from(schema.members)
    .where(eq(schema.members.id, meeting.hostMemberId)).get();
  const hostName = host?.name ?? "主催者";
  const isDev = c.env.ENVIRONMENT !== "production";
  const appUrl = c.env.CORS_ORIGIN ?? "https://shirakaba-quest.pages.dev";

  // 通知対象：確定済み → 回答者全員、募集中 → 全対象メンバー
  let notifyMemberIds: string[] = [];
  if (meeting.status === "confirmed") {
    const responses = await db.select({ memberId: schema.meetingResponses.memberId })
      .from(schema.meetingResponses)
      .where(and(eq(schema.meetingResponses.meetingId, id), isNull(schema.meetingResponses.externalInviteeId)))
      .all();
    notifyMemberIds = responses.map((r) => r.memberId).filter((mid): mid is string => mid !== null);
  } else {
    const members = await getTargetMembers(db, meeting);
    notifyMemberIds = members.map((m) => m.id);
  }
  // 主催者を除く
  notifyMemberIds = notifyMemberIds.filter((mid) => mid !== meeting.hostMemberId);

  if (notifyMemberIds.length > 0) {
    const memberRows = await db.select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
      .from(schema.members)
      .where(inArray(schema.members.id, notifyMemberIds))
      .all();

    for (const m of memberRows) {
      await db.insert(schema.meetingNotifications).values({
        id: newId(),
        meetingId: id,
        memberId: m.id,
        type: "details_updated",
        message: `「${meeting.title}」に詳細情報が追加されました`,
        readAt: null,
        createdAt: now,
      });
      if (m.email) {
        sendMeetingDetailsUpdatedMemberMail({
          to: m.email, memberName: m.name, meetingTitle: meeting.title,
          hostName, details: description,
          appUrl, meetingId: id,
          appTitle: "白樺クエスト",
          apiKey: c.env.SENDGRID_API_KEY, isDev, fromEmail: c.env.SENDGRID_FROM_EMAIL,
        }).catch(console.error);
      }
    }
  }

  // 外部ゲスト通知（確定済みなら回答者のみ、募集中なら全ゲスト）
  let extRows = await db.select().from(schema.meetingExternalInvitees)
    .where(eq(schema.meetingExternalInvitees.meetingId, id)).all();

  if (meeting.status === "confirmed") {
    const extResponses = await db.select({ externalInviteeId: schema.meetingResponses.externalInviteeId })
      .from(schema.meetingResponses)
      .where(and(eq(schema.meetingResponses.meetingId, id), isNull(schema.meetingResponses.memberId)))
      .all();
    const respondedExtIds = new Set(extResponses.map((r) => r.externalInviteeId).filter(Boolean));
    extRows = extRows.filter((ext) => respondedExtIds.has(ext.id));
  }

  for (const ext of extRows) {
    if (ext.email && ext.name) {
      const scheduleUrl = `${appUrl}/schedule/${ext.token}`;
      sendMeetingDetailsUpdatedGuestMail({
        to: ext.email, guestName: ext.name, meetingTitle: meeting.title,
        hostName, details: description, scheduleUrl,
        appTitle: "白樺クエスト",
        apiKey: c.env.SENDGRID_API_KEY, isDev, fromEmail: c.env.SENDGRID_FROM_EMAIL,
      }).catch(console.error);
    }
  }

  return c.json({ ok: true });
});

// ----------------------------------------------------------------
// POST /api/meetings/:id/invite-member — メンバーを追加招待（ステータス不問）
// ----------------------------------------------------------------
meetingRoutes.post("/:id/invite-member", async (c) => {
  const db = createDb(c.env.DB);
  const hostId = c.get("userId");
  const { id } = c.req.param();
  const now = Math.floor(Date.now() / 1000);

  const meeting = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id)).get();
  if (!meeting) return c.json({ error: { code: "not_found", message: "ミーティングが見つかりません" } }, 404);

  const { memberId } = await c.req.json<{ memberId: string }>();

  // 対象メンバーを確認
  const targetMember = await db.select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
    .from(schema.members)
    .where(and(eq(schema.members.id, memberId), eq(schema.members.status, "active")))
    .get();
  if (!targetMember) return c.json({ error: { code: "not_found", message: "メンバーが見つかりません" } }, 404);

  // 重複チェック（同じミーティングにすでに招待済みか）
  const existing = await db.select().from(schema.meetingInvitees)
    .where(and(eq(schema.meetingInvitees.meetingId, id), eq(schema.meetingInvitees.memberId, memberId)))
    .get();
  if (!existing) {
    await db.insert(schema.meetingInvitees).values({ id: newId(), meetingId: id, memberId });
  }

  // 招待メールを送信
  const host = await db.select({ name: schema.members.name }).from(schema.members)
    .where(eq(schema.members.id, hostId)).get();
  const hostName = host?.name ?? "主催者";
  const isDev = c.env.ENVIRONMENT !== "production";
  const appUrl = c.env.CORS_ORIGIN ?? "https://shirakaba-quest.pages.dev";

  if (targetMember.email) {
    const systemTzForSingleInvite = (await db.select({ timezone: schema.cardDesigns.timezone }).from(schema.cardDesigns).get())?.timezone ?? "Asia/Tokyo";
    sendMeetingInvitationMail({
      to: targetMember.email, memberName: targetMember.name, meetingTitle: meeting.title,
      hostName, description: meeting.description, deadline: meeting.deadline,
      appUrl, meetingId: id, appTitle: "白樺クエスト",
      apiKey: c.env.SENDGRID_API_KEY, isDev, fromEmail: c.env.SENDGRID_FROM_EMAIL,
      timezone: systemTzForSingleInvite,
    }).catch(console.error);
  }

  // DB通知
  await db.insert(schema.meetingNotifications).values({
    id: newId(), meetingId: id, memberId,
    type: "invited",
    message: `「${meeting.title}」に招待されました`,
    readAt: null, createdAt: now,
  });

  return c.json({ ok: true });
});

// ----------------------------------------------------------------
// DELETE /api/meetings/:id/invitees/:memberId — メンバー招待を削除
// ----------------------------------------------------------------
meetingRoutes.delete("/:id/invitees/:memberId", async (c) => {
  const db = createDb(c.env.DB);
  const hostId = c.get("userId");
  const { id, memberId } = c.req.param();

  const meeting = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id)).get();
  if (!meeting) return c.json({ error: { code: "not_found", message: "ミーティングが見つかりません" } }, 404);

  // meetingInvitees から削除
  await db.delete(schema.meetingInvitees)
    .where(and(eq(schema.meetingInvitees.meetingId, id), eq(schema.meetingInvitees.memberId, memberId)));

  // 回答も削除
  await db.delete(schema.meetingResponses)
    .where(and(eq(schema.meetingResponses.meetingId, id), eq(schema.meetingResponses.memberId, memberId)));

  return c.json({ ok: true });
});

// ----------------------------------------------------------------
// DELETE /api/meetings/:id/external/:externalId — 外部ゲスト招待を削除
// ----------------------------------------------------------------
meetingRoutes.delete("/:id/external/:externalId", async (c) => {
  const db = createDb(c.env.DB);
  const hostId = c.get("userId");
  const { id, externalId } = c.req.param();

  const meeting = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id)).get();
  if (!meeting) return c.json({ error: { code: "not_found", message: "ミーティングが見つかりません" } }, 404);

  // 回答を先に削除
  await db.delete(schema.meetingResponses)
    .where(and(eq(schema.meetingResponses.meetingId, id), eq(schema.meetingResponses.externalInviteeId, externalId)));

  // 外部招待者を削除
  await db.delete(schema.meetingExternalInvitees)
    .where(and(eq(schema.meetingExternalInvitees.meetingId, id), eq(schema.meetingExternalInvitees.id, externalId)));

  return c.json({ ok: true });
});

// ----------------------------------------------------------------
// PATCH /api/meetings/:id/event — イベント紐付け（確定前のみ）
// ----------------------------------------------------------------
meetingRoutes.patch("/:id/event", async (c) => {
  const db = createDb(c.env.DB);
  const hostId = c.get("userId");
  const { id } = c.req.param();
  const now = Math.floor(Date.now() / 1000);

  const meeting = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id)).get();
  if (!meeting) return c.json({ error: { code: "not_found", message: "ミーティングが見つかりません" } }, 404);
  if (meeting.hostMemberId !== hostId) return c.json({ error: { code: "forbidden", message: "主催者のみ操作できます" } }, 403);
  if (meeting.status === "confirmed") {
    return c.json({ error: { code: "already_confirmed", message: "確定後はイベントを変更できません" } }, 400);
  }

  const { eventCampaignId } = await c.req.json<{ eventCampaignId: string | null }>();

  await db.update(schema.meetings)
    .set({ eventCampaignId: eventCampaignId ?? null, updatedAt: now })
    .where(eq(schema.meetings.id, id));

  return c.json({ ok: true });
});

// ----------------------------------------------------------------
// POST /api/meetings/:id/attendance — 出席記録（本人のみ、開催後のみ）
// ----------------------------------------------------------------
meetingRoutes.post("/:id/attendance", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");
  const { id } = c.req.param();
  const now = Math.floor(Date.now() / 1000);

  const meeting = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id)).get();
  if (!meeting) return c.json({ error: { code: "not_found", message: "ミーティングが見つかりません" } }, 404);
  if (meeting.status !== "confirmed") {
    return c.json({ error: { code: "not_confirmed", message: "確定済みミーティングのみ出席記録できます" } }, 400);
  }

  // 確定候補日が過去か確認
  const confirmedCandidate = await db.select({ startsAt: schema.meetingDateCandidates.startsAt })
    .from(schema.meetingDateCandidates)
    .where(eq(schema.meetingDateCandidates.id, meeting.confirmedCandidateId ?? ""))
    .get();
  if (!confirmedCandidate || confirmedCandidate.startsAt >= now) {
    return c.json({ error: { code: "not_started", message: "開催日時を過ぎてから記録できます" } }, 400);
  }

  const { status } = await c.req.json<{ status: "attended" | "absent" }>();

  // 既存の記録を確認
  const existing = await db.select().from(schema.meetingAttendances)
    .where(and(eq(schema.meetingAttendances.meetingId, id), eq(schema.meetingAttendances.memberId, memberId)))
    .get();

  // ポイント付与：出席に変更 かつ まだポイント未付与の場合
  let pointsToAward = 0;
  if (status === "attended" && (!existing || existing.status === "absent") && !existing?.pointsAwarded) {
    if (meeting.eventTypeDefId) {
      // 新方式: event_type_definitions から point_value を取得
      const typeDef = await db.select({ pointValue: schema.eventTypeDefinitions.pointValue })
        .from(schema.eventTypeDefinitions)
        .where(eq(schema.eventTypeDefinitions.id, meeting.eventTypeDefId))
        .get();
      if (typeDef?.pointValue) pointsToAward = typeDef.pointValue;
    } else if (meeting.eventCampaignId) {
      // 旧方式: event_campaigns の multiplier を使用（後方互換）
      const ev = await db.select({ multiplier: schema.eventCampaigns.multiplier })
        .from(schema.eventCampaigns)
        .where(eq(schema.eventCampaigns.id, meeting.eventCampaignId))
        .get();
      if (ev?.multiplier) pointsToAward = ev.multiplier;
    }
  }

  if (existing) {
    await db.update(schema.meetingAttendances)
      .set({ status, recordedAt: now, ...(pointsToAward > 0 && { pointsAwarded: pointsToAward }) })
      .where(and(eq(schema.meetingAttendances.meetingId, id), eq(schema.meetingAttendances.memberId, memberId)));
  } else {
    await db.insert(schema.meetingAttendances).values({
      id: newId(), meetingId: id, memberId, status, recordedAt: now,
      pointsAwarded: pointsToAward > 0 ? pointsToAward : null,
    });
  }

  if (pointsToAward > 0) {
    await db.insert(schema.pointTransactions).values({
      id: newId(), memberId, delta: pointsToAward,
      reason: "meeting_attendance", relatedId: id, createdAt: now,
    });
  }

  return c.json({ ok: true, pointsAwarded: pointsToAward });
});

// ----------------------------------------------------------------
// POST /api/meetings/:id/read-notifications — このミーティングの通知を既読に
// ----------------------------------------------------------------
meetingRoutes.post("/:id/read-notifications", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");
  const { id } = c.req.param();
  const now = Math.floor(Date.now() / 1000);

  await db
    .update(schema.meetingNotifications)
    .set({ readAt: now })
    .where(
      and(
        eq(schema.meetingNotifications.meetingId, id),
        eq(schema.meetingNotifications.memberId, memberId),
        isNull(schema.meetingNotifications.readAt)
      )
    );

  return c.json({ ok: true });
});
