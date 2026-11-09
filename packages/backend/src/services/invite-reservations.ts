// =============================================================
// 外部ゲスト用の共有URLの予約（ミーティング・定例会を作る前に、URLだけ先に発行する）
//   ・ミーティング本体は作らず、URLの元になるトークンだけを別テーブルに予約する（作成途中でやめても、ミーティングの一覧や集計には何も残らない）
//   ・作成時に、予約のトークンがミーティング・定例会のゲスト用URLとして引き継がれる（発行したURLは、そのまま使える）
//   ・同じ主催者・同じ種類では、有効な予約を1つだけ持つ（作成画面を開き直したら、同じURLを再表示する）
//   ・作成されなかった予約は、期限を過ぎたら削除する（毎時の定期実行で削除）。期限の初期値は、管理設定の「日程調整のURLの有効期間」に従い、発行時に変えられる
//   ・作成前にURLを開いたゲストには「準備中」と表示する
// =============================================================
import { and, eq, lt } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { generateRawToken } from "./auth.ts";
import { getFrontendUrl } from "./frontendUrl.ts";

export type ReservationKind = "meeting" | "series";
export const MAX_RESERVATION_HOURS = 60 * 24; // 60日

/** 有効期間（時間）を、1時間〜60日の範囲に収める。数として読めなければ fallback（管理設定の既定）を使う */
export function clampHours(hours: unknown, fallback: number): number {
  const n = Math.floor(Number(hours));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, MAX_RESERVATION_HOURS);
}

export function reservationUrl(env: { FRONTEND_URL?: string }, kind: ReservationKind, token: string): string {
  const base = getFrontendUrl(env);
  return kind === "series" ? `${base}/schedule/series-invite/${token}` : `${base}/schedule/invite/${token}`;
}

export type ActiveReservation = { token: string; expiresAt: number };

export async function getActiveReservation(db: Db, hostMemberId: string, kind: ReservationKind, now: number): Promise<ActiveReservation | null> {
  const rows = await db.select().from(schema.inviteReservations)
    .where(and(eq(schema.inviteReservations.hostMemberId, hostMemberId), eq(schema.inviteReservations.kind, kind))).all();
  const active = rows.filter((r) => r.expiresAt > now).sort((a, b) => b.createdAt - a.createdAt)[0];
  return active ? { token: active.token, expiresAt: active.expiresAt } : null;
}

/** 有効な予約があれば再利用し、なければ新しく作る。有効期限は、今からその時間後に更新する */
export async function issueReservation(db: Db, hostMemberId: string, kind: ReservationKind, hours: number, now: number): Promise<ActiveReservation> {
  const expiresAt = now + hours * 3600;
  const existing = await getActiveReservation(db, hostMemberId, kind, now);
  if (existing) {
    await db.update(schema.inviteReservations).set({ expiresAt }).where(eq(schema.inviteReservations.token, existing.token));
    return { token: existing.token, expiresAt };
  }
  const token = generateRawToken();
  await db.insert(schema.inviteReservations).values({ token, kind, hostMemberId, expiresAt, createdAt: now });
  return { token, expiresAt };
}

export async function discardReservation(db: Db, hostMemberId: string, kind: ReservationKind): Promise<void> {
  await db.delete(schema.inviteReservations)
    .where(and(eq(schema.inviteReservations.hostMemberId, hostMemberId), eq(schema.inviteReservations.kind, kind)));
}

/**
 * 作成時に、予約のトークンを引き継ぐ。有効な自分の予約なら予約を消してトークンを返す。
 * 無効（期限切れ・存在しない・他人の予約）なら null。
 */
export async function consumeReservation(db: Db, token: string, hostMemberId: string, kind: ReservationKind, now: number): Promise<string | null> {
  const row = await db.select().from(schema.inviteReservations).where(eq(schema.inviteReservations.token, token)).get();
  if (!row || row.kind !== kind || row.hostMemberId !== hostMemberId || row.expiresAt <= now) return null;
  await db.delete(schema.inviteReservations).where(eq(schema.inviteReservations.token, token));
  return row.token;
}

/** 作成前（予約中）のURLか。ゲストに「準備中」と案内するために使う */
export async function isReserved(db: Db, token: string, kind: ReservationKind, now: number): Promise<boolean> {
  const row = await db.select().from(schema.inviteReservations).where(eq(schema.inviteReservations.token, token)).get();
  return !!row && row.kind === kind && row.expiresAt > now;
}

/** 期限を過ぎた予約を削除する。削除した件数を返す */
export async function purgeExpiredReservations(db: Db, now: number): Promise<number> {
  const expired = await db.select({ token: schema.inviteReservations.token }).from(schema.inviteReservations)
    .where(lt(schema.inviteReservations.expiresAt, now)).all();
  if (expired.length === 0) return 0;
  await db.delete(schema.inviteReservations).where(lt(schema.inviteReservations.expiresAt, now));
  return expired.length;
}

export const PREPARING_MESSAGE = "主催者が準備中です。しばらくしてから、もう一度このURLを開いてください";
