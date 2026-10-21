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
import { VIEW_SCREENS, isValidTimeZone, localParts, periodRange, summarizeAccess, type AccessUnit } from "../../services/access-log.ts";
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

/** メンバーごとの、最も新しい利用の日時（ログイン・アプリを開いた・画面の閲覧・登録や操作のうち最新のもの） */
async function lastTimesByMember(db: ReturnType<typeof createDb>): Promise<Map<string, number>> {
  const q = <T extends { memberId: string | null; last: number }>(p: Promise<T[]>) => p;
  const lists = await Promise.all([
    q(db.select({ memberId: schema.authSessions.userId, last: sql<number>`max(${schema.authSessions.createdAt})` }).from(schema.authSessions).where(eq(schema.authSessions.userType, "member")).groupBy(schema.authSessions.userId).all()),
    q(db.select({ memberId: schema.accessLogs.memberId, last: sql<number>`max(${schema.accessLogs.createdAt})` }).from(schema.accessLogs).groupBy(schema.accessLogs.memberId).all()),
    q(db.select({ memberId: schema.screenViews.memberId, last: sql<number>`max(${schema.screenViews.createdAt})` }).from(schema.screenViews).groupBy(schema.screenViews.memberId).all()),
    q(db.select({ memberId: schema.externalContacts.ownerMemberId, last: sql<number>`max(${schema.externalContacts.createdAt})` }).from(schema.externalContacts).groupBy(schema.externalContacts.ownerMemberId).all()),
    q(db.select({ memberId: schema.goldenEggs.memberId, last: sql<number>`max(${schema.goldenEggs.createdAt})` }).from(schema.goldenEggs).groupBy(schema.goldenEggs.memberId).all()),
    q(db.select({ memberId: schema.goldenGeese.memberId, last: sql<number>`max(${schema.goldenGeese.createdAt})` }).from(schema.goldenGeese).groupBy(schema.goldenGeese.memberId).all()),
    q(db.select({ memberId: schema.meetings.hostMemberId, last: sql<number>`max(${schema.meetings.createdAt})` }).from(schema.meetings).groupBy(schema.meetings.hostMemberId).all()),
    q(db.select({ memberId: schema.questAttempts.memberId, last: sql<number>`max(${schema.questAttempts.attemptedAt})` }).from(schema.questAttempts).groupBy(schema.questAttempts.memberId).all()),
    q(db.select({ memberId: schema.cardOrders.memberId, last: sql<number>`max(${schema.cardOrders.createdAt})` }).from(schema.cardOrders).groupBy(schema.cardOrders.memberId).all()),
    q(db.select({ memberId: schema.enishiSearchHistory.memberId, last: sql<number>`max(${schema.enishiSearchHistory.createdAt})` }).from(schema.enishiSearchHistory).groupBy(schema.enishiSearchHistory.memberId).all()),
  ]);
  const map = new Map<string, number>();
  for (const list of lists) for (const r of list) {
    if (r.memberId && r.last != null && r.last > (map.get(r.memberId) ?? 0)) map.set(r.memberId, r.last);
  }
  return map;
}

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
    logins,
    contacts, eggs, geese, meetingsHosted, questAttempts, cardOrders, enishiSearches, screenViewRows,
    accessRows, sessionsAll, bookingRows, lastTimes,
  ] = await Promise.all([
    db.select({ memberId: schema.authSessions.userId, at: schema.authSessions.createdAt })
      .from(schema.authSessions)
      .where(sql`${schema.authSessions.userType} = 'member' AND ${schema.authSessions.createdAt} >= ${fromSec} AND ${schema.authSessions.createdAt} < ${toSec}`).all(),
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
    // 画面の閲覧（ホーム・ミーティング・通知などを見ただけの利用）。記録の仕組みができる前の分はない
    db.select({ memberId: schema.screenViews.memberId, at: schema.screenViews.createdAt, screen: schema.screenViews.screen })
      .from(schema.screenViews)
      .where(sql`${schema.screenViews.createdAt} >= ${fromSec} AND ${schema.screenViews.createdAt} < ${toSec}`).all(),
    // ログイン済みのまま使い続けた日（アプリを開いた記録）
    db.select({ memberId: schema.accessLogs.memberId, at: schema.accessLogs.createdAt })
      .from(schema.accessLogs)
      .where(sql`${schema.accessLogs.createdAt} >= ${fromSec} AND ${schema.accessLogs.createdAt} < ${toSec}`).all(),
    // 1to1（メンバー同士）。件数の数え方と、「その日に操作があった」ことの確認（申込・回答・完了の日）の両方に使う
    db.select({
      requesterId: schema.oneOnOneSessions.requesterId, responderId: schema.oneOnOneSessions.responderId,
      requestedAt: schema.oneOnOneSessions.requestedAt, respondedAt: schema.oneOnOneSessions.respondedAt,
      requesterCompletedAt: schema.oneOnOneSessions.requesterCompletedAt, responderCompletedAt: schema.oneOnOneSessions.responderCompletedAt,
    }).from(schema.oneOnOneSessions).all(),
    // 1to1（外部ゲストとの予約・公開予約ページ経由の予約）。メンバー同士の1to1の申込に紐づく予約は、そちらで数えるので除く。キャンセルは数えない
    db.select({
      hostMemberId: schema.bookings.hostMemberId, guestMemberId: schema.bookings.guestMemberId, createdAt: schema.bookings.createdAt,
    }).from(schema.bookings).where(sql`${schema.bookings.oneOnOneSessionId} IS NULL AND ${schema.bookings.status} != 'cancelled'`).all(),
    // 最終ログイン・利用の日時：期間に関係なく、これまでで最も新しいもの（ログイン、アプリを開いた、画面を見た、各種の登録・操作）
    lastTimesByMember(db),
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

  // 指定した期間に入る日時か
  const inRange = (at: number): boolean => {
    if (!range) return true;
    const { ymd } = localParts(at, tz);
    return ymd >= range.rangeStart && ymd <= range.rangeEnd;
  };
  // 外部ゲストとの予約は、作成日時（ISO形式の文字列）を秒に直して数える
  const bookingEvents = bookingRows.flatMap((b) => {
    const at = Math.floor(Date.parse(b.createdAt) / 1000);
    return Number.isFinite(at) ? [{ ...b, at }] : [];
  });

  // ログイン（回数）＝ログインした日、または、ログイン済みのまま利用した日の数。
  // ログイン済みだとログイン画面を通らないため、新しいログインの記録だけでは利用が数えられない。そこで、次のどれかがあった日を1日と数える。
  //  ・新しいログイン、アプリを開いた記録、画面を見た記録
  //  ・その日に行った操作の記録（1to1の申込・回答・完了、人脈・金の卵・ガチョウの登録、ミーティングの作成、お題への挑戦、カード発注、ご縁さがし、外部ゲストとの予約）
  //    ※ アプリを開いた・画面を見た記録は、記録の仕組みができた日以降にしかないため、それ以前の分は操作の記録で補っている
  const loginDays = new Map<string, Set<string>>();
  const addUseDay = (memberId: string | null | undefined, at: number | null | undefined) => {
    if (!memberId || at == null || !inRange(at)) return;
    const set = loginDays.get(memberId) ?? new Set<string>();
    set.add(localParts(at, tz).ymd);
    loginDays.set(memberId, set);
  };
  for (const list of [logins, accessRows, screenViewRows, contacts, eggs, geese, meetingsHosted, questAttempts, cardOrders, enishiSearches] as TimedRow[][]) {
    for (const r of list) addUseDay(r.memberId, r.at);
  }
  for (const ss of sessionsAll) {
    addUseDay(ss.requesterId, ss.requestedAt);
    addUseDay(ss.requesterId, ss.requesterCompletedAt);
    addUseDay(ss.responderId, ss.respondedAt);
    addUseDay(ss.responderId, ss.responderCompletedAt);
  }
  for (const b of bookingEvents) addUseDay(b.hostMemberId, b.at);
  const loginMap = new Map([...loginDays].map(([id, days]) => [id, days.size]));

  // 最終ログイン・利用の日時：期間に関係なく、これまでで最も新しいもの
  const lastLoginMap = new Map(lastTimes);
  for (const ss of sessionsAll) {
    for (const [id, at] of [[ss.requesterId, ss.requestedAt], [ss.requesterId, ss.requesterCompletedAt], [ss.responderId, ss.respondedAt], [ss.responderId, ss.responderCompletedAt]] as [string, number | null][]) {
      if (id && at != null && at > (lastLoginMap.get(id) ?? 0)) lastLoginMap.set(id, at);
    }
  }
  for (const b of bookingEvents) if (b.at > (lastLoginMap.get(b.hostMemberId) ?? 0)) lastLoginMap.set(b.hostMemberId, b.at);

  // 1to1の件数：メンバー同士の申込（申込者・回答者のそれぞれ）＋ 外部ゲストとの予約・公開予約ページ経由の予約（主催者・予約したメンバーのそれぞれ）
  const oneOnOneMap = new Map<string, number>();
  const addOneOnOne = (id: string | null | undefined) => { if (id) oneOnOneMap.set(id, (oneOnOneMap.get(id) ?? 0) + 1); };
  for (const ss of sessionsAll) {
    if (!inRange(ss.requestedAt)) continue;
    addOneOnOne(ss.requesterId);
    addOneOnOne(ss.responderId);
  }
  for (const b of bookingEvents) {
    if (!inRange(b.at)) continue;
    addOneOnOne(b.hostMemberId);
    if (b.guestMemberId && b.guestMemberId !== b.hostMemberId) addOneOnOne(b.guestMemberId);
  }
  const contactMap = countByMember(contacts);
  const contactEightMap = countByMember(contacts.filter((r) => r.source === "eight"));
  const eggMap = countByMember(eggs);
  const gooseMap = countByMember(geese);
  const meetingMap = countByMember(meetingsHosted);
  const questMap = countByMember(questAttempts);
  const cardOrderMap = countByMember(cardOrders);
  const enishiMap = countByMember(enishiSearches);
  const viewMap = countByMember(screenViewRows);
  // 画面ごとの閲覧回数の内訳（対象メンバーのみ。管理画面の「情報参照」の説明に使う）
  const memberIdSet = new Set(members.map((m) => m.id));
  const viewBreakdown: Record<string, number> = {};
  for (const r of screenViewRows) {
    if (!r.memberId || !memberIdSet.has(r.memberId)) continue;
    if (range) {
      const { ymd } = localParts(r.at, tz);
      if (ymd < range.rangeStart || ymd > range.rangeEnd) continue;
    }
    viewBreakdown[r.screen] = (viewBreakdown[r.screen] ?? 0) + 1;
  }

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
    const view = viewMap.get(m.id) ?? 0;
    return {
      id: m.id,
      name: m.name,
      status: m.status,
      registeredAt: m.createdAt,
      lastLoginAt: lastLoginMap.get(m.id) ?? null,
      login, oneonone, contact, contactEight, egg, goose, meeting, quest, cardOrder, enishi, view,
      // 合計は、データを作る・更新する操作の件数（画面を見ただけの「情報参照」は含めない）
      total: login + oneonone + contact + egg + goose + meeting + quest + cardOrder + enishi,
    };
  });

  return c.json({
    data,
    unit,
    rangeStart: range?.rangeStart ?? null,
    rangeEnd: range?.rangeEnd ?? null,
    viewBreakdown: Object.entries(viewBreakdown)
      .map(([screen, count]) => ({ screen, label: VIEW_SCREENS[screen] ?? screen, count }))
      .sort((a, b) => b.count - a.count),
    generatedAt: Math.floor(Date.now() / 1000),
  });
});
