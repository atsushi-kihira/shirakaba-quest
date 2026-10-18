// =============================================================
// 金の卵・金のガチョウの「分割案」を作る
//
// 1つの入力欄に複数の相手をまとめて書いた場合に、他のメンバーが紹介しやすいよう、1件ずつに分けた案を返す。
// ・AI（Claude）が、箇条書き・「/」「・」「、」の列挙・共通の前置き（例:「現場から抜けられない○○」）・特徴の列挙までを読み取って分ける
// ・AIが使えない（開発環境・キー未設定・エラー）場合は、改行や印、「/」区切りなどの機械的なルールで分ける
// 画面には「分割案」として見せ、ユーザーが修正・取りやめできる。ここでは登録はしない。
// =============================================================
import { splitMultiEntries } from "./split-entries.ts";

export type SplitSuggestion = { items: string[]; source: "ai" | "rules" };

const MAX_ITEMS = 8;

/** 機械的なルールでの分割（AIが使えないときの代替）。「/」「／」区切りの短い語の並びも分ける */
export function splitByRules(text: string): string[] {
  const base = splitMultiEntries(text);
  const result: string[] = [];
  for (const entry of base) {
    const parts = entry.split(/\s*[/／]\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2 && parts.every((p) => p.length <= 30)) result.push(...parts);
    else result.push(entry);
  }
  return result.slice(0, MAX_ITEMS);
}

function buildPrompt(kind: "egg" | "goose", text: string): string {
  const what = kind === "egg"
    ? "金の卵（「紹介してほしい理想の相手・案件」）"
    : "金のガチョウ（「金の卵を持っていそうな、運んでくれそうな立場の人」）";
  return `あなたはBNIチャプターの紹介支援アプリで、メンバーが入力した${what}の文章を、他のメンバーが紹介しやすいように「1件=1種類の相手」に分割する担当です。

# 分割のルール
- 1つの入力に、異なる種類の相手が複数まとめて書かれている場合は、1件ずつに分けてください。例:「税理士/社労士/弁護士」→「税理士」「社労士」「弁護士」
- 箇条書き・改行・「/」「・」「、」での列挙は、独立した相手なら分けてください。
- 複数の相手に共通する前置きや条件（例:「現場から抜けられない歯科医師さん・整備工場・町工場の社長」の「現場から抜けられない」）は、分けた各件に補ってください。
- 「特徴・見分けるポイント」として並べられた文は、その相手（例:社長）の別々の特徴を表していることが多いので、「〜している社長」のように、相手が分かる1件の文にしてください。
  例:
  入力:「現場から抜けられない自費診療の歯科医師さん\\n整備工場・町工場の社長\\n- SNS・請求・予約を社長が自分でやっている\\n- 休みの日もスマホで連絡を返している」
  出力:「現場から抜けられない自費診療の歯科医師さん」「現場から抜けられない整備工場の社長」「現場から抜けられない町工場の社長」「SNS・請求・予約を社長が自分でやっている社長」「休みの日もスマホで連絡を返している社長」
- 1つの相手について、条件を重ねて説明しているだけの文（例:「首都圏の中堅製造業で、従業員50〜300名で、経営者が決裁できる会社」）は、分けずに1件のままにしてください。
- 元の言葉づかいをできるだけ変えず、補う言葉は最小限にしてください。入力にない内容を付け足さないでください。
- 分ける必要がなければ、元の文章をそのまま1件にしてください。最大${MAX_ITEMS}件までです。

# 出力形式
次のJSONのみを出力してください（前置き・説明・コードブロックは不要）。
{"items":["…","…"]}

# 入力
${text}`;
}

async function callClaude(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { content: Array<{ type: string; text?: string }>; stop_reason?: string };
  if (data.stop_reason === "max_tokens") throw new Error("Claude応答がmax_tokensで打ち切られました");
  return data.content.filter((c) => c.type === "text" && c.text).map((c) => c.text).join("\n");
}

function parseItems(content: string): string[] | null {
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]) as { items?: unknown };
    if (!Array.isArray(parsed.items)) return null;
    const items = parsed.items.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
    return [...new Set(items)].slice(0, MAX_ITEMS);
  } catch { return null; }
}

export async function suggestSplit(
  env: { ANTHROPIC_API_KEY?: string; ENVIRONMENT?: string },
  kind: "egg" | "goose",
  text: string
): Promise<SplitSuggestion> {
  const trimmed = text.trim();
  if (!trimmed) return { items: [], source: "rules" };
  const apiKey = env.ANTHROPIC_API_KEY;
  if (env.ENVIRONMENT === "development" || !apiKey || apiKey === "dev-not-set") {
    return { items: splitByRules(trimmed), source: "rules" };
  }
  try {
    const items = parseItems(await callClaude(apiKey, buildPrompt(kind, trimmed)));
    if (items && items.length > 0) return { items, source: "ai" };
  } catch (e) {
    console.error("[split-suggest] AIでの分割案の作成に失敗。ルールで代替します", e);
  }
  return { items: splitByRules(trimmed), source: "rules" };
}
