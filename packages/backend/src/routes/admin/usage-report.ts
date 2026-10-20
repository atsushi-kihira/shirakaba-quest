// =============================================================
// 管理者向け 利用状況レポート
// GET /api/admin/usage-report?unit=day|week|month|all&date=YYYY-MM-DD&tz=Asia/Tokyo — メンバーごとの利用件数（ログイン・機能別の内訳）。
//   unit を省略すると累計。日・週・月を指定すると、その期間（date を含む期間）の件数
// GET /api/admin/usage-report/access?unit=day|week|month&date=YYYY-MM-DD&tz=Asia/Tokyo — アクセス数（棒グラフ用）
//
// 集計対象は必ず「一般ユーザー（メンバー）向け機能」に限定すること。管理ダッシュボード側の操作
// （メンバー承認、カード発注ステータス変更、ポイント調整など admin/ 配下のルートが行う操作）は
// 対象テーブルへの書き込み元にしないこと。各カウントの根拠となるテーブルへの書き込みは、
// 現状すべて authMiddleware配下の一般メンバー向けルート（auth.ts, oneonone.ts, collab.ts,
// enishi.ts, meetings.ts / meeting-series.ts, quests.ts, card-orders.ts, register.ts）からのみ
// 行われている（admin/配下のルートは既存データの閲覧・状態変更のみで、新規作成は行わない）。
// 新しい集計項目を追加する際も、この前提（admin/ルートが書き込み元にならないこと）を必ず確認すること。
// =============================================================
import { Hono } from "hono";
import { eq, ne, sql } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { isValidTimeZone, localParts, periodRange, summarizeAccess, type AccessUnit } from "../../services/access-log.ts";
import type { Env, Variables } from "../../types.ts";

export const adminUsageReportRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function toCountMap(rows: { memberId: string | null; cnt: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.memberId) map.set(r.memberId, r.cnt);
  }
  return map;
}

// ---- GET /api/admin/usage-report/access ----
// unit: day（1時間ごと）／ week（曜日ごと・月曜始まり）／ month（その月の日ごと）。date は表示したい期間に含まれる日。
adminUsageReportRoutes.get("/access", async (c) => {
  const db = createDb(c.env.DB);
  const unitParam = c.req.query("unit");
  const unit: AccessUnit = unitParam === "week" || unitParam === "month" ? unitParam : "day";
  const date = c.req.query("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: { code: "invalid_input", message: "日付の形式が正しくありません" } }, 400);
  }
  const tz = c.req.query("tz") ?? "Asia/Tokyo";
  return c.json({ data: await summarizeAccess(db, unit, date, tz) });
});

// ---- GET /api/admin/usage-report ----
type TimedRow = { memberId: string | null; at: number };

adminUsageReportRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);

  const unitParam = c.req.query("unit");
  const unit: AccessUnit | "all" = unitParam === "day" || unitParam === "week" || unitParam === "month" ? unitParam : "all";
  const date = c.req.query("date") ?? "";
  if (unit !== "all" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: { code: "invalid_input", message: "日付の形式が正しくありません" } }, 400);
  }
  const tzParam = c.req.query("tz") ?? "Asia/Tokyo";
  const tz = isValidTimeZone(tzParam) ? tzParam : "Asia/Tokyo";

  // 期間の指定があるときは、タイムゾーンのずれを見込んで前後1日ずつ広めに取り、日付で絞り込む
  const range = unit === "all" ? null : periodRange(unit, date);
  const DAY_SEC = 24 * 60 * 60;
  const fromSec = range ? Math.floor(range.startMs / 1000) - DAY_SEC : 0;
  const toSec = range ? Math.floor(range.endMs / 1000) + 2 * DAY_SEC : Number.MAX_SAFE_INTEGER;

  const members = await db
    .select({ id: schema.members.id, name: schema.members.name, status: schema.members.status, createdAt: schema.members.createdAt })
    .from(schema.members)
    .where(ne(schema.members.status, "deleted"))
    .all();

  const [
    logins, lastLogins, oneOnOneAsRequester, oneOnOneAsResponder,
    contacts, eggs, geese, meetingsHosted, questAttempts, cardOrders, enishiSearches,
  ] = await Promise.all([
    db.select({ memberId: schema.authSessions.userId, at: schema.authSessions.createdAt })
      .from(schema.authSessions)
      .where(sql`${schema.authSessions.userType} = 'member' AND ${schema.authSessions.createdAt} >= ${fromSec} AND ${schema.authSessions.createdAt} < ${toSec}`).all(),
    // 最終ログインは、期間に関係なく、これまでで最も新しいログイン
    db.select({ memberId: schema.authSessions.userId, last: sql<number>`max(${schema.authSessions.createdAt})`.as("last") })
      .from(schema.authSessions).where(eq(schema.authSessions.userType, "member"))
      .groupBy(schema.authSessions.userId).all(),
    db.select({ memberId: schema.oneOnOneSessions.requesterId, at: schema.oneOnOneSessions.requestedAt })
      .from(schema.oneOnOneSessions)
      .where(sql`${schema.oneOnOneSessions.requestedAt} >= ${fromSec} AND ${schema.oneOnOneSessions.requestedAt} < ${toSec}`).all(),
    db.select({ memberId: schema.oneOnOneSessions.responderId, at: schema.oneOnOneSessions.requestedAt })
      .from(schema.oneOnOneSessions)
      .where(sql`${schema.oneOnOneSessions.requestedAt} >= ${fromSec} AND ${schema.oneOnOneSessions.requestedAt} < ${toSec}`).all(),
    db.select({ memberId: schema.externalContacts.ownerMemberId, at: schema.externalContacts.createdAt, source: schema.externalContacts.source })
      .from(schema.externalContacts)
      .where(sql`${schema.externalContacts.createdAt} >= ${fromSec} AND ${schema.externalContacts.createdAt} < ${toSec}`).all(),
    db.select({ memberId: schema.goldenEggs.memberId, at: schema.goldenEggs.createdAt })
      .from(schema.goldenEggs)
      .where(sql`${schema.goldenEggs.createdAt} >= ${fromSec} AND ${schema.goldenEggs.createdAt} < ${toSec}`).all(),
    db.select({ memberId: schema.goldenGeese.memberId, at: schema.goldenGeese.createdAt })
      .from(schema.goldenGeese)
      .where(sql`${schema.goldenGeese.createdAt} >= ${fromSec} AND ${schema.goldenGeese.createdAt} < ${toSec}`).all(),
    db.select({ memberId: schema.meetings.hostMemberId, at: schema.meetings.createdAt })
      .from(schema.meetings)
      .where(sql`${schema.meetings.createdAt} >= ${fromSec} AND ${schema.meetings.createdAt} < ${toSec}`).all(),
    db.select({ memberId: schema.questAttempts.memberId, at: schema.questAttempts.attemptedAt })
      .from(schema.questAttempts)
      .where(sql`${schema.questAttempts.attemptedAt} >= ${fromSec} AND ${schema.questAttempts.attemptedAt} < ${toSec}`).all(),
    db.select({ memberId: schema.cardOrders.memberId, at: schema.cardOrders.createdAt })
      .from(schema.cardOrders)
      .where(sql`${schema.cardOrders.createdAt} >= ${fromSec} AND ${schema.cardOrders.createdAt} < ${toSec}`).all(),
    db.select({ memberId: schema.enishiSearchHistory.memberId, at: schema.enishiSearchHistory.createdAt })
      .from(schema.enishiSearchHistory)
      .where(sql`${schema.enishiSearchHistory.createdAt} >= ${fromSec} AND ${schema.enishiSearchHistory.createdAt} < ${toSec}`).all(),
  ]);

  // 指定した期間（タイムゾーンでの日付）に入る行だけを、メンバーごとに数える
  function countByMember(rows: TimedRow[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const r of rows) {
      if (!r.memberId) continue;
      if (range) {
        const { ymd } = localParts(r.at, tz);
        if (ymd < range.rangeStart || ymd > range.rangeEnd) continue;
      }
      map.set(r.memberId, (map.get(r.memberId) ?? 0) + 1);
    }
    return map;
  }

  const loginMap = countByMember(logins);
  const lastLoginMap = new Map(lastLogins.filter((r) => r.memberId).map((r) => [r.memberId as string, r.last]));
  const oneOnOneMap = new Map<string, number>();
  for (const [id, n] of countByMember(oneOnOneAsRequester)) oneOnOneMap.set(id, (oneOnOneMap.get(id) ?? 0) + n);
  for (const [id, n] of countByMember(oneOnOneAsResponder)) oneOnOneMap.set(id, (oneOnOneMap.get(id) ?? 0) + n);
  const contactMap = countByMember(contacts);
  const contactEightMap = countByMember(contacts.filter((r) => r.source === "eight"));
  const eggMap = countByMember(eggs);
  const gooseMap = countByMember(geese);
  const meetingMap = countByMember(meetingsHosted);
  const questMap = countByMember(questAttempts);
  const cardOrderMap = countByMember(cardOrders);
  const enishiMap = countByMember(enishiSearches);

  const data = members.map((m) => {
    const login = loginMap.get(m.id) ?? 0;
    const oneonone = oneOnOneMap.get(m.id) ?? 0;
    const contact = contactMap.get(m.id) ?? 0;
    const contactEight = contactEightMap.get(m.id) ?? 0;
    const egg = eggMap.get(m.id) ?? 0;
    const goose = gooseMap.get(m.id) ?? 0;
    const meeting = meetingMap.get(m.id) ?? 0;
    const quest = questMap.get(m.id) ?? 0;
    const cardOrder = cardOrderMap.get(m.id) ?? 0;
    const enishi = enishiMap.get(m.id) ?? 0;
    return {
      id: m.id,
      name: m.name,
      status: m.status,
      registeredAt: m.createdAt,
      lastLoginAt: lastLoginMap.get(m.id) ?? null,
      login, oneonone, contact, contactEight, egg, goose, meeting, quest, cardOrder, enishi,
      total: login + oneonone + contact + egg + goose + meeting + quest + cardOrder + enishi,
    };
  });

  return c.json({
    data,
    unit,
    rangeStart: range?.rangeStart ?? null,
    rangeEnd: range?.rangeEnd ?? null,
    generatedAt: Math.floor(Date.now() / 1000),
  });
});
