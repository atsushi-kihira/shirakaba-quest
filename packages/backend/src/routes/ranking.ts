// =============================================================
// ランキングルート
// GET /api/ranking     → 現在のランキング
// GET /api/ranking/me  → 自分の順位
// =============================================================
import { Hono } from "hono";
import { eq, sum, desc, sql, and } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import type { Env, Variables } from "../types.ts";

export const rankingRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

rankingRoutes.use("*", authMiddleware);

// ---- GET /api/ranking ----
rankingRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);

  // ポイント集計（SUM(delta) per member）
  const pointRows = await db
    .select({
      memberId: schema.pointTransactions.memberId,
      total: sum(schema.pointTransactions.delta).as("total"),
      lastAt: sql<number>`MAX(${schema.pointTransactions.createdAt})`.as("last_at"),
    })
    .from(schema.pointTransactions)
    .groupBy(schema.pointTransactions.memberId)
    .all();

  // アクティブメンバーを取得
  const activeMembers = await db
    .select({
      id: schema.members.id,
      name: schema.members.name,
      furigana: schema.members.furigana,
      emoji: schema.members.emoji,
      bgColor: schema.members.bgColor,
      category: schema.members.category,
      avatarImageKey: schema.members.avatarImageKey,
    })
    .from(schema.members)
    .where(eq(schema.members.status, "active"))
    .all();

  const pointMap = new Map(pointRows.map((r) => [r.memberId, { total: Number(r.total ?? 0), lastAt: r.lastAt }]));

  // 全メンバー（ポイント0含む）でランキングを組む
  const ranked = activeMembers
    .map((m) => ({
      member: m,
      points: pointMap.get(m.id)?.total ?? 0,
      lastPointedAt: pointMap.get(m.id)?.lastAt ?? null,
    }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      // 同点は最終ポイント取得日時が早い方が上
      if (a.lastPointedAt && b.lastPointedAt) return a.lastPointedAt - b.lastPointedAt;
      return 0;
    });

  const result = ranked.map((r, i) => ({
    rank: i + 1,
    member: r.member,
    points: r.points,
    lastPointedAt: r.lastPointedAt,
  }));

  return c.json({ data: result });
});

// ---- GET /api/ranking/me ----
rankingRoutes.get("/me", async (c) => {
  const db = createDb(c.env.DB);
  const userId = c.get("userId");

  const pointRows = await db
    .select({
      memberId: schema.pointTransactions.memberId,
      total: sum(schema.pointTransactions.delta).as("total"),
    })
    .from(schema.pointTransactions)
    .groupBy(schema.pointTransactions.memberId)
    .all();

  const totalMap = new Map(pointRows.map((r) => [r.memberId, Number(r.total ?? 0)]));
  const myPoints = totalMap.get(userId) ?? 0;
  const rank = [...totalMap.values()].filter((p) => p > myPoints).length + 1;

  return c.json({ data: { points: myPoints, rank } });
});

// ---- GET /api/ranking/history ----
// 自分のポイント獲得履歴（直近50件）
rankingRoutes.get("/history", async (c) => {
  const db = createDb(c.env.DB);
  const userId = c.get("userId");

  const txs = await db
    .select()
    .from(schema.pointTransactions)
    .where(eq(schema.pointTransactions.memberId, userId))
    .orderBy(desc(schema.pointTransactions.createdAt))
    .limit(50)
    .all();

  // relatedId から関連情報を補足（クエストタイトルなど）
  const questIds = txs
    .filter((t) => t.reason === "quest_normal_solved" || t.reason === "quest_hard_solved")
    .map((t) => t.relatedId)
    .filter((id): id is string => !!id);

  const quests = questIds.length > 0
    ? await db
        .select({ id: schema.quests.id, title: schema.quests.title, emoji: schema.quests.emoji })
        .from(schema.quests)
        .all()
    : [];
  const questMap = new Map(quests.map((q) => [q.id, q]));

  // 1on1: session ID からパートナー memberId を解決
  const sessionIds = txs
    .filter((t) => t.reason === "one_on_one_completed")
    .map((t) => t.relatedId)
    .filter((id): id is string => !!id);

  const sessions = sessionIds.length > 0
    ? await db
        .select({ id: schema.oneOnOneSessions.id, requesterId: schema.oneOnOneSessions.requesterId, responderId: schema.oneOnOneSessions.responderId })
        .from(schema.oneOnOneSessions)
        .all()
    : [];
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));

  // real_card_exchanged は relatedId = 相手の member ID
  const realCardMemberIds = txs
    .filter((t) => t.reason === "real_card_exchanged")
    .map((t) => t.relatedId)
    .filter((id): id is string => !!id);

  // event_participation は relatedId = eventCampaignId
  const eventCampaignIds = txs
    .filter((t) => t.reason === "event_participation")
    .map((t) => t.relatedId)
    .filter((id): id is string => !!id);
  const eventCampaigns = eventCampaignIds.length > 0
    ? await db.select({ id: schema.eventCampaigns.id, title: schema.eventCampaigns.title })
        .from(schema.eventCampaigns).all()
    : [];
  const eventCampaignMap = new Map(eventCampaigns.map((e) => [e.id, e]));

  // meeting_attendance は relatedId = meetingId
  const meetingAttendanceIds = txs
    .filter((t) => t.reason === "meeting_attendance")
    .map((t) => t.relatedId)
    .filter((id): id is string => !!id);
  const attendedMeetings = meetingAttendanceIds.length > 0
    ? await db.select({ id: schema.meetings.id, title: schema.meetings.title })
        .from(schema.meetings).all()
    : [];
  const meetingMap = new Map(attendedMeetings.map((m) => [m.id, m]));

  // 1on1 パートナー + real card 相手 の member IDs を収集
  const partnerMemberIds = new Set<string>();
  for (const tx of txs) {
    if (tx.reason === "one_on_one_completed" && tx.relatedId) {
      const s = sessionMap.get(tx.relatedId);
      if (s) partnerMemberIds.add(s.requesterId === userId ? s.responderId : s.requesterId);
    }
  }
  for (const id of realCardMemberIds) partnerMemberIds.add(id);

  const relatedMembers = partnerMemberIds.size > 0
    ? await db
        .select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji })
        .from(schema.members)
        .all()
    : [];
  const memberMap = new Map(relatedMembers.map((m) => [m.id, m]));

  // session ID → partner member ID のマップ
  const sessionToMember = new Map<string, typeof relatedMembers[number]>();
  for (const tx of txs) {
    if (tx.reason === "one_on_one_completed" && tx.relatedId) {
      const s = sessionMap.get(tx.relatedId);
      if (s) {
        const partnerId = s.requesterId === userId ? s.responderId : s.requesterId;
        const m = memberMap.get(partnerId);
        if (m) sessionToMember.set(tx.relatedId, m);
      }
    }
  }

  const REASON_LABEL: Record<string, string> = {
    one_on_one_completed:     "🤝 1to1完了",
    one_on_one_team_bonus:    "🤝 1to1チームボーナス",
    real_card_exchanged:      "🃏 リアルカード受け取り",
    quest_normal_solved:      "⚔️ お題クリア",
    quest_hard_solved:        "🔥 難題クリア",
    welcome_quest_bonus:      "🎉 歓迎クエストボーナス",
    visitor_invite_resolved:  "🙌 ゲスト招待達成",
    event_participation:      "🎯 イベント参加",
    meeting_attendance:       "📅 ミーティング出席",
    admin_reset:              "🔄 ポイントリセット",
    admin_adjust:             "✏️ 管理者調整",
  };

  const data = txs.map((t) => {
    const label = REASON_LABEL[t.reason] ?? t.reason;
    const quest = questMap.get(t.relatedId ?? "");
    const member = t.reason === "one_on_one_completed"
      ? sessionToMember.get(t.relatedId ?? "")
      : memberMap.get(t.relatedId ?? "");
    const eventCampaign = eventCampaignMap.get(t.relatedId ?? "");
    const attendedMeeting = meetingMap.get(t.relatedId ?? "");
    const detail = quest
      ? `${quest.emoji} ${quest.title}`
      : member
      ? `${member.emoji} ${member.name}`
      : eventCampaign
      ? eventCampaign.title
      : attendedMeeting
      ? attendedMeeting.title
      : undefined;

    return {
      id: t.id,
      delta: t.delta,
      reason: t.reason,
      label,
      detail,
      createdAt: t.createdAt,
    };
  });

  // 累計ポイントを計算（履歴に付与）
  const totalPoints = txs.reduce((sum, t) => sum + t.delta, 0);

  return c.json({ data, totalPoints });
});
