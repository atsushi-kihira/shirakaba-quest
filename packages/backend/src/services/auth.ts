// =============================================================
// 認証サービス — OTP生成・検証・セッション発行
// =============================================================
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";

const OTP_TTL_SECONDS = 600;          // 10分
const SESSION_TTL_DAYS = 30;
const OTP_MAX_ATTEMPTS = 5;           // 1時間に5回失敗でブロック
const BLOCK_TTL_SECONDS = 3600;       // 1時間

/** 6桁のOTPコードを生成する */
export function generateOtpCode(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1_000_000).padStart(6, "0");
}

/** 32バイトのランダムトークンをhex文字列で生成する */
export function generateRawToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 文字列をSHA-256でハッシュ化してhex文字列で返す */
export async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** UUIDv4を生成する（Workers環境対応） */
export function newId(): string {
  return crypto.randomUUID();
}

// -------------------------------------------------------
// OTP の保存・検証（Cloudflare KV を使用）
// -------------------------------------------------------

export async function storeOtp(opts: {
  kv: KVNamespace;
  email: string;
  code: string;
}): Promise<void> {
  const { kv, email, code } = opts;
  const hash = await sha256Hex(code);
  const key = `otp:${email}:${hash}`;
  await kv.put(key, JSON.stringify({ email, storedAt: Date.now() }), {
    expirationTtl: OTP_TTL_SECONDS,
  });
}

export async function verifyAndConsumeOtp(opts: {
  kv: KVNamespace;
  email: string;
  code: string;
}): Promise<boolean> {
  const { kv, email, code } = opts;

  // ブロックチェック
  const blockKey = `otp_block:${email}`;
  const blockData = await kv.get(blockKey, "json") as { count: number } | null;
  if (blockData && blockData.count >= OTP_MAX_ATTEMPTS) {
    return false;
  }

  const hash = await sha256Hex(code);
  const key = `otp:${email}:${hash}`;
  const stored = await kv.get(key);

  if (!stored) {
    // 失敗カウントを増やす
    const count = (blockData?.count ?? 0) + 1;
    await kv.put(blockKey, JSON.stringify({ count }), {
      expirationTtl: BLOCK_TTL_SECONDS,
    });
    return false;
  }

  // 検証成功 → 使用済みにする（削除）、ブロックリセット
  await Promise.all([
    kv.delete(key),
    kv.delete(blockKey),
  ]);
  return true;
}

// -------------------------------------------------------
// ユーザー検索
// -------------------------------------------------------

export async function findUserByEmail(
  db: Db,
  email: string,
  context: "admin" | "member" = "member",
) {
  if (context === "admin") {
    // 管理者ログイン: admins テーブルのみ検索
    const admin = await db
      .select()
      .from(schema.admins)
      .where(eq(schema.admins.email, email))
      .get();
    return admin
      ? { id: admin.id, userType: "admin" as const, user: admin }
      : null;
  } else {
    // 一般ログイン: members テーブルのみ検索
    const member = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.email, email))
      .get();
    return member
      ? { id: member.id, userType: "member" as const, user: member }
      : null;
  }
}

// -------------------------------------------------------
// セッション発行・検証
// -------------------------------------------------------

export async function createSession(opts: {
  db: Db;
  userId: string;
  userType: "member" | "admin";
}): Promise<string> {
  const { db, userId, userType } = opts;

  const rawToken = generateRawToken();
  const tokenHash = await sha256Hex(rawToken);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_TTL_DAYS * 86_400;

  await db.insert(schema.authSessions).values({
    id: newId(),
    userId,
    userType,
    tokenHash,
    expiresAt,
    createdAt: now,
  });

  return rawToken; // 平文トークンをクライアントに返す
}

export async function verifySession(opts: {
  db: Db;
  rawToken: string;
}): Promise<{ userId: string; userType: "member" | "admin" } | null> {
  const { db, rawToken } = opts;

  const tokenHash = await sha256Hex(rawToken);
  const now = Math.floor(Date.now() / 1000);

  const session = await db
    .select()
    .from(schema.authSessions)
    .where(eq(schema.authSessions.tokenHash, tokenHash))
    .get();

  if (!session || session.expiresAt < now) {
    return null;
  }

  return {
    userId: session.userId,
    userType: session.userType as "member" | "admin",
  };
}

export async function deleteSession(opts: {
  db: Db;
  rawToken: string;
}): Promise<void> {
  const { db, rawToken } = opts;
  const tokenHash = await sha256Hex(rawToken);
  await db
    .delete(schema.authSessions)
    .where(eq(schema.authSessions.tokenHash, tokenHash));
}
