// =============================================================
// イベントルート（公開・認証必要）
// GET  /api/events/active              — アクティブイベント一覧
// GET  /api/events/types               — メンバー作成可能なイベント種別一覧
// GET  /api/events/meeting-types       — ミーティング連携可能な種別一覧
// POST /api/events/instances           — メンバーがイベントインスタンスを作成
// POST /api/events/instances/:id/participate — イベント参加（ポイント付与）
// GET  /api/events/visitor-invite/mine — 自分のビジター招待クエスト
// POST /api/events/visitor-invite/resolve — 招待クエスト解決
// =============================================================
import { Hono } from "hono";
import { eq, and, sql, asc, inArray } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId } from "../services/auth.ts";
import type { Env, Variables } from "../types.ts";

export const eventRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
eventRoutes.use("*", authMiddleware);

// GET /api/events/active
eventRoutes.get("/active", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);

  // 有効期限切れのイベントを自動終了（遅延更新）
  await db.update(schema.eventCampaigns)
    .set({ status: "ended", updatedAt: now })
    .where(and(
      eq(schema.eventCampaigns.status, "active"),
      sql`${schema.eventCampaigns.endsAt} IS NOT NULL AND ${schema.eventCampaigns.endsAt} < ${now}`
    ));

  const events = await db
    .select()
    .from(schema.eventCampaigns)
    .where(
      and(
        eq(schema.eventCampaigns.status, "active"),
        sql`(${schema.eventCampaigns.endsAt} IS NULL OR ${schema.eventCampaigns.endsAt} >= ${now})`
      )
    )
    .all();

  // 全イベントの relatedMemberIds を集計してメンバー名を取得
  const allMemberIds = [...new Set(
    events.flatMap((e) => {
      const ids = parseIds(e.relatedMemberIds) ?? (e.relatedMemberId ? [e.relatedMemberId] : []);
      return ids;
    })
  )];

  const members = events.length > 0
    ? await db
        .select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji })
        .from(schema.members)
        .all()
    : [];
  const memberMap = new Map(members.map((m) => [m.id, m]));

  // 種別定義（詳細）を一括取得
  const typeDefIds = [...new Set(
    events.map((e) => e.eventTypeDefId).filter((id): id is string => !!id)
  )];
  const typeDefs = typeDefIds.length > 0
    ? await db.select()
        .from(schema.eventTypeDefinitions)
        .where(inArray(schema.eventTypeDefinitions.id, typeDefIds))
        .all()
    : [];
  const typeDefMap = new Map(typeDefs.map((t) => [t.id, t]));

  // 現在ユーザーの参加済みイベントを取得
  const eventIds = events.map((e) => e.id);
  const participations = eventIds.length > 0
    ? await db.select({ eventCampaignId: schema.eventParticipations.eventCampaignId })
        .from(schema.eventParticipations)
        .where(and(
          inArray(schema.eventParticipations.eventCampaignId, eventIds),
          eq(schema.eventParticipations.memberId, memberId)
        ))
        .all()
    : [];
  const participatedIds = new Set(participations.map((p) => p.eventCampaignId));

  return c.json({
    data: events.map((e) => {
      const base = toPublic(e);
      const ids = parseIds(e.relatedMemberIds) ?? (e.relatedMemberId ? [e.relatedMemberId] : []);
      const typeDef = e.eventTypeDefId ? typeDefMap.get(e.eventTypeDefId) : null;
      return {
        ...base,
        ...(typeDef && {
          typeEmoji: typeDef.emoji,
          typeName: typeDef.name,
          triggerType: typeDef.triggerType,
          pointValue: typeDef.pointValue,
          rewardTarget: typeDef.rewardTarget,
          requiresTargetMember: typeDef.requiresTargetMember,
          linksToMeeting: typeDef.linksToMeeting,
        }),
        ...(ids.length > 0 && {
          relatedMemberName: memberMap.get(ids[0])?.name ?? null,
          relatedMemberEmoji: memberMap.get(ids[0])?.emoji ?? null,
          relatedMemberIds: ids,
          relatedMembers: ids.map((id) => memberMap.get(id)).filter(Boolean) as { id: string; name: string; emoji: string }[],
        }),
        creatorName: e.createdByMemberId ? (memberMap.get(e.createdByMemberId)?.name ?? null) : null,
        creatorEmoji: e.createdByMemberId ? (memberMap.get(e.createdByMemberId)?.emoji ?? null) : null,
        myParticipated: participatedIds.has(e.id),
      };
    }),
  });
});

// GET /api/events/types — メンバーが作成可能な種別一覧（creator_role='member'）
eventRoutes.get("/types", async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.eventTypeDefinitions)
    .where(and(
      eq(schema.eventTypeDefinitions.creatorRole, "member"),
      eq(schema.eventTypeDefinitions.isActive, 1)
    ))
    .orderBy(asc(schema.eventTypeDefinitions.sortOrder))
    .all();
  return c.json({ data: rows });
});

// GET /api/events/meeting-types — ミーティング連携可能な種別一覧
eventRoutes.get("/meeting-types", async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.eventTypeDefinitions)
    .where(and(
      eq(schema.eventTypeDefinitions.linksToMeeting, 1),
      eq(schema.eventTypeDefinitions.isActive, 1)
    ))
    .orderBy(asc(schema.eventTypeDefinitions.sortOrder))
    .all();
  return c.json({ data: rows });
});

// POST /api/events/instances — メンバーがイベントインスタンスを作成
eventRoutes.post("/instances", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);
  const body = await c.req.json<{
    typeDefId: string;
    relatedMemberId?: string;
    relatedMemberIds?: string[];
    title?: string;
    description?: string;
    startsAt?: number;
    endsAt?: number;
  }>();

  const typeDef = await db.select().from(schema.eventTypeDefinitions)
    .where(eq(schema.eventTypeDefinitions.id, body.typeDefId)).get();
  if (!typeDef) {
    return c.json({ error: { code: "not_found", message: "イベント種別が見つかりません" } }, 404);
  }
  if (typeDef.creatorRole !== "member") {
    return c.json({ error: { code: "forbidden", message: "この種別のイベントは管理者のみ作成できます" } }, 403);
  }

  const targetIds = body.relatedMemberIds ?? (body.relatedMemberId ? [body.relatedMemberId] : []);
  if (typeDef.requiresTargetMember && targetIds.length === 0) {
    return c.json({ error: { code: "invalid_input", message: "対象メンバーを選択してください" } }, 400);
  }

  const id = newId();
  await db.insert(schema.eventCampaigns).values({
    id,
    type: typeDef.slug,
    eventTypeDefId: typeDef.id,
    title: body.title?.trim() || typeDef.name,
    description: body.description?.trim() ?? "",
    startsAt: body.startsAt ?? now,
    endsAt: body.endsAt ?? null,
    relatedMemberId: targetIds[0] ?? null,
    relatedMemberIds: targetIds.length > 0 ? JSON.stringify(targetIds) : null,
    multiplier: null,
    status: "active",
    createdByMemberId: memberId,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ data: { id } }, 201);
});

// PATCH /api/events/instances/:id — 作成者本人がイベント種別・内容を変更
eventRoutes.patch("/instances/:id", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");
  const { id } = c.req.param();
  const now = Math.floor(Date.now() / 1000);

  const existing = await db.select().from(schema.eventCampaigns)
    .where(eq(schema.eventCampaigns.id, id)).get();
  if (!existing) {
    return c.json({ error: { code: "not_found", message: "イベントが見つかりません" } }, 404);
  }
  if (existing.createdByMemberId !== memberId) {
    return c.json({ error: { code: "forbidden", message: "このイベントを編集する権限がありません" } }, 403);
  }

  type PatchBody = {
    typeDefId?: string;
    title?: string;
    description?: string;
    status?: "ended" | "deleted";
    startsAt?: number;
    endsAt?: number | null;
    relatedMemberIds?: string[];
  };
  const body = await c.req.json<PatchBody>().catch(() => ({} as PatchBody));

  // 種別変更
  let typeUpdate: { type?: string; eventTypeDefId?: string | null } = {};
  if (body.typeDefId !== undefined) {
    const typeDef = await db.select().from(schema.eventTypeDefinitions)
      .where(and(eq(schema.eventTypeDefinitions.id, body.typeDefId), eq(schema.eventTypeDefinitions.isActive, 1))).get();
    if (!typeDef) {
      return c.json({ error: { code: "not_found", message: "イベント種別が見つかりません" } }, 404);
    }
    typeUpdate = { type: typeDef.slug, eventTypeDefId: typeDef.id };
  }

  const allowedStatuses = ["ended", "deleted"];
  await db.update(schema.eventCampaigns).set({
    ...typeUpdate,
    ...(body.title       !== undefined && { title: body.title.trim() }),
    ...(body.description !== undefined && { description: body.description.trim() }),
    ...(body.status !== undefined && allowedStatuses.includes(body.status) && { status: body.status }),
    ...(body.startsAt    !== undefined && { startsAt: body.startsAt }),
    ...(body.endsAt      !== undefined && { endsAt: body.endsAt }),
    ...(body.relatedMemberIds !== undefined && {
      relatedMemberId: body.relatedMemberIds[0] ?? null,
      relatedMemberIds: body.relatedMemberIds.length > 0 ? JSON.stringify(body.relatedMemberIds) : null,
    }),
    updatedAt: now,
  }).where(eq(schema.eventCampaigns.id, id));

  return c.json({ ok: true });
});

// POST /api/events/instances/:id/participate — イベント参加・ポイント付与
eventRoutes.post("/instances/:id/participate", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");
  const { id } = c.req.param();
  const now = Math.floor(Date.now() / 1000);

  const event = await db.select().from(schema.eventCampaigns)
    .where(eq(schema.eventCampaigns.id, id)).get();
  if (!event || event.status !== "active") {
    return c.json({ error: { code: "not_found", message: "イベントが見つかりません" } }, 404);
  }

  // 既に参加済みか確認
  const existing = await db.select({ id: schema.eventParticipations.id })
    .from(schema.eventParticipations)
    .where(and(
      eq(schema.eventParticipations.eventCampaignId, id),
      eq(schema.eventParticipations.memberId, memberId)
    ))
    .get();

  if (existing) {
    return c.json({ ok: true, alreadyDone: true, pointsAwarded: 0 });
  }

  // 参加を記録
  await db.insert(schema.eventParticipations).values({
    id: newId(),
    eventCampaignId: id,
    memberId,
    createdAt: now,
  });

  // インスタンスの加算ポイントを付与（multiplierを加算ポイントとして使用）
  let pointsAwarded = 0;
  const pointsToAward = event.multiplier ?? 0;
  if (pointsToAward > 0 && event.eventTypeDefId) {
    const typeDef = await db.select({ pointValue: schema.eventTypeDefinitions.pointValue })
      .from(schema.eventTypeDefinitions)
      .where(eq(schema.eventTypeDefinitions.id, event.eventTypeDefId))
      .get();
    if (typeDef && typeDef.pointValue > 0) {
      pointsAwarded = pointsToAward;
      await db.insert(schema.pointTransactions).values({
        id: newId(),
        memberId,
        delta: pointsAwarded,
        reason: "event_participation",
        relatedId: id,
        createdAt: now,
      });
    }
  }

  return c.json({ ok: true, alreadyDone: false, pointsAwarded });
});

// GET /api/events/instances/:id — 単一イベント詳細
eventRoutes.get("/instances/:id", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");
  const { id } = c.req.param();

  const event = await db.select().from(schema.eventCampaigns)
    .where(eq(schema.eventCampaigns.id, id)).get();

  if (!event || event.status === "deleted") {
    return c.json({ error: { code: "not_found", message: "イベントが見つかりません" } }, 404);
  }

  const typeDef = event.eventTypeDefId
    ? await db.select().from(schema.eventTypeDefinitions)
        .where(eq(schema.eventTypeDefinitions.id, event.eventTypeDefId)).get()
    : null;

  const ids = parseIds(event.relatedMemberIds) ?? (event.relatedMemberId ? [event.relatedMemberId] : []);

  const allMembers = await db
    .select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji })
    .from(schema.members)
    .all();
  const memberMap = new Map(allMembers.map((m) => [m.id, m]));

  const participation = await db.select({ id: schema.eventParticipations.id })
    .from(schema.eventParticipations)
    .where(and(
      eq(schema.eventParticipations.eventCampaignId, id),
      eq(schema.eventParticipations.memberId, memberId)
    )).get();

  const creator = event.createdByMemberId ? memberMap.get(event.createdByMemberId) : null;

  return c.json({
    data: {
      ...toPublic(event),
      ...(typeDef && {
        typeEmoji: typeDef.emoji,
        typeName: typeDef.name,
        triggerType: typeDef.triggerType,
        pointValue: typeDef.pointValue,
        rewardTarget: typeDef.rewardTarget,
        requiresTargetMember: typeDef.requiresTargetMember,
        linksToMeeting: typeDef.linksToMeeting,
        pointAwardTiming: event.pointAwardTiming ?? null,
      }),
      ...(ids.length > 0 && {
        relatedMembers: ids.map((rid) => memberMap.get(rid)).filter(Boolean) as { id: string; name: string; emoji: string }[],
      }),
      creatorName: creator?.name ?? null,
      creatorEmoji: creator?.emoji ?? null,
      myParticipated: !!participation,
    },
  });
});

// GET /api/events/visitor-invite/mine
eventRoutes.get("/visitor-invite/mine", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");

  const invite = await db
    .select()
    .from(schema.visitorInvites)
    .where(
      and(
        eq(schema.visitorInvites.memberId, memberId),
        eq(schema.visitorInvites.status, "pending")
      )
    )
    .get();

  // 未作成なら自動作成
  if (!invite) {
    const now = Math.floor(Date.now() / 1000);
    const id = newId();
    await db.insert(schema.visitorInvites).values({
      id,
      memberId,
      visitorName: "",
      status: "pending",
      pointsAwarded: 5,
      createdAt: now,
    });
    return c.json({ data: { id, memberId, visitorName: "", status: "pending", resolvedAt: null, pointsAwarded: 5, createdAt: now } });
  }

  return c.json({
    data: {
      id: invite.id,
      memberId: invite.memberId,
      visitorName: invite.visitorName,
      status: invite.status,
      resolvedAt: invite.resolvedAt,
      pointsAwarded: invite.pointsAwarded,
      createdAt: invite.createdAt,
    },
  });
});

// POST /api/events/visitor-invite/resolve
eventRoutes.post("/visitor-invite/resolve", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);
  const { visitorName, inviteId } = await c.req.json<{ visitorName: string; inviteId: string }>();

  if (!visitorName?.trim()) {
    return c.json({ error: { code: "invalid_input", message: "ビジター名を入力してください" } }, 400);
  }

  // 招待クエストを解決済みに更新
  await db
    .update(schema.visitorInvites)
    .set({ visitorName: visitorName.trim(), status: "resolved", resolvedAt: now })
    .where(
      and(
        eq(schema.visitorInvites.id, inviteId),
        eq(schema.visitorInvites.memberId, memberId),
        eq(schema.visitorInvites.status, "pending")
      )
    );

  // +5pt 付与
  await db.insert(schema.pointTransactions).values({
    id: newId(),
    memberId,
    delta: 5,
    reason: "visitor_invite_resolved",
    relatedId: inviteId,
    createdAt: now,
  });

  // 新しい招待クエストを自動発行
  const newInviteId = newId();
  await db.insert(schema.visitorInvites).values({
    id: newInviteId,
    memberId,
    visitorName: "",
    status: "pending",
    pointsAwarded: 5,
    createdAt: now,
  });

  return c.json({ ok: true, points: 5, newInviteId });
});

function toPublic(e: typeof schema.eventCampaigns.$inferSelect) {
  return {
    id: e.id,
    type: e.type,
    eventTypeDefId: e.eventTypeDefId ?? null,
    title: e.title,
    description: e.description,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    relatedMemberId: e.relatedMemberId,
    relatedMemberIds: parseIds(e.relatedMemberIds) ?? (e.relatedMemberId ? [e.relatedMemberId] : []),
    multiplier: e.multiplier,
    pointAwardTiming: e.pointAwardTiming ?? null,
    status: e.status,
    createdByMemberId: e.createdByMemberId ?? null,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

function parseIds(str: string | null | undefined): string[] | null {
  if (!str) return null;
  try { return JSON.parse(str) as string[]; } catch { return null; }
}
