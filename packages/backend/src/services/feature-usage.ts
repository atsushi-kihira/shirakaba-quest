// =============================================================
// メンバーごとの機能の利用状況と、おすすめ機能の選定
// 管理ダッシュボードの「お知らせ配信」で、受信者ごとに文面を出し分けるために使う。
// 「利用した」の判定は、メンバー本人の操作で作られるデータが1件以上あるかどうかで決める。
// =============================================================
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";

export type FeatureKey =
  | "oneonone" | "contacts" | "enishi_register" | "enishi_search" | "meetings"
  | "scheduler" | "collab" | "quests" | "card_order" | "push";

export type FeatureDef = {
  key: FeatureKey;
  name: string;
  emoji: string;
  /** アプリ内の移動先（メールではアプリのURLと組み合わせてリンクにする） */
  path: string;
  /** 利用するメリット（おすすめ文面に使う） */
  benefit: string;
};

// 並び順は、おすすめするときの優先順（利用回数が同じなら上にあるものを先に勧める）
export const FEATURES: FeatureDef[] = [
  {
    key: "oneonone", name: "1to1ミーティング", emoji: "🤝", path: "/members",
    benefit: "なかまと1to1を重ねるほど、お互いの事業や人柄への理解が深まり、紹介やご縁につながりやすくなります。完了するとポイントも貯まります。",
  },
  {
    key: "contacts", name: "外部人脈の登録", emoji: "📇", path: "/members?tab=contacts",
    benefit: "ご自身の人脈を登録しておくと、なかまの「金の卵」に紹介できそうな方をAIが見つけてくれて、貢献のチャンスが広がります。",
  },
  {
    key: "enishi_register", name: "金の卵・金のガチョウの登録", emoji: "🥚", path: "/enishi/register",
    benefit: "求めている出会いを登録しておくと、なかまの人脈の中から、紹介につながる道筋をAIが探してくれます。",
  },
  {
    key: "enishi_search", name: "ご縁さがし（AI検索）", emoji: "🔎", path: "/enishi",
    benefit: "条件に合う人を、なかま全員の人脈から横断的に探せます。紹介をお願いしたい相手がすぐに見つかります。",
  },
  {
    key: "meetings", name: "ミーティングの主催・日程調整", emoji: "📅", path: "/meetings",
    benefit: "候補日を出して回答を集めるだけで日程が決まり、会議URLも自動で発行されます。日程調整の手間が大きく減ります。",
  },
  {
    key: "scheduler", name: "Google／Zoom連携", emoji: "🔗", path: "/scheduler/integrations",
    benefit: "カレンダーと連携すると、空き時間の自動確認・会議URLの自動発行・予定の自動登録ができて、ダブルブッキングも防げます。",
  },
  {
    key: "collab", name: "協働（チーム・活動の記録）", emoji: "⚡", path: "/collab",
    benefit: "チームでの活動や、次回までのアクションを記録・共有できます。メンバー同士の関係性も見える化されます。",
  },
  {
    key: "quests", name: "お題への挑戦", emoji: "📜", path: "/quests",
    benefit: "なかまのスキルを組み合わせてお題に挑戦すると、ポイントが獲得できて、相手の強みも自然に知ることができます。",
  },
  {
    key: "card_order", name: "名刺カードの注文", emoji: "🃏", path: "/card-order",
    benefit: "ご自身のカードを手元に用意しておくと、リアルカードの受け渡しでポイントが貯まり、1to1の場でも話が弾みます。",
  },
  {
    key: "push", name: "スマホへのプッシュ通知", emoji: "📱", path: "/me",
    benefit: "お知らせや1to1の連絡がスマホにすぐ届くので、大事な連絡の見逃しを防げます。マイページから設定できます。",
  },
];

export const FEATURE_MAP = new Map(FEATURES.map((f) => [f.key, f]));

// 利用回数がこの数以上の機能は「十分に使っている」とみなし、おすすめの対象から外す
const ENOUGH_USAGE_COUNT = 3;
// 1通に載せるおすすめ機能の最大数（多すぎると読まれないため）
export const MAX_RECOMMENDATIONS = 3;

export type MemberUsage = {
  /** 機能ごとの利用回数（関連データの件数） */
  counts: Record<FeatureKey, number>;
  used: FeatureKey[];
  unused: FeatureKey[];
  /** 今回おすすめしたい機能（未利用・利用が少ないものを優先） */
  recommended: FeatureKey[];
};

type CountMap = Map<string, number>;

async function grouped(rows: Promise<{ id: string; n: number }[]>): Promise<CountMap> {
  const map: CountMap = new Map();
  for (const r of await rows) map.set(r.id, (map.get(r.id) ?? 0) + Number(r.n));
  return map;
}

function mergeMaps(...maps: CountMap[]): CountMap {
  const out: CountMap = new Map();
  for (const m of maps) for (const [k, v] of m) out.set(k, (out.get(k) ?? 0) + v);
  return out;
}

/** 全メンバー分の機能利用状況を、機能ごとの集計クエリで一括取得する（メンバー数が多くても件数は一定） */
export async function computeFeatureUsage(db: Db): Promise<Map<string, MemberUsage>> {
  const cnt = sql<number>`count(*)`;

  const [
    oneRequester, oneResponder, contacts, eggs, geese, enishiHistory,
    meetingsHosted, seriesHosted, google, zoom, collabTeams, collabPosts,
    quests, cardOrders, bookings, guestInvites, push,
  ] = await Promise.all([
    grouped(db.select({ id: schema.oneOnOneSessions.requesterId, n: cnt }).from(schema.oneOnOneSessions).groupBy(schema.oneOnOneSessions.requesterId).all()),
    grouped(db.select({ id: schema.oneOnOneSessions.responderId, n: cnt }).from(schema.oneOnOneSessions).groupBy(schema.oneOnOneSessions.responderId).all()),
    grouped(db.select({ id: schema.externalContacts.ownerMemberId, n: cnt }).from(schema.externalContacts).groupBy(schema.externalContacts.ownerMemberId).all()),
    grouped(db.select({ id: schema.goldenEggs.memberId, n: cnt }).from(schema.goldenEggs).groupBy(schema.goldenEggs.memberId).all()),
    grouped(db.select({ id: schema.goldenGeese.memberId, n: cnt }).from(schema.goldenGeese).groupBy(schema.goldenGeese.memberId).all()),
    grouped(db.select({ id: schema.enishiSearchHistory.memberId, n: cnt }).from(schema.enishiSearchHistory).groupBy(schema.enishiSearchHistory.memberId).all()),
    grouped(db.select({ id: schema.meetings.hostMemberId, n: cnt }).from(schema.meetings).groupBy(schema.meetings.hostMemberId).all()),
    grouped(db.select({ id: schema.meetingSeries.hostMemberId, n: cnt }).from(schema.meetingSeries).groupBy(schema.meetingSeries.hostMemberId).all()),
    grouped(db.select({ id: schema.googleCalendarAccounts.memberId, n: cnt }).from(schema.googleCalendarAccounts).groupBy(schema.googleCalendarAccounts.memberId).all()),
    grouped(db.select({ id: schema.zoomCredentials.memberId, n: cnt }).from(schema.zoomCredentials).groupBy(schema.zoomCredentials.memberId).all()),
    grouped(db.select({ id: schema.collabTeamMembers.memberId, n: cnt }).from(schema.collabTeamMembers).where(eq(schema.collabTeamMembers.status, "active")).groupBy(schema.collabTeamMembers.memberId).all()),
    grouped(db.select({ id: schema.collaborationPosts.authorId, n: cnt }).from(schema.collaborationPosts).where(sql`${schema.collaborationPosts.deletedAt} IS NULL`).groupBy(schema.collaborationPosts.authorId).all()),
    grouped(db.select({ id: schema.questAttempts.memberId, n: cnt }).from(schema.questAttempts).groupBy(schema.questAttempts.memberId).all()),
    grouped(db.select({ id: schema.cardOrders.memberId, n: cnt }).from(schema.cardOrders).groupBy(schema.cardOrders.memberId).all()),
    grouped(db.select({ id: schema.bookings.hostMemberId, n: cnt }).from(schema.bookings).groupBy(schema.bookings.hostMemberId).all()),
    grouped(db.select({ id: schema.oneOnOneGuestInvites.hostMemberId, n: cnt }).from(schema.oneOnOneGuestInvites).groupBy(schema.oneOnOneGuestInvites.hostMemberId).all()),
    grouped(db.select({ id: schema.pushSubscriptions.memberId, n: cnt }).from(schema.pushSubscriptions).groupBy(schema.pushSubscriptions.memberId).all()),
  ]);

  const byFeature: Record<FeatureKey, CountMap> = {
    oneonone: mergeMaps(oneRequester, oneResponder, bookings, guestInvites),
    contacts: contacts,
    enishi_register: mergeMaps(eggs, geese),
    enishi_search: enishiHistory,
    meetings: mergeMaps(meetingsHosted, seriesHosted),
    scheduler: mergeMaps(google, zoom),
    collab: mergeMaps(collabTeams, collabPosts),
    quests: quests,
    card_order: cardOrders,
    push: push,
  };

  const out = new Map<string, MemberUsage>();
  const memberRows = await db.select({ id: schema.members.id }).from(schema.members).all();
  for (const { id } of memberRows) {
    const counts = {} as Record<FeatureKey, number>;
    for (const f of FEATURES) counts[f.key] = byFeature[f.key].get(id) ?? 0;
    const used = FEATURES.filter((f) => counts[f.key] > 0).map((f) => f.key);
    const unused = FEATURES.filter((f) => counts[f.key] === 0).map((f) => f.key);
    // 利用回数が少ない順（同数なら優先順）に、まだ十分に使っていない機能を勧める
    const recommended = FEATURES
      .map((f, idx) => ({ key: f.key, n: counts[f.key], idx }))
      .filter((x) => x.n < ENOUGH_USAGE_COUNT)
      .sort((a, b) => a.n - b.n || a.idx - b.idx)
      .slice(0, MAX_RECOMMENDATIONS)
      .map((x) => x.key);
    out.set(id, { counts, used, unused, recommended });
  }
  return out;
}
