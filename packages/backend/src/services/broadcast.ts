// =============================================================
// お知らせ配信（アプリ内通知＋メール）
// 文面の差し込み（受信者ごとの利用状況・おすすめ機能）と、配信の実行を担う。
// プレビューと実際の配信で同じ renderBroadcast を使うため、プレビュー＝実際に届く内容になる。
// =============================================================
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { newId } from "./auth.ts";
import { FEATURES, FEATURE_MAP, type MemberUsage } from "./feature-usage.ts";
import { getFrontendUrl } from "./frontendUrl.ts";
import { MailService } from "./mailer.ts";
import type { Recipient, RecipientScope } from "./resolve-recipients.ts";
import type { Env } from "../types.ts";

export type BroadcastContent = {
  title: string;
  body: string;
  /** 受信者ごとの「ご利用状況」ブロックを載せるか（本文の {{usageSummary}} の位置に入る） */
  includeUsage: boolean;
  /** 受信者ごとの「おすすめ機能とそのメリット」ブロックを載せるか（本文の {{recommendations}} の位置に入る） */
  includeRecommendations: boolean;
};

export type RenderContext = { memberName: string; appTitle: string; appUrl: string };

function replaceVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
}

function buildUsageBlock(usage: MemberUsage): string {
  const lines = FEATURES.map((f) => `${usage.used.includes(f.key) ? "✅" : "⬜"} ${f.name}`);
  return `▼ ご利用状況（${usage.used.length}/${FEATURES.length}機能）\n${lines.join("\n")}`;
}

function buildRecommendationsBlock(usage: MemberUsage, appUrl: string): string {
  if (usage.recommended.length === 0) {
    return "▼ ご利用状況\nすべての機能を十分にご活用いただいています。ありがとうございます！";
  }
  const items = usage.recommended.map((key) => {
    const f = FEATURE_MAP.get(key)!;
    return `■ ${f.emoji} ${f.name}\n${f.benefit}\n▶ ${appUrl}${f.path}`;
  });
  return `▼ こんな機能もおすすめです\n${items.join("\n\n")}`;
}

/** 1人分の件名・本文を組み立てる（プレビューと配信で共通） */
export function renderBroadcast(content: BroadcastContent, usage: MemberUsage, ctx: RenderContext): { title: string; body: string } {
  const vars: Record<string, string> = { memberName: ctx.memberName, appTitle: ctx.appTitle, appUrl: ctx.appUrl };
  const usageBlock = content.includeUsage ? buildUsageBlock(usage) : "";
  const recBlock = content.includeRecommendations ? buildRecommendationsBlock(usage, ctx.appUrl) : "";

  let body = content.body;
  // 本文にプレースホルダーが無い場合でも、オンにしたブロックは末尾に付ける
  if (content.includeUsage && !/\{\{usageSummary\}\}/.test(body)) body += "\n\n{{usageSummary}}";
  if (content.includeRecommendations && !/\{\{recommendations\}\}/.test(body)) body += "\n\n{{recommendations}}";

  // ブロックの中身（URL等）が再度置換されないよう、先にブロック以外を置換してから最後に差し込む
  const USAGE = "\u0000USAGE\u0000";
  const REC = "\u0000REC\u0000";
  body = body.replace(/\{\{usageSummary\}\}/g, USAGE).replace(/\{\{recommendations\}\}/g, REC);
  body = replaceVars(body, vars).split(USAGE).join(usageBlock).split(REC).join(recBlock);
  body = body.replace(/\n{3,}/g, "\n\n").trim();

  return { title: replaceVars(content.title, vars).trim(), body };
}

export async function getRenderBase(db: Db, env: Env): Promise<{ appTitle: string; appUrl: string }> {
  const design = await db.select({ appTitle: schema.cardDesigns.appTitle }).from(schema.cardDesigns).get();
  return { appTitle: design?.appTitle ?? "白樺クエスト", appUrl: getFrontendUrl(env) };
}

export type SendBroadcastArgs = {
  db: Db;
  env: Env;
  waitUntil: (p: Promise<unknown>) => void;
  content: BroadcastContent;
  templateId: string | null;
  sendEmail: boolean;
  scope: RecipientScope;
  scopeLabel: string;
  recipients: Recipient[];
  usageMap: Map<string, MemberUsage>;
  sentBy: string;
};

export const EMPTY_USAGE: MemberUsage = {
  counts: {} as MemberUsage["counts"],
  used: [], unused: FEATURES.map((f) => f.key), recommended: FEATURES.slice(0, 3).map((f) => f.key),
};

const INSERT_CHUNK = 10; // D1のバインド変数上限（1文あたり100個）に収まる行数
const MAIL_CONCURRENCY = 5;

export async function sendBroadcast(args: SendBroadcastArgs): Promise<{ broadcastId: string; recipientCount: number }> {
  const { db, env, content, recipients, usageMap } = args;
  const now = Math.floor(Date.now() / 1000);
  const broadcastId = newId();
  const base = await getRenderBase(db, env);

  await db.insert(schema.broadcasts).values({
    id: broadcastId, templateId: args.templateId, title: content.title, body: content.body,
    includeUsage: content.includeUsage ? 1 : 0, includeRecommendations: content.includeRecommendations ? 1 : 0,
    sendEmail: args.sendEmail ? 1 : 0, scope: args.scope, scopeLabel: args.scopeLabel,
    recipientCount: recipients.length, sentBy: args.sentBy, createdAt: now,
  });

  // 受信者ごとに差し込み済みの文面を作る（メールもアプリ内通知も同じ内容）
  const rendered = recipients.map((r) => ({
    recipient: r,
    ...renderBroadcast(content, usageMap.get(r.id) ?? EMPTY_USAGE, { memberName: r.name, ...base }),
  }));

  for (let i = 0; i < rendered.length; i += INSERT_CHUNK) {
    await db.insert(schema.memberNotifications).values(
      rendered.slice(i, i + INSERT_CHUNK).map((x) => ({
        id: newId(), broadcastId, memberId: x.recipient.id, title: x.title, body: x.body, readAt: null, createdAt: now,
      }))
    );
  }

  if (args.sendEmail) {
    const mailer = new MailService(db, env);
    const targets = rendered.filter((x) => x.recipient.email);
    args.waitUntil((async () => {
      for (let i = 0; i < targets.length; i += MAIL_CONCURRENCY) {
        await Promise.all(targets.slice(i, i + MAIL_CONCURRENCY).map((x) =>
          mailer.send("admin_broadcast", x.recipient.email, { appTitle: base.appTitle, subject: x.title, body: x.body })
            .catch((e) => console.error("[broadcast mail] failed", x.recipient.id, e))
        ));
      }
    })());
  }

  return { broadcastId, recipientCount: recipients.length };
}

