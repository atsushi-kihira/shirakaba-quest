// =============================================================
// お知らせ配信の宛先解決（ミーティングの対象者の選び方と同じ「全員／ギルド／チーム／指定」）
// 常に利用中（status='active'）のメンバーだけを対象にする。
// =============================================================
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { computeFeatureUsage, FEATURE_MAP, type FeatureKey } from "./feature-usage.ts";

export type RecipientScope = "all" | "team" | "collab_team" | "selected" | "criteria";

/**
 * 条件による絞り込み（指定した条件をすべて満たすメンバーが対象）。
 * 「入会」は、BNIへの入会日（メンバーが登録した businessCommunityJoinedDate）を基準にする。
 * 入会日が未入力のメンバーは、期間の条件では対象外になる。
 */
export type RecipientCriteria = {
  /** 入会から days 日以内（within）／days 日以上たった（over）メンバー */
  joined?: { days: number; mode: "within" | "over" } | null;
  /** 金の卵・金のガチョウの登録がないメンバー（egg=卵なし／goose=ガチョウなし／both=どちらもなし） */
  noEnishi?: "egg" | "goose" | "both" | null;
  /** 外部人脈の登録が1件もないメンバー */
  noContacts?: boolean;
  /** 特定の機能をまだ一度も使っていないメンバー */
  unusedFeature?: FeatureKey | null;
  /** Google／Zoom連携が未設定のメンバー（both=どちらも未設定） */
  noIntegration?: "google" | "zoom" | "both" | null;
};

export type RecipientQuery = {
  scope: RecipientScope;
  /** scope='team'（ギルド）のとき */
  teamId?: string | null;
  /** scope='collab_team'（チーム）のとき */
  collabTeamId?: string | null;
  /** scope='selected'（指定）のとき */
  memberIds?: string[];
  /** scope='criteria'（条件）のとき */
  criteria?: RecipientCriteria;
};

export type Recipient = { id: string; name: string; email: string; emoji: string };

const CHUNK = 50; // D1のバインド変数上限を避けるためIN句を分割する

function chunk<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
  return out;
}

/** 条件指定が正しい形か検証し、整えた条件を返す（不正なら理由の文字列） */
export function normalizeCriteria(raw: RecipientCriteria | undefined | null): RecipientCriteria | string {
  const c: RecipientCriteria = {};
  if (raw?.joined) {
    const days = Math.floor(Number(raw.joined.days));
    if (!Number.isFinite(days) || days < 1 || days > 3650) return "入会からの日数は1〜3650の範囲で指定してください";
    c.joined = { days, mode: raw.joined.mode === "over" ? "over" : "within" };
  }
  if (raw?.noEnishi) {
    if (!["egg", "goose", "both"].includes(raw.noEnishi)) return "金の卵・金のガチョウの条件が正しくありません";
    c.noEnishi = raw.noEnishi;
  }
  if (raw?.noContacts) c.noContacts = true;
  if (raw?.unusedFeature) {
    if (!FEATURE_MAP.has(raw.unusedFeature)) return "機能の指定が正しくありません";
    c.unusedFeature = raw.unusedFeature;
  }
  if (raw?.noIntegration) {
    if (!["google", "zoom", "both"].includes(raw.noIntegration)) return "連携の条件が正しくありません";
    c.noIntegration = raw.noIntegration;
  }
  if (Object.keys(c).length === 0) return "条件を1つ以上選んでください";
  return c;
}

const JOINED_PRESET_LABEL: Record<number, string> = { 7: "1週間", 14: "2週間", 30: "1か月", 60: "2か月", 90: "3か月", 180: "6か月" };

/** 配信履歴に残す、条件の説明文 */
export function describeCriteria(c: RecipientCriteria): string {
  const parts: string[] = [];
  if (c.joined) {
    const span = JOINED_PRESET_LABEL[c.joined.days] ?? `${c.joined.days}日`;
    parts.push(c.joined.mode === "within" ? `入会${span}以内` : `入会${span}以上`);
  }
  if (c.noEnishi) parts.push(c.noEnishi === "egg" ? "金の卵の登録なし" : c.noEnishi === "goose" ? "金のガチョウの登録なし" : "金の卵・ガチョウとも登録なし");
  if (c.noContacts) parts.push("外部人脈の登録なし");
  if (c.unusedFeature) parts.push(`「${FEATURE_MAP.get(c.unusedFeature)?.name ?? c.unusedFeature}」未利用`);
  if (c.noIntegration) parts.push(c.noIntegration === "google" ? "Google未連携" : c.noIntegration === "zoom" ? "Zoom未連携" : "Google・Zoomとも未連携");
  return `条件：${parts.join("／")}`;
}

/** "YYYY-MM-DD" → unix秒（不正・未入力は null） */
function parseJoinedDate(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

async function memberIdSet(rows: Promise<{ id: string }[]>): Promise<Set<string>> {
  return new Set((await rows).map((r) => r.id));
}

async function resolveByCriteria(db: Db, c: RecipientCriteria): Promise<Recipient[]> {
  const members = await db.select({
    id: schema.members.id, name: schema.members.name, email: schema.members.email, emoji: schema.members.emoji,
    joinedDate: schema.members.businessCommunityJoinedDate,
  }).from(schema.members).where(eq(schema.members.status, "active")).all();

  const needEggs = c.noEnishi === "egg" || c.noEnishi === "both";
  const needGeese = c.noEnishi === "goose" || c.noEnishi === "both";
  const needGoogle = c.noIntegration === "google" || c.noIntegration === "both";
  const needZoom = c.noIntegration === "zoom" || c.noIntegration === "both";
  const empty = Promise.resolve(new Set<string>());

  const [eggs, geese, contacts, google, zoom, usage] = await Promise.all([
    needEggs ? memberIdSet(db.selectDistinct({ id: schema.goldenEggs.memberId }).from(schema.goldenEggs).all()) : empty,
    needGeese ? memberIdSet(db.selectDistinct({ id: schema.goldenGeese.memberId }).from(schema.goldenGeese).all()) : empty,
    c.noContacts ? memberIdSet(db.selectDistinct({ id: schema.externalContacts.ownerMemberId }).from(schema.externalContacts).all()) : empty,
    needGoogle ? memberIdSet(db.selectDistinct({ id: schema.googleCalendarAccounts.memberId }).from(schema.googleCalendarAccounts).all()) : empty,
    needZoom ? memberIdSet(db.selectDistinct({ id: schema.zoomCredentials.memberId }).from(schema.zoomCredentials).all()) : empty,
    c.unusedFeature ? computeFeatureUsage(db) : Promise.resolve(null),
  ]);

  const now = Math.floor(Date.now() / 1000);
  return members.filter((m) => {
    if (c.joined) {
      const joinedAt = parseJoinedDate(m.joinedDate);
      if (joinedAt === null) return false; // 入会日が未入力の人は、期間では判定できない
      const cutoff = now - c.joined.days * 86400;
      if (c.joined.mode === "within" ? joinedAt < cutoff : joinedAt > cutoff) return false;
    }
    if (needEggs && eggs.has(m.id)) return false;
    if (needGeese && geese.has(m.id)) return false;
    if (c.noContacts && contacts.has(m.id)) return false;
    if (needGoogle && google.has(m.id)) return false;
    if (needZoom && zoom.has(m.id)) return false;
    if (c.unusedFeature && (usage?.get(m.id)?.counts[c.unusedFeature] ?? 0) > 0) return false;
    return true;
  }).map(({ id, name, email, emoji }) => ({ id, name, email, emoji }));
}

export async function resolveRecipients(db: Db, q: RecipientQuery): Promise<Recipient[]> {
  if (q.scope === "criteria") {
    const c = normalizeCriteria(q.criteria);
    return typeof c === "string" ? [] : resolveByCriteria(db, c);
  }
  let ids: string[] | null = null; // null = 全員

  if (q.scope === "team") {
    if (!q.teamId) return [];
    const rows = await db.select({ memberId: schema.teamMembers.memberId }).from(schema.teamMembers)
      .where(eq(schema.teamMembers.teamId, q.teamId)).all();
    ids = rows.map((r) => r.memberId);
  } else if (q.scope === "collab_team") {
    if (!q.collabTeamId) return [];
    const rows = await db.select({ memberId: schema.collabTeamMembers.memberId }).from(schema.collabTeamMembers)
      .where(and(eq(schema.collabTeamMembers.teamId, q.collabTeamId), eq(schema.collabTeamMembers.status, "active"))).all();
    ids = rows.map((r) => r.memberId);
  } else if (q.scope === "selected") {
    ids = [...new Set(q.memberIds ?? [])];
  }

  const select = {
    id: schema.members.id, name: schema.members.name, email: schema.members.email, emoji: schema.members.emoji,
  };
  if (ids === null) {
    return db.select(select).from(schema.members).where(eq(schema.members.status, "active")).all();
  }
  if (ids.length === 0) return [];
  const out: Recipient[] = [];
  for (const part of chunk(ids)) {
    out.push(...await db.select(select).from(schema.members)
      .where(and(inArray(schema.members.id, part), eq(schema.members.status, "active"))).all());
  }
  return out;
}
