// =============================================================
// 日程調整の公開URL（期限付き）の発行・確認を扱うサービス。
// 恒久的な slug は廃止し、発行のたびに新しいトークンが scheduler_share_links に
// 追加される方式に一本化する。1メンバーが同時に複数の有効なリンクを持てるため、
// 新しいリンクを発行しても、既に相手へ送った古いリンクはそれぞれの有効期限まで使い続けられる。
// =============================================================
import { eq, and, gt, lte, desc } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { generateUrlSafeToken } from "./auth.ts";
import { getFrontendUrl } from "./frontendUrl.ts";
import type { Env } from "../types.ts";

type Db = ReturnType<typeof createDb>;

export type ShareLinkInfo = { token: string; expiresAt: number; publicUrl: string };

/** 管理設定の「公開URL有効期間（時間）」を取得する（未設定時は72時間＝3日） */
export async function getSchedulerLinkValidityHours(db: Db): Promise<number> {
  const design = await db
    .select({ hours: schema.cardDesigns.schedulerLinkValidityHours })
    .from(schema.cardDesigns)
    .get();
  return design?.hours ?? 72;
}

/** 画面に表示すべき、直近に発行した有効なリンクがあればその情報を返す。無い／期限切れなら null。 */
export async function getActiveShareLink(db: Db, env: Env, memberId: string): Promise<ShareLinkInfo | null> {
  const settings = await db
    .select({ isPublic: schema.memberSchedulingSettings.isPublic })
    .from(schema.memberSchedulingSettings)
    .where(eq(schema.memberSchedulingSettings.memberId, memberId))
    .get();
  if (!settings || !settings.isPublic) return null;

  const now = Math.floor(Date.now() / 1000);
  const link = await db
    .select({ token: schema.schedulerShareLinks.token, expiresAt: schema.schedulerShareLinks.expiresAt })
    .from(schema.schedulerShareLinks)
    .where(and(eq(schema.schedulerShareLinks.memberId, memberId), gt(schema.schedulerShareLinks.expiresAt, now)))
    .orderBy(desc(schema.schedulerShareLinks.createdAt))
    .get();
  if (!link) return null;
  return { token: link.token, expiresAt: link.expiresAt, publicUrl: `${getFrontendUrl(env)}/book/${link.token}` };
}

/**
 * 新しいリンクを発行する。過去に発行したリンクはそれぞれの有効期限まで生き続ける
 * （コピーして送った相手が急に開けなくなることを防ぐため、発行時に既存のリンクを無効化しない）。
 * 設定が未登録・非公開なら null。
 */
export async function issueNewShareLink(db: Db, env: Env, memberId: string): Promise<ShareLinkInfo | null> {
  const settings = await db
    .select({ isPublic: schema.memberSchedulingSettings.isPublic })
    .from(schema.memberSchedulingSettings)
    .where(eq(schema.memberSchedulingSettings.memberId, memberId))
    .get();
  if (!settings || !settings.isPublic) return null;

  const hours = await getSchedulerLinkValidityHours(db);
  const token = generateUrlSafeToken();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + hours * 3600;

  // 期限切れの古いリンクはここで掃除しておく（テーブル肥大化を防ぐだけで、動作上は必須ではない）
  await db
    .delete(schema.schedulerShareLinks)
    .where(and(eq(schema.schedulerShareLinks.memberId, memberId), lte(schema.schedulerShareLinks.expiresAt, now)));

  await db.insert(schema.schedulerShareLinks).values({ token, memberId, expiresAt, createdAt: now });

  return { token, expiresAt, publicUrl: `${getFrontendUrl(env)}/book/${token}` };
}

/**
 * 有効なリンクがあればそれを返し、無ければ（未発行・期限切れ）自動で新規発行する。
 * アプリ内部（1to1申込の相手に「申込者の予約ページ」を案内する等）で使う場合に用いる。
 * 外部への手動共有は issueNewShareLink による明示的な発行のみを行う。
 */
export async function ensureActiveShareLink(db: Db, env: Env, memberId: string): Promise<ShareLinkInfo | null> {
  const active = await getActiveShareLink(db, env, memberId);
  if (active) return active;
  return issueNewShareLink(db, env, memberId);
}

export type ResolvedShareTokenSettings =
  | { status: "not_found" }
  | { status: "link_expired" }
  | { status: "ok"; settings: typeof schema.memberSchedulingSettings.$inferSelect };

/** 公開予約ページ（ゲスト向け）で、URLに含まれるトークンから設定を解決する */
export async function resolveSettingsByShareToken(db: Db, token: string): Promise<ResolvedShareTokenSettings> {
  const link = await db
    .select({ memberId: schema.schedulerShareLinks.memberId, expiresAt: schema.schedulerShareLinks.expiresAt })
    .from(schema.schedulerShareLinks)
    .where(eq(schema.schedulerShareLinks.token, token))
    .get();
  if (!link) return { status: "not_found" };

  const settings = await db
    .select()
    .from(schema.memberSchedulingSettings)
    .where(eq(schema.memberSchedulingSettings.memberId, link.memberId))
    .get();
  if (!settings || !settings.isPublic) return { status: "not_found" };

  const now = Math.floor(Date.now() / 1000);
  if (link.expiresAt <= now) return { status: "link_expired" };

  return { status: "ok", settings };
}
