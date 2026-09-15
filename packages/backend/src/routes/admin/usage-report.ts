// =============================================================
// 管理者向け 利用状況レポート
// GET /api/admin/usage-report — メンバーごとの利用件数（ログイン・機能別の内訳）
// =============================================================
import { Hono } from "hono";
import { eq, ne, sql } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import type { Env, Variables } from "../../types.ts";

export const adminUsageReportRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function toCountMap(rows: { memberId: string | null; cnt: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.memberId) map.set(r.memberId, r.cnt);
  }
  return map;
}

// ---- GET /api/admin/usage-report ----
adminUsageReportRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);

  const members = await db
    .select({ id: schema.members.id, name: schema.members.name, status: schema.members.status, createdAt: schema.members.createdAt })
    .from(schema.members)
    .where(ne(schema.members.status, "deleted"))
    .all();

  const [
    logins, lastLogins, oneOnOneAsRequester, oneOnOneAsResponder,
    contacts, contactsEight, eggs, geese, meetingsHosted, questAttempts, cardOrders, enishiSearches,
  ] = await Promise.all([
    db.select({ memberId: schema.authSessions.userId, cnt: sql<number>`count(*)`.as("cnt") })
      .from(schema.authSessions).where(eq(schema.authSessions.userType, "member"))
      .groupBy(schema.authSessions.userId).all(),
    db.select({ memberId: schema.authSessions.userId, last: sql<number>`max(${schema.authSessions.createdAt})`.as("last") })
      .from(schema.authSessions).where(eq(schema.authSessions.userType, "member"))
      .groupBy(schema.authSessions.userId).all(),
    db.select({ memberId: schema.oneOnOneSessions.requesterId, cnt: sql<number>`count(*)`.as("cnt") })
      .from(schema.oneOnOneSessions).groupBy(schema.oneOnOneSessions.requesterId).all(),
    db.select({ memberId: schema.oneOnOneSessions.responderId, cnt: sql<number>`count(*)`.as("cnt") })
      .from(schema.oneOnOneSessions).groupBy(schema.oneOnOneSessions.responderId).all(),
    db.select({ memberId: schema.externalContacts.ownerMemberId, cnt: sql<number>`count(*)`.as("cnt") })
      .from(schema.externalContacts).groupBy(schema.externalContacts.ownerMemberId).all(),
    db.select({ memberId: schema.externalContacts.ownerMemberId, cnt: sql<number>`count(*)`.as("cnt") })
      .from(schema.externalContacts).where(eq(schema.externalContacts.source, "eight"))
      .groupBy(schema.externalContacts.ownerMemberId).all(),
    db.select({ memberId: schema.goldenEggs.memberId, cnt: sql<number>`count(*)`.as("cnt") })
      .from(schema.goldenEggs).groupBy(schema.goldenEggs.memberId).all(),
    db.select({ memberId: schema.goldenGeese.memberId, cnt: sql<number>`count(*)`.as("cnt") })
      .from(schema.goldenGeese).groupBy(schema.goldenGeese.memberId).all(),
    db.select({ memberId: schema.meetings.hostMemberId, cnt: sql<number>`count(*)`.as("cnt") })
      .from(schema.meetings).groupBy(schema.meetings.hostMemberId).all(),
    db.select({ memberId: schema.questAttempts.memberId, cnt: sql<number>`count(*)`.as("cnt") })
      .from(schema.questAttempts).groupBy(schema.questAttempts.memberId).all(),
    db.select({ memberId: schema.cardOrders.memberId, cnt: sql<number>`count(*)`.as("cnt") })
      .from(schema.cardOrders).groupBy(schema.cardOrders.memberId).all(),
    db.select({ memberId: schema.enishiSearchHistory.memberId, cnt: sql<number>`count(*)`.as("cnt") })
      .from(schema.enishiSearchHistory).groupBy(schema.enishiSearchHistory.memberId).all(),
  ]);

  const loginMap = toCountMap(logins);
  const lastLoginMap = new Map(lastLogins.filter((r) => r.memberId).map((r) => [r.memberId as string, r.last]));
  const oneOnOneMap = new Map<string, number>();
  for (const r of oneOnOneAsRequester) if (r.memberId) oneOnOneMap.set(r.memberId, (oneOnOneMap.get(r.memberId) ?? 0) + r.cnt);
  for (const r of oneOnOneAsResponder) if (r.memberId) oneOnOneMap.set(r.memberId, (oneOnOneMap.get(r.memberId) ?? 0) + r.cnt);
  const contactMap = toCountMap(contacts);
  const contactEightMap = toCountMap(contactsEight);
  const eggMap = toCountMap(eggs);
  const gooseMap = toCountMap(geese);
  const meetingMap = toCountMap(meetingsHosted);
  const questMap = toCountMap(questAttempts);
  const cardOrderMap = toCountMap(cardOrders);
  const enishiMap = toCountMap(enishiSearches);

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

  return c.json({ data, generatedAt: Math.floor(Date.now() / 1000) });
});
