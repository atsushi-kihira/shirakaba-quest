// =============================================================
// メール送信サービス（SendGrid + DBテンプレート・プレーンテキスト）
// =============================================================
import { eq } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { EMAIL_DEFAULTS_MAP } from "./email-defaults.ts";

// ── 低レベル送信 ────────────────────────────────────────────
type SendMailOptions = {
  to: string;
  subject: string;
  text: string;
  apiKey: string;
  fromEmail?: string;
  fromName?: string;
};

export async function sendMail(opts: SendMailOptions): Promise<void> {
  // プレーンテキストを改行 → <br> に変換してシンプルなHTMLも生成
  const htmlBody = `<pre style="font-family:sans-serif;white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.7;color:#1a1410;max-width:600px;margin:0 auto;padding:24px;">${opts.text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</pre>`;

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: opts.to }] }],
      from: {
        email: opts.fromEmail ?? "a.kihira@bizolve.jp",
        name: opts.fromName ?? "白樺クエスト",
      },
      subject: opts.subject,
      content: [
        { type: "text/plain", value: opts.text },
        { type: "text/html", value: htmlBody },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SendGrid error ${res.status}: ${body}`);
  }
}

// ── ユーティリティ ──────────────────────────────────────────
export function renderVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => vars[key] ?? "");
}

// ── MailService ─────────────────────────────────────────────

type MailEnv = {
  SENDGRID_API_KEY: string;
  SENDGRID_FROM_EMAIL?: string;
  ENVIRONMENT?: string;
};

export class MailService {
  constructor(
    private db: ReturnType<typeof createDb>,
    private env: MailEnv
  ) {}

  async send(emailKey: string, to: string, vars: Record<string, string>): Promise<void> {
    const isDev = this.env.ENVIRONMENT !== "production";
    if (isDev) {
      console.log(`[DEV mail] ${emailKey} → ${to}`, vars);
      return;
    }

    const defaults = EMAIL_DEFAULTS_MAP.get(emailKey);
    if (!defaults) {
      console.warn(`[mail] unknown emailKey: ${emailKey}`);
      return;
    }

    const dbRow = await this.db
      .select()
      .from(schema.emailTemplates)
      .where(eq(schema.emailTemplates.emailKey, emailKey))
      .get();

    const enabled = dbRow ? !!dbRow.enabled : defaults.enabled;
    if (!enabled) return;

    const subject = renderVars(dbRow?.subject ?? defaults.subject, vars);
    // body_html カラムにプレーンテキストを保存しているため bodyHtml フィールドで取得
    const bodyText = renderVars(dbRow?.bodyHtml ?? defaults.bodyText, vars);

    // システム既定設定・共通ヘッダー/フッターを cardDesigns から取得
    const design = await this.db.select({
      systemFromEmail:   schema.cardDesigns.systemFromEmail,
      appTitle:          schema.cardDesigns.appTitle,
      emailCommonHeader: schema.cardDesigns.emailCommonHeader,
      emailCommonFooter: schema.cardDesigns.emailCommonFooter,
    }).from(schema.cardDesigns).get();

    const fromEmail = dbRow?.fromEmail ?? design?.systemFromEmail ?? this.env.SENDGRID_FROM_EMAIL;
    const fromName = vars.appTitle ?? design?.appTitle ?? "BizQuest";

    // 共通ヘッダー・フッターを組み立て（テンプレートごとに無効化可能）
    const useHeader = design?.emailCommonHeader && !dbRow?.disableCommonHeader;
    const useFooter = design?.emailCommonFooter && !dbRow?.disableCommonFooter;
    const header = useHeader ? renderVars(design!.emailCommonHeader!, vars) : "";
    const footer = useFooter ? renderVars(design!.emailCommonFooter!, vars) : "";

    const finalText = [header, bodyText, footer].filter(Boolean).join("\n\n");

    await sendMail({
      to,
      apiKey: this.env.SENDGRID_API_KEY,
      fromEmail,
      fromName,
      subject,
      text: finalText,
    });
  }
}

// ── カード発注ヘルパー型（routes/card-orders.ts で使用） ────
export type CardOrderMailData = {
  memberName: string;
  memberFurigana: string;
  memberRomaji: string;
  memberEmail: string;
  memberCategory: string;
  memberBusinessDescription: string;
  memberCompany: string;
  memberRole: string;
  memberAddress: string;
  memberPhone: string;
  skills: Array<{ name: string; emoji: string; issue: string; connector: string; solution: string }>;
  characterKey: string;
  characterLabel: string;
  orderAddress: string;
  orderPhone: string;
  planName: string;
  planPrice: number;
};

/** カード発注用の会員情報テキストを生成する */
export function buildMemberTableText(order: CardOrderMailData): string {
  const lines: string[] = [
    `お名前: ${order.memberName}（${order.memberFurigana}）`,
    `ローマ字: ${order.memberRomaji || "—"}`,
    `メール: ${order.memberEmail}`,
    `会社名: ${order.memberCompany}`,
    `役職: ${order.memberRole}`,
    `職種: ${order.memberCategory}`,
    `事業内容: ${order.memberBusinessDescription}`,
    `住所（カード）: ${order.orderAddress || "—"}`,
    `電話（カード）: ${order.orderPhone || "—"}`,
    `キャラクター: ${order.characterLabel}`,
  ];
  return lines.join("\n");
}

/** スキル一覧のプレーンテキストを生成する */
export function buildSkillsText(
  skills: Array<{ name: string; emoji: string; issue: string; connector: string; solution: string }>
): string {
  return skills
    .map((s) => `・${s.emoji} ${s.name}${s.issue ? `：${s.issue}${s.connector}${s.solution}` : ""}`)
    .join("\n");
}

// 後方互換のため旧名のエイリアスを残す（card-orders.ts / register.ts が参照）
/** @deprecated buildMemberTableText を使用してください */
export function buildMemberTableHtml(order: CardOrderMailData): string {
  return buildMemberTableText(order);
}
/** @deprecated buildSkillsText を使用してください */
export function buildSkillsHtml(
  skills: Array<{ name: string; emoji: string; issue: string; connector: string; solution: string }>
): string {
  return buildSkillsText(skills);
}
