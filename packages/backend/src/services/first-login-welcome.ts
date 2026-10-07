// =============================================================
// 初めてのログイン時の「ようこそ」通知・メール
// 文面は broadcast_templates の system_key='first_login' のテンプレート（管理画面から編集できる）。
// 二重配信を防ぐため、members.first_login_welcomed_at を「先に取った人だけが配信する」形で更新する。
// アプリ内通知は呼び出し元で完了を待ち（ログイン直後のホーム画面にすぐ表示するため）、メールは waitUntil で送る。
// =============================================================
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { newId } from "./auth.ts";
import { EMPTY_USAGE, getRenderBase, renderBroadcast } from "./broadcast.ts";
import { computeFeatureUsage } from "./feature-usage.ts";
import { MailService } from "./mailer.ts";
import type { Env } from "../types.ts";

export const FIRST_LOGIN_SYSTEM_KEY = "first_login";
const FIRST_LOGIN_SCOPE = "first_login";

export async function sendFirstLoginWelcome(args: {
  db: Db;
  env: Env;
  waitUntil: (p: Promise<unknown>) => void;
  memberId: string;
}): Promise<void> {
  const { db, env, memberId } = args;

  const member = await db.select({
    id: schema.members.id, name: schema.members.name, email: schema.members.email, status: schema.members.status,
    welcomedAt: schema.members.firstLoginWelcomedAt,
  }).from(schema.members).where(eq(schema.members.id, memberId)).get();
  // 承認前（ゲスト）のうちは配信せず、承認後に初めてログインしたときに配信する
  if (!member || member.status !== "active" || member.welcomedAt !== null) return;

  const template = await db.select().from(schema.broadcastTemplates)
    .where(eq(schema.broadcastTemplates.systemKey, FIRST_LOGIN_SYSTEM_KEY)).get();
  if (!template) return;

  const now = Math.floor(Date.now() / 1000);
  // 同時ログインでも1回だけ配信されるよう、「まだ未配信の行」を更新できた側だけが続行する
  const claimed = await db.update(schema.members).set({ firstLoginWelcomedAt: now })
    .where(and(eq(schema.members.id, memberId), isNull(schema.members.firstLoginWelcomedAt)))
    .returning({ id: schema.members.id });
  if (claimed.length === 0) return;

  const content = {
    title: template.title, body: template.body,
    includeUsage: !!template.includeUsage, includeRecommendations: !!template.includeRecommendations,
  };
  const base = await getRenderBase(db, env);
  const usage = content.includeUsage || content.includeRecommendations
    ? (await computeFeatureUsage(db)).get(memberId) ?? EMPTY_USAGE
    : EMPTY_USAGE;
  const rendered = renderBroadcast(content, usage, { memberName: member.name, ...base });

  // 配信履歴には「初回ログイン（自動）」を1行だけ作り、人数を増やしていく（ログインのたびに履歴が増えないように）
  let broadcast = await db.select().from(schema.broadcasts)
    .where(and(eq(schema.broadcasts.scope, FIRST_LOGIN_SCOPE), eq(schema.broadcasts.templateId, template.id))).get();
  if (!broadcast) {
    const id = newId();
    await db.insert(schema.broadcasts).values({
      id, templateId: template.id, title: template.title, body: template.body,
      includeUsage: template.includeUsage, includeRecommendations: template.includeRecommendations,
      sendEmail: 1, scope: FIRST_LOGIN_SCOPE, scopeLabel: "初めてのログイン時（自動）",
      recipientCount: 0, sentBy: "system", createdAt: now,
    });
    broadcast = await db.select().from(schema.broadcasts).where(eq(schema.broadcasts.id, id)).get();
    if (!broadcast) return;
  }
  await db.update(schema.broadcasts).set({
    title: template.title, body: template.body, recipientCount: broadcast.recipientCount + 1,
  }).where(eq(schema.broadcasts.id, broadcast.id));

  await db.insert(schema.memberNotifications).values({
    id: newId(), broadcastId: broadcast.id, memberId, title: rendered.title, body: rendered.body, readAt: null, createdAt: now,
  });

  if (member.email) {
    const mailer = new MailService(db, env);
    args.waitUntil(
      mailer.send("admin_broadcast", member.email, { appTitle: base.appTitle, subject: rendered.title, body: rendered.body })
        .catch((e) => console.error("[first-login welcome mail] failed", memberId, e))
    );
  }
}
