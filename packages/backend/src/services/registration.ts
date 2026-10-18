// =============================================================
// メンバー登録（仮登録）の共通処理
//
// ・手入力での登録は、プロフィール入力のあと「確認メール」を送り、メール内のリンクを開いた時点で
//   仮登録（承認待ち）が完了する。そのため、確認メールを送る時点で入力内容を「下書き」としてサーバーに保存しておく。
// ・下書きは Workers KV に保存（30日で自動的に消える）。メールアドレスごとに1件。
//   同じメールアドレスでやり直した場合は、新しい内容で上書きする。
// ・メール確認の完了待ちのまま放置されている人は、下書きの一覧から管理画面で確認できる。
// =============================================================
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { newId, generateUrlSafeToken } from "./auth.ts";
import { saveCardImage } from "./card-image.ts";
import { getFrontendUrl } from "./frontendUrl.ts";
import { MailService } from "./mailer.ts";
import type { Env } from "../types.ts";

export const EMAIL_VERIFICATION_VALIDITY_SECONDS = 24 * 60 * 60; // 確認メールのリンクの有効期間（24時間）
const DRAFT_PREFIX = "regdraft:";
const DRAFT_TTL_SECONDS = 30 * 24 * 60 * 60; // 下書きの保存期間（30日）

export type RegistrationBody = {
  email: string;
  name: string;
  furigana?: string;
  romaji?: string;
  emoji?: string;
  bgColor?: string;
  category?: string;
  businessDescription?: string;
  company?: string;
  role?: string;
  phone?: string;
  address?: string;
  businessCommunityJoinedDate?: string; // "YYYY-MM-DD"（日は正確でなくてよい）
  cardImageBase64?: string;
  // 実際に白樺クエストカードを読み取れた（＝カード保有が確認できた）場合はtrue。
  // その場合はメールアドレスの事前確認を省略する（手入力登録のみ確認必須）。
  cardScanVerified?: boolean;
  skills?: Array<{ name: string; emoji: string; issue: string; connector: string; solution: string }>;
  uspRequests?: Array<{ uspName: string; emoji: string; description: string }>;
  // 旧来の登録画面が送ってくる場合のために受け付ける（現在の登録画面では、初回ログイン後に登録を案内する）
  goldenEggs?: Array<{ description: string; issue?: string; priceRange?: string; region?: string }>;
  goldenGeese?: Array<{ description: string; contactHypothesis?: string; priority?: string }>;
};

export const normalizeEmail = (email: string): string => email.toLowerCase().trim();

/** 入力内容の必須チェック。問題があれば利用者向けのメッセージを返す */
export function validateRegistrationBody(body: Partial<RegistrationBody>): string | null {
  if (!body.email || !body.name) return "メールアドレスと名前は必須です";
  if (!body.businessCommunityJoinedDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.businessCommunityJoinedDate)) {
    return "入会日を入力してください";
  }
  return null;
}

export async function isEmailAlreadyRegistered(db: Db, email: string): Promise<boolean> {
  const existing = await db.select({ id: schema.members.id }).from(schema.members)
    .where(eq(schema.members.email, email)).get();
  return !!existing;
}

// ---------------------------------------------------------------
// 下書き（KV）
// ---------------------------------------------------------------
export type DraftMeta = { email: string; name: string; requestedAt: number };

export async function saveDraft(kv: KVNamespace, body: RegistrationBody): Promise<void> {
  const email = normalizeEmail(body.email);
  const meta: DraftMeta = { email, name: body.name.trim(), requestedAt: Math.floor(Date.now() / 1000) };
  await kv.put(`${DRAFT_PREFIX}${email}`, JSON.stringify({ ...body, email }), { expirationTtl: DRAFT_TTL_SECONDS, metadata: meta });
}

export async function loadDraft(kv: KVNamespace, email: string): Promise<RegistrationBody | null> {
  const raw = await kv.get(`${DRAFT_PREFIX}${normalizeEmail(email)}`);
  if (!raw) return null;
  try { return JSON.parse(raw) as RegistrationBody; } catch { return null; }
}

export async function deleteDraft(kv: KVNamespace, email: string): Promise<void> {
  await kv.delete(`${DRAFT_PREFIX}${normalizeEmail(email)}`);
}

export async function listDrafts(kv: KVNamespace): Promise<DraftMeta[]> {
  const result: DraftMeta[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list<DraftMeta>({ prefix: DRAFT_PREFIX, cursor });
    for (const k of page.keys) {
      if (k.metadata) result.push(k.metadata);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return result;
}

// ---------------------------------------------------------------
// 確認メール
// ---------------------------------------------------------------
/** 確認用のトークンを発行して確認メールを送る。トークンを返す */
export async function sendVerificationMail(db: Db, env: Env, email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const normalized = normalizeEmail(email);
  const token = generateUrlSafeToken();
  await db.insert(schema.emailVerifications).values({
    token, email: normalized, verifiedAt: null, expiresAt: now + EMAIL_VERIFICATION_VALIDITY_SECONDS, createdAt: now,
  });
  const design = await db.select({ appTitle: schema.cardDesigns.appTitle }).from(schema.cardDesigns).get();
  const appTitle = design?.appTitle ?? "白樺クエスト";
  const verifyUrl = `${getFrontendUrl(env)}/register/verify?token=${token}`;
  await new MailService(db, env).send("register_email_verify", normalized, { appTitle, verifyUrl });
  return token;
}

// ---------------------------------------------------------------
// 仮登録（承認待ちのメンバーを作る）
// ---------------------------------------------------------------
/** 承認待ち（pending）のメンバーを作成し、メンバーIDを返す。呼び出し前に validateRegistrationBody と重複確認を済ませておくこと */
export async function createPendingMember(
  db: Db, env: Env, waitUntil: (p: Promise<unknown>) => void, body: RegistrationBody
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const email = normalizeEmail(body.email);
  const id = newId();

  // カード画像（表面）をR2に保存
  let cardImageKey: string | null = null;
  if (body.cardImageBase64) {
    try {
      cardImageKey = await saveCardImage(env.R2, id, body.cardImageBase64);
    } catch (err) {
      console.error("[register] カード画像の保存に失敗", err);
    }
  }

  await db.insert(schema.members).values({
    id,
    email,
    name: body.name.trim(),
    furigana: body.furigana?.trim() ?? "",
    romaji: body.romaji?.trim() ?? null,
    emoji: body.emoji ?? "😊",
    bgColor: body.bgColor ?? "bg-rose-100",
    category: body.category ?? "",
    businessDescription: body.businessDescription ?? "",
    company: body.company ?? "",
    role: body.role ?? "",
    phone: body.phone ?? null,
    address: body.address ?? null,
    businessCommunityJoinedDate: body.businessCommunityJoinedDate,
    skills: JSON.stringify(body.skills ?? []),
    customFields: JSON.stringify({}),
    cardImageKey,
    status: "pending",
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  // 金の卵・金のガチョウ（旧来の登録画面から送られた分のみ登録する）
  const goldenEggs = (body.goldenEggs ?? []).filter((e) => e.description?.trim()).slice(0, 15);
  if (goldenEggs.length > 0) {
    await db.insert(schema.goldenEggs).values(goldenEggs.map((e) => ({
      id: newId(), memberId: id, description: e.description.trim(),
      issue: e.issue?.trim() || null, priceRange: e.priceRange?.trim() || null, region: e.region?.trim() || null,
      createdAt: now, updatedAt: now,
    })));
  }
  const goldenGeese = (body.goldenGeese ?? []).filter((g) => g.description?.trim()).slice(0, 15);
  if (goldenGeese.length > 0) {
    await db.insert(schema.goldenGeese).values(goldenGeese.map((g) => ({
      id: newId(), memberId: id, description: g.description.trim(),
      contactHypothesis: g.contactHypothesis?.trim() || null, priority: g.priority?.trim() || null,
      createdAt: now, updatedAt: now,
    })));
  }

  // USP承認申請を登録し、管理者にメール通知
  if (body.uspRequests && body.uspRequests.length > 0) {
    const validRequests = body.uspRequests.filter((r) => r.uspName?.trim());
    for (const req of validRequests) {
      await db.insert(schema.uspRequests).values({
        id: newId(),
        requesterEmail: email,
        requesterName: body.name.trim(),
        uspName: req.uspName.trim(),
        emoji: req.emoji || "⭐",
        description: req.description?.trim() || null,
        status: "pending",
        createdAt: now,
      });
    }

    const admins = await db.select({ email: schema.admins.email, name: schema.admins.name }).from(schema.admins).all();
    const appDesign = await db.select({ appTitle: schema.cardDesigns.appTitle }).from(schema.cardDesigns).get();
    const appTitle = appDesign?.appTitle ?? "白樺クエスト";
    const mailer = new MailService(db, env);
    const mailPromises: Promise<void>[] = [];
    for (const req of validRequests) {
      for (const admin of admins) {
        mailPromises.push(
          mailer.send("usp_request_admin", admin.email, {
            appTitle, adminName: admin.name, requesterName: body.name.trim(), requesterEmail: email,
            uspEmoji: req.emoji || "⭐", uspName: req.uspName.trim(), uspDescription: req.description?.trim() ?? "",
          }).catch((e) => console.error("[usp-request-mail]", e))
        );
      }
    }
    // waitUntil でレスポンス後もメール送信を完走させる
    waitUntil(Promise.all(mailPromises));
  }

  return id;
}
