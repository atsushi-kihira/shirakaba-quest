// =============================================================
// ミーティング・定例会に紐づけるイベント（インスタンス）まわりの共通処理
// ポイントは「イベント種別」ではなく、管理画面で作成する「イベント（インスタンス）」の加算ポイント
// （multiplier）に設定する（種別の pointValue は「ポイントの対象種別か」を示す印で、ポイント数ではない）。
// イベントが紐づいていない旧データのミーティングだけ、従来どおり種別の値を使う。
// =============================================================
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";

export type MeetingEventOption = {
  id: string;
  title: string;
  description: string;
  typeDefId: string | null;
  typeName: string | null;
  typeEmoji: string | null;
  /** 出席1回あたりに付くポイント（0 = ポイントなし） */
  points: number;
  startsAt: number;
  endsAt: number | null;
};

/** ミーティングに紐づけられるイベント：実施中で期限が切れていない、ミーティング連携の種別のインスタンス */
export async function listMeetingEvents(db: Db): Promise<MeetingEventOption[]> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await db
    .select({ ev: schema.eventCampaigns, td: schema.eventTypeDefinitions })
    .from(schema.eventCampaigns)
    .innerJoin(schema.eventTypeDefinitions, eq(schema.eventTypeDefinitions.id, schema.eventCampaigns.eventTypeDefId))
    .where(and(
      eq(schema.eventCampaigns.status, "active"),
      eq(schema.eventTypeDefinitions.linksToMeeting, 1),
      eq(schema.eventTypeDefinitions.isActive, 1),
      sql`(${schema.eventCampaigns.endsAt} IS NULL OR ${schema.eventCampaigns.endsAt} >= ${now})`
    ))
    .orderBy(schema.eventTypeDefinitions.sortOrder, sql`${schema.eventCampaigns.startsAt} DESC`)
    .all();
  return rows.map(({ ev, td }) => ({
    id: ev.id, title: ev.title, description: ev.description,
    typeDefId: td.id, typeName: td.name, typeEmoji: td.emoji,
    points: ev.multiplier ?? 0,
    startsAt: ev.startsAt, endsAt: ev.endsAt,
  }));
}

/** ポイントのつかない、ミーティング連携の種別（「ミーティング」など）。イベント（インスタンス）を作らずにそのまま選べる */
export async function listPlainMeetingTypes(db: Db): Promise<{ id: string; name: string; emoji: string }[]> {
  const rows = await db.select({ id: schema.eventTypeDefinitions.id, name: schema.eventTypeDefinitions.name, emoji: schema.eventTypeDefinitions.emoji })
    .from(schema.eventTypeDefinitions)
    .where(and(
      eq(schema.eventTypeDefinitions.linksToMeeting, 1),
      eq(schema.eventTypeDefinitions.isActive, 1),
      eq(schema.eventTypeDefinitions.pointValue, 0)
    ))
    .orderBy(schema.eventTypeDefinitions.sortOrder, schema.eventTypeDefinitions.createdAt).all();
  return rows;
}

/**
 * 紐づけるイベントを検証し、保存する値（イベントIDと、その種別ID）を返す。
 * 指定なし（null）は「イベントなし」。実施中でない・期限切れ・存在しないイベントなら null を返す。
 */
export async function resolveEventCampaign(
  db: Db, eventCampaignId: string | null | undefined
): Promise<{ eventCampaignId: string; eventTypeDefId: string | null } | null> {
  if (!eventCampaignId) return null;
  const now = Math.floor(Date.now() / 1000);
  const ev = await db.select().from(schema.eventCampaigns).where(eq(schema.eventCampaigns.id, eventCampaignId)).get();
  if (!ev || ev.status !== "active" || (ev.endsAt !== null && ev.endsAt < now)) return null;
  return { eventCampaignId: ev.id, eventTypeDefId: ev.eventTypeDefId ?? null };
}

/** 出席1回あたりのポイント：紐づけたイベントの加算ポイント（イベントなし・旧データは種別の値） */
export async function attendancePointsFor(
  db: Db, meeting: { eventCampaignId: string | null; eventTypeDefId: string | null }
): Promise<number> {
  if (meeting.eventCampaignId) {
    const ev = await db.select({ multiplier: schema.eventCampaigns.multiplier })
      .from(schema.eventCampaigns).where(eq(schema.eventCampaigns.id, meeting.eventCampaignId)).get();
    return ev?.multiplier ?? 0;
  }
  if (meeting.eventTypeDefId) {
    const td = await db.select({ pointValue: schema.eventTypeDefinitions.pointValue })
      .from(schema.eventTypeDefinitions).where(eq(schema.eventTypeDefinitions.id, meeting.eventTypeDefId)).get();
    return td?.pointValue ?? 0;
  }
  return 0;
}
