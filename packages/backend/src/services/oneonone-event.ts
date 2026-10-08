// =============================================================
// 1to1に結びつけるイベント（インスタンス）まわりの共通処理
// ・メンバーとの1to1向け（target='member'）／ビジター（外部ゲスト）との1to1向け（target='visitor'）に分かれる
// ・ポイントはイベントの加算ポイント（multiplier）。未設定ならポイントなし
// ・イベントを結びつけていない従来の1to1は、シーズン設定のポイントで完了する
// =============================================================
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { newId } from "./auth.ts";

export type OneOnOneTarget = "member" | "visitor";

export type OneOnOneEventOption = {
  id: string; title: string; description: string;
  typeName: string | null; typeEmoji: string | null;
  /** 1to1実施1回あたりに付くポイント（0 = ポイントなし） */
  points: number;
};

/** 選べる1to1イベント：実施中で期限が切れていない、1to1連携の種別の、指定した向き（メンバー／ビジター）のイベント */
export async function listOneOnOneEvents(db: Db, target: OneOnOneTarget): Promise<OneOnOneEventOption[]> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await db
    .select({ ev: schema.eventCampaigns, td: schema.eventTypeDefinitions })
    .from(schema.eventCampaigns)
    .innerJoin(schema.eventTypeDefinitions, eq(schema.eventTypeDefinitions.id, schema.eventCampaigns.eventTypeDefId))
    .where(and(
      eq(schema.eventCampaigns.status, "active"),
      eq(schema.eventCampaigns.oneOnOneTarget, target),
      eq(schema.eventTypeDefinitions.linksToOneOnOne, 1),
      eq(schema.eventTypeDefinitions.isActive, 1),
      sql`(${schema.eventCampaigns.endsAt} IS NULL OR ${schema.eventCampaigns.endsAt} >= ${now})`
    ))
    .orderBy(schema.eventTypeDefinitions.sortOrder, schema.eventCampaigns.createdAt)
    .all();
  return rows.map(({ ev, td }) => ({
    id: ev.id, title: ev.title, description: ev.description,
    typeName: td.name, typeEmoji: td.emoji, points: ev.multiplier ?? 0,
  }));
}

/** 選んだ1to1イベントが、その向きで今使えるか確認する（使えなければ null） */
export async function resolveOneOnOneEvent(db: Db, eventCampaignId: string | null | undefined, target: OneOnOneTarget): Promise<string | null> {
  if (!eventCampaignId) return null;
  const options = await listOneOnOneEvents(db, target);
  return options.some((o) => o.id === eventCampaignId) ? eventCampaignId : null;
}

/** 1to1イベントのポイント（イベントなしは null = 従来どおりシーズン設定を使う） */
export async function oneOnOneEventPoints(db: Db, eventCampaignId: string | null | undefined): Promise<number | null> {
  if (!eventCampaignId) return null;
  const ev = await db.select({ multiplier: schema.eventCampaigns.multiplier }).from(schema.eventCampaigns)
    .where(eq(schema.eventCampaigns.id, eventCampaignId)).get();
  return ev ? (ev.multiplier ?? 0) : null;
}

/**
 * ビジター（外部ゲスト）との1to1を実施したときに、主催メンバーへ、招待時に選んだイベントのポイントを付与する。
 * 「実施した」と主催者が確認した時点（人脈に追加／今回は追加しない）で、予約1件につき1回だけ付与する。
 */
export async function awardVisitorOneOnOnePoints(db: Db, bookingId: string, hostMemberId: string): Promise<number> {
  const booking = await db.select({
    id: schema.bookings.id, guestMemberId: schema.bookings.guestMemberId, guestInviteId: schema.bookings.guestInviteId,
  }).from(schema.bookings)
    .where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.hostMemberId, hostMemberId))).get();
  if (!booking?.guestInviteId) return 0;

  // 相手が承認済みメンバーなら、ビジターとの1to1ではない（メンバー同士の1to1として別に扱う）
  if (booking.guestMemberId) {
    const m = await db.select({ status: schema.members.status }).from(schema.members).where(eq(schema.members.id, booking.guestMemberId)).get();
    if (m?.status === "active") return 0;
  }

  const invite = await db.select({ eventCampaignId: schema.oneOnOneGuestInvites.eventCampaignId }).from(schema.oneOnOneGuestInvites)
    .where(eq(schema.oneOnOneGuestInvites.id, booking.guestInviteId)).get();
  const points = await oneOnOneEventPoints(db, invite?.eventCampaignId);
  if (!points || points <= 0) return 0;

  const already = await db.select({ id: schema.pointTransactions.id }).from(schema.pointTransactions)
    .where(and(eq(schema.pointTransactions.reason, "visitor_one_on_one_completed"), eq(schema.pointTransactions.relatedId, bookingId))).get();
  if (already) return 0;

  await db.insert(schema.pointTransactions).values({
    id: newId(), memberId: hostMemberId, delta: points,
    reason: "visitor_one_on_one_completed", relatedId: bookingId, createdAt: Math.floor(Date.now() / 1000),
  });
  return points;
}
