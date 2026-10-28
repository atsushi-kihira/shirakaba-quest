// =============================================================
// 「新機能のお知らせ」の文面づくり（管理画面の、お知らせ配信）
// 指定した期間の更新（services/changelog.ts）から、AIが、機能の概要と、使うメリットに着目した紹介文を作る。
//   ・AIは、更新履歴に書いてあることだけを使う（ないことを書かない）
//   ・差し込み項目 {{memberName}} {{appTitle}} {{appUrl}} は、そのまま残す（配信時に、受信者ごとに入る）
//   ・AIが使えないとき・失敗したときは、更新履歴の内容から、定型の文面を作る（開発環境でも同じ）
// =============================================================
import { callClaude } from "./member-collab.ts";
import type { ChangelogEntry } from "./changelog.ts";

export type FeatureAnnouncement = { title: string; body: string; source: "ai" | "template" };

const MAX_ITEMS_FOR_AI = 12;

const emojiOf = (e: ChangelogEntry) => (e.kind === "feature" ? "🆕" : "✨");
const linkLine = (e: ChangelogEntry) => (e.path ? `\n▶ {{appUrl}}${e.path}` : "");

/** 更新履歴だけから作る、定型の文面 */
export function templateAnnouncement(entries: ChangelogEntry[]): FeatureAnnouncement {
  const items = entries.map((e) => `■ ${emojiOf(e)} ${e.title}\n${e.summary}\n💡 ${e.benefit}${linkLine(e)}`).join("\n\n");
  return {
    source: "template",
    title: entries.length === 1 ? `【新機能のお知らせ】${entries[0].title}` : `【新機能のお知らせ】${entries.length}件の新機能・改善のご紹介`,
    body: `{{memberName}}さん、いつも{{appTitle}}をご利用いただき、ありがとうございます。\n\n新しい機能と改善をお知らせします。\n\n${items}\n\nぜひ、お試しください。`,
  };
}

function buildPrompt(entries: ChangelogEntry[], since: string): string {
  const list = entries.map((e, i) => `${i + 1}. [${e.kind === "feature" ? "新機能" : "大幅な改善"}] ${e.title}（${e.date}）
   概要: ${e.summary}
   メリットの根拠: ${e.benefit}${e.path ? `\n   画面のパス: ${e.path}` : ""}`).join("\n");
  return `あなたは、ビジネス交流会のメンバー向けアプリ「{{appTitle}}」の、お知らせ文の書き手です。
${since}以降に公開した、次の新機能・改善を、メンバーに紹介する「新機能のお知らせ」を作ってください。読む方は、ITが得意でない方も多いので、専門用語を避け、やさしく、温かい言葉で書いてください。

【公開した更新】
${list}

【書き方のルール】
- 各項目は、「機能の概要」と「使うメリット（何が楽になる・うれしいか）」に着目して書く。メリットは、上の「メリットの根拠」から、読み手の立場で言い換える
- 上に書いてあること以外の機能・効果・数字を、付け足さない（推測で書かない）
- 関連する更新は、1つの項目にまとめてよい。項目は、最大8つまで（多いときは、新機能を優先し、メンバーにとって大きなものを選ぶ）
- 項目は、次の形にする（項目と項目の間は、空行を1行あける）
  ■ 絵文字 機能名
  機能の概要（1〜2文）
  💡 メリット（1〜2文）
  ▶ {{appUrl}}画面のパス   ← 画面のパスがある項目だけ
- 本文は、「{{memberName}}さん、いつも{{appTitle}}をご利用いただき、ありがとうございます。」で始め、短い導入のあと、項目を並べ、最後に、一言（「ぜひ、お試しください」など）で結ぶ
- {{memberName}} {{appTitle}} {{appUrl}} は、そのまま書く（あとで、受信者ごとに、自動で入れ替わる）。{{ }} の形のものは、これ以外、使わない
- 件名は、「【新機能のお知らせ】」で始め、全体で40文字ほどにする

出力は、次のJSONだけにする（説明やコードブロックは付けない）:
{"title": "件名", "body": "本文"}`;
}

function parse(content: string): { title: string; body: string } | null {
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]) as { title?: unknown; body?: unknown };
    const title = typeof p.title === "string" ? p.title.trim() : "";
    const body = typeof p.body === "string" ? p.body.trim() : "";
    return title && body ? { title, body } : null;
  } catch {
    return null;
  }
}

export async function generateFeatureAnnouncement(args: {
  apiKey: string | undefined; isDev: boolean; entries: ChangelogEntry[]; since: string;
}): Promise<FeatureAnnouncement> {
  const { apiKey, isDev, entries, since } = args;
  if (isDev || !apiKey || apiKey === "dev-not-set") return templateAnnouncement(entries);
  try {
    const out = parse(await callClaude(apiKey, buildPrompt(entries.slice(0, MAX_ITEMS_FOR_AI * 3), since)));
    if (!out) return templateAnnouncement(entries);
    // 受信者ごとの差し込みが入らない文面は使わない（あいさつの宛名が抜けるため）
    if (!out.body.includes("{{memberName}}")) out.body = `{{memberName}}さん\n\n${out.body}`;
    return { ...out, source: "ai" };
  } catch (e) {
    console.error("[feature-announcement] AIでの作成に失敗", e);
    return templateAnnouncement(entries);
  }
}
