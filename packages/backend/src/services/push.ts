// =============================================================
// Web Push 送信サービス（@pushforge/builder — Web Crypto のみで動作、Node.js非依存）
// メール通知と同じ件名・本文を、購読しているメンバーの端末にも送る。
// =============================================================
import { buildPushHTTPRequest } from "@pushforge/builder";
import { eq } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";

export type PushEnv = {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY_JWK?: string;
  VAPID_SUBJECT?: string;
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string; // 通知タップ時に開くパス（例: "/meetings"）
};

/** 指定メンバーの全購読端末にPush通知を送る。無効化された購読（410/404）は自動削除する。 */
export async function sendPushToMember(
  db: ReturnType<typeof createDb>,
  env: PushEnv,
  memberId: string,
  payload: PushPayload
): Promise<void> {
  if (!env.VAPID_PRIVATE_KEY_JWK || !env.VAPID_SUBJECT) return; // VAPID未設定の環境では何もしない

  const subs = await db.select().from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.memberId, memberId))
    .all();
  if (subs.length === 0) return;

  await Promise.all(subs.map(async (sub) => {
    try {
      const { endpoint, body, headers } = await buildPushHTTPRequest({
        privateJWK: env.VAPID_PRIVATE_KEY_JWK!,
        subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        message: {
          payload,
          adminContact: env.VAPID_SUBJECT!,
          options: { ttl: 24 * 60 * 60, urgency: "normal" },
        },
      });
      const res = await fetch(endpoint, { method: "POST", headers, body });
      if (res.status === 404 || res.status === 410) {
        // ブラウザ側で購読解除済み・端末側で失効した購読。以後送らないよう削除する
        await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, sub.id));
      } else if (!res.ok) {
        console.error(`[push] 送信失敗 status=${res.status}`, await res.text().catch(() => ""));
      }
    } catch (err) {
      console.error("[push] 送信エラー", err);
    }
  }));
}

/** メール送信先アドレスから会員を逆引きし、購読していればPushも送る（ゲスト等・会員が見つからない場合は何もしない） */
export async function sendPushForEmailRecipient(
  db: ReturnType<typeof createDb>,
  env: PushEnv,
  email: string,
  payload: PushPayload
): Promise<void> {
  const member = await db.select({ id: schema.members.id }).from(schema.members)
    .where(eq(schema.members.email, email.toLowerCase().trim()))
    .get();
  if (!member) return;
  await sendPushToMember(db, env, member.id, payload);
}
