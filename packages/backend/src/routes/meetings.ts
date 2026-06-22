// =============================================================
// ミーティング（日程調整）ルート（認証必要）
// POST   /api/meetings               — 作成
// GET    /api/meetings               — 自分が関係する会の一覧
// GET    /api/meetings/upcoming      — 確定済み近日ミーティング（ホーム用）
// GET    /api/meetings/:id           — 詳細（グリッドデータ含む）
// POST   /api/meetings/:id/respond   — 自分の回答を投稿・更新
// PATCH  /api/meetings/:id/confirm   — 日程確定（主催者のみ）
// DELETE /api/meetings/:id           — キャンセル（主催者のみ）
// POST   /api/meetings/:id/external  — 外部招待URLを生成
// =============================================================
import { Hono } from "hono";
import { eq, inArray, and, sql } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId, generateRawToken } from "../services/auth.ts";
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
        confirmedDate: confCand ? { startsAt: confCand.startsAt, endsAt: confCand.endsAt } : null,
        hasResponded: respondedSet.has(m.id),
        createdAt: m.createdAt,
      };
    });

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
        deadline: meeting.deadline,
        createdAt: meeting.createdAt,
        updatedAt: meeting.updatedAt,
      },
      candidates: candidates.map((c) => ({
        id: c.id, startsAt: c.startsAt, endsAt: c.endsAt, note: c.note, sortOrder: c.sortOrder,
      })),
      respondents: [...memberRespondents, ...externalRespondents],
      externalInvitees: externalInvitees.map((e) => ({
        id: e.id, name: e.name, email: e.email, token: e.token, createdAt: e.createdAt,
      })),
      myAnswers,
      isHost: meeting.hostMemberId === memberId,
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
// PATCH /api/meetings/:id/confirm — 日程確定（主催者のみ）
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

  const { candidateId } = await c.req.json<{ candidateId: string }>();

  const candidate = await db
    .select()
    .from(schema.meetingDateCandidates)
    .where(and(eq(schema.meetingDateCandidates.id, candidateId), eq(schema.meetingDateCandidates.meetingId, id)))
    .get();
  if (!candidate) {
    return c.json({ error: { code: "invalid_input", message: "候補日が見つかりません" } }, 400);
  }

  await db
    .update(schema.meetings)
    .set({ status: "confirmed", confirmedCandidateId: candidateId, updatedAt: now })
    .where(eq(schema.meetings.id, id));

  return c.json({ ok: true });
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
  if (meeting.hostMemberId !== memberId) {
    return c.json({ error: { code: "forbidden", message: "主催者のみ外部招待URLを生成できます" } }, 403);
  }

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
