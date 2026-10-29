// =============================================================
// 利用状況の「訪問回数」の集計
// 訪問 = メンバーの一連の利用。最後の利用から30分あいたら、次の利用は別の訪問と数える（Google Analytics のセッションと同じ考え方）。
// 「利用」の時刻には、ログイン・アプリを開いた・画面を見た・各種の登録や操作（1to1の申込・回答・完了、人脈・金の卵・金のガチョウの登録、
// ミーティングの作成、お題への挑戦、カード発注、ご縁さがし）をすべて使う。
// 画面の閲覧やアプリを開いた記録は、記録の仕組みができた日以降にしかないため、それ以前の分は操作の時刻から数える。
// 外部ゲストの予約は、メンバー本人の操作ではないので使わない。
// =============================================================
import { and, eq, gte, lt, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";

export const VISIT_GAP_SECONDS = 30 * 60;

type TimedRow = { memberId: string | null; at: number | null };

/** メンバーごとの、利用があった時刻（秒）の一覧。fromSec 以上・toSec 未満。memberId を指定すると、そのメンバーだけ */
export async function collectActivityTimes(db: Db, opts: { fromSec: number; toSec: number; memberId?: string }): Promise<Map<string, number[]>> {
  const { fromSec, toSec, memberId } = opts;
  const out = new Map<string, number[]>();
  const add = (id: string | null | undefined, at: number | null | undefined) => {
    if (!id || at == null || at < fromSec || at >= toSec) return;
    const list = out.get(id);
    if (list) list.push(at); else out.set(id, [at]);
  };
  const where = (memberCol: AnyColumn, atCol: AnyColumn, extra?: SQL): SQL | undefined =>
    and(gte(atCol, fromSec), lt(atCol, toSec), memberId ? eq(memberCol, memberId) : undefined, extra);

  const { authSessions, accessLogs, screenViews, externalContacts, goldenEggs, goldenGeese, meetings, questAttempts, cardOrders, enishiSearchHistory, oneOnOneSessions } = schema;
  const lists: TimedRow[][] = await Promise.all([
    db.select({ memberId: authSessions.userId, at: authSessions.createdAt }).from(authSessions)
      .where(where(authSessions.userId, authSessions.createdAt, eq(authSessions.userType, "member"))).all(),
    db.select({ memberId: accessLogs.memberId, at: accessLogs.createdAt }).from(accessLogs).where(where(accessLogs.memberId, accessLogs.createdAt)).all(),
    db.select({ memberId: screenViews.memberId, at: screenViews.createdAt }).from(screenViews).where(where(screenViews.memberId, screenViews.createdAt)).all(),
    // ゲストの回答で自動登録された人脈は、本人の操作ではない
    db.select({ memberId: externalContacts.ownerMemberId, at: externalContacts.createdAt }).from(externalContacts)
      .where(where(externalContacts.ownerMemberId, externalContacts.createdAt, sql`${externalContacts.source} <> 'guest'`)).all(),
    db.select({ memberId: goldenEggs.memberId, at: goldenEggs.createdAt }).from(goldenEggs).where(where(goldenEggs.memberId, goldenEggs.createdAt)).all(),
    db.select({ memberId: goldenGeese.memberId, at: goldenGeese.createdAt }).from(goldenGeese).where(where(goldenGeese.memberId, goldenGeese.createdAt)).all(),
    db.select({ memberId: meetings.hostMemberId, at: meetings.createdAt }).from(meetings).where(where(meetings.hostMemberId, meetings.createdAt)).all(),
    db.select({ memberId: questAttempts.memberId, at: questAttempts.attemptedAt }).from(questAttempts).where(where(questAttempts.memberId, questAttempts.attemptedAt)).all(),
    db.select({ memberId: cardOrders.memberId, at: cardOrders.createdAt }).from(cardOrders).where(where(cardOrders.memberId, cardOrders.createdAt)).all(),
    db.select({ memberId: enishiSearchHistory.memberId, at: enishiSearchHistory.createdAt }).from(enishiSearchHistory)
      .where(where(enishiSearchHistory.memberId, enishiSearchHistory.createdAt)).all(),
  ]);
  for (const list of lists) for (const r of list) add(r.memberId, r.at);

  // 1to1：申込・回答・完了のそれぞれを、その操作をした本人の利用として数える
  const sessions = await db.select({
    requesterId: oneOnOneSessions.requesterId, responderId: oneOnOneSessions.responderId,
    requestedAt: oneOnOneSessions.requestedAt, respondedAt: oneOnOneSessions.respondedAt,
    requesterCompletedAt: oneOnOneSessions.requesterCompletedAt, responderCompletedAt: oneOnOneSessions.responderCompletedAt,
  }).from(oneOnOneSessions)
    .where(memberId ? or(eq(oneOnOneSessions.requesterId, memberId), eq(oneOnOneSessions.responderId, memberId)) : undefined).all();
  for (const ss of sessions) {
    if (!memberId || ss.requesterId === memberId) { add(ss.requesterId, ss.requestedAt); add(ss.requesterId, ss.requesterCompletedAt); }
    if (!memberId || ss.responderId === memberId) { add(ss.responderId, ss.respondedAt); add(ss.responderId, ss.responderCompletedAt); }
  }
  return out;
}

/** 利用の時刻の一覧から、訪問の開始時刻を求める（前の利用から30分以上あいたら、新しい訪問） */
export function visitStarts(times: number[]): number[] {
  const sorted = [...times].sort((a, b) => a - b);
  const starts: number[] = [];
  let prev = -Infinity;
  for (const t of sorted) {
    if (t - prev >= VISIT_GAP_SECONDS) starts.push(t);
    prev = t;
  }
  return starts;
}
