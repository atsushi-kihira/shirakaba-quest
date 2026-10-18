// =============================================================
// メンバー検索（AI）：「さがしたい人の条件」に近いメンバーを、メンバーの業種・事業内容・各USPの説明から見つける
// ・人脈検索の「メンバーのUSPから絞り込む」で使う。USPを選んでいれば、そのUSPを持つメンバーの中からさがす
// ・AIに渡すのは、全員に公開されている項目（名前・職種・事業内容・USPとその説明）のみ。会社名・連絡先などの名刺情報は渡さない
// =============================================================
import { and, eq, ne } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";

export type MemberSearchResult = { results: { memberId: string; why: string }[]; candidateCount: number; aiCallFailed?: boolean };

const MAX_CANDIDATES = 150;
const MAX_RESULTS = 20;

export const uspKeyOf = (name: string): string => name.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

type Candidate = { id: string; name: string; category: string; businessDescription: string; skills: { name: string; description: string }[] };

function parseSkills(raw: string | null): Candidate["skills"] {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((sk: unknown) => {
      if (typeof sk !== "object" || sk === null) return [];
      const o = sk as { name?: unknown; issue?: unknown; connector?: unknown; solution?: unknown };
      const name = typeof o.name === "string" ? o.name.trim() : "";
      if (!name) return [];
      const description = [o.issue, o.connector, o.solution].filter((v): v is string => typeof v === "string" && v.trim() !== "").join("");
      return [{ name, description }];
    });
  } catch { return []; }
}

async function collectCandidates(db: Db, meId: string, usps: string[]): Promise<Candidate[]> {
  const rows = await db.select().from(schema.members)
    .where(and(eq(schema.members.status, "active"), ne(schema.members.id, meId))).all();
  const wanted = new Set(usps.map(uspKeyOf));
  return rows
    .map((m) => ({ id: m.id, name: m.name, category: m.category, businessDescription: m.businessDescription, skills: parseSkills(m.skills) }))
    .filter((m) => wanted.size === 0 || m.skills.some((sk) => wanted.has(uspKeyOf(sk.name))))
    .slice(0, MAX_CANDIDATES);
}

function formatCandidates(cands: Candidate[]): string {
  return cands.map((c) => {
    const parts = [`id: ${c.id}`, `名前: ${c.name}`];
    if (c.category) parts.push(`職種: ${c.category}`);
    if (c.businessDescription) parts.push(`事業内容: ${c.businessDescription}`);
    if (c.skills.length > 0) parts.push(`USP: ${c.skills.map((s) => (s.description ? `${s.name}（${s.description}）` : s.name)).join(" ／ ")}`);
    return `- ${parts.join(" / ")}`;
  }).join("\n");
}

function buildPrompt(freeText: string, cands: Candidate[]): string {
  return `あなたはBNIチャプターのメンバー紹介を支援するAIです。
「さがしたい人の条件」に近いメンバーを、下の「メンバー一覧」の中から、関連性が高い順に最大${MAX_RESULTS}件選んでください。

# 判断のしかた
- 各メンバーの「職種」「事業内容」「USP（強み）とその説明」を読み、条件に合う・近い人を選ぶ。言葉が完全に一致しなくても、意味が近ければ選んでよい（例：「広報に強い人」→ PR・ブランディング・発信支援を掲げる人）。
- 条件に明確に合わないメンバーは選ばない（無理に${MAX_RESULTS}件まで埋めなくてよい）。
- 一覧にない情報（連絡先・会社名など）は推測しない。存在しないIDや名前を作らない。

# さがしたい人の条件
${freeText}

# 出力ルール
- why（1文・日本語）：その人の職種・事業内容・USPのどこが条件に合うか、根拠を具体的に。
- 数値スコアは出力しない。検討過程や一覧の読み上げは書かず、結論のJSONだけを出力する。
- 出力は次のJSON形式のみ。1文字目から必ず「{」で始める（前置き・コードブロックは不要）:
{"results":[{"memberId":"...","why":"..."}]}

# メンバー一覧
${formatCandidates(cands)}`;
}

async function callClaude(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 8000,
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

function parseResults(content: string, valid: Set<string>): { memberId: string; why: string }[] | null {
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]) as { results?: unknown };
    if (!Array.isArray(parsed.results)) return null;
    const seen = new Set<string>();
    const out: { memberId: string; why: string }[] = [];
    for (const r of parsed.results) {
      const x = r as { memberId?: unknown; why?: unknown };
      if (typeof x?.memberId !== "string" || !valid.has(x.memberId) || seen.has(x.memberId)) continue;
      seen.add(x.memberId);
      out.push({ memberId: x.memberId, why: typeof x.why === "string" ? x.why : "" });
    }
    return out.slice(0, MAX_RESULTS);
  } catch { return null; }
}

/** AIが使えないとき（開発環境・キー未設定・失敗）の代替：条件の言葉が、業種・事業内容・USPの説明に含まれるメンバーを返す */
function keywordFallback(freeText: string, cands: Candidate[]): { memberId: string; why: string }[] {
  const terms = freeText.split(/[\s、,，。・/／]+/).map((t) => t.trim()).filter((t) => t.length >= 2);
  if (terms.length === 0) return [];
  return cands
    .map((c) => {
      const hay = [c.category, c.businessDescription, ...c.skills.map((s) => `${s.name}${s.description}`)].join(" ").toLowerCase();
      const hits = terms.filter((t) => hay.includes(t.toLowerCase()));
      return { c, hits };
    })
    .filter((x) => x.hits.length > 0)
    .sort((a, b) => b.hits.length - a.hits.length)
    .slice(0, MAX_RESULTS)
    .map((x) => ({ memberId: x.c.id, why: `業種・事業内容・USPの説明に「${x.hits.slice(0, 3).join("」「")}」が含まれています` }));
}

export async function runMemberSearch(args: {
  db: Db; apiKey: string | undefined; isDev: boolean; meId: string; usps: string[]; freeText: string;
}): Promise<MemberSearchResult> {
  const { db, apiKey, isDev, meId, usps, freeText } = args;
  const cands = await collectCandidates(db, meId, usps);
  if (cands.length === 0) return { results: [], candidateCount: 0 };

  if (isDev || !apiKey || apiKey === "dev-not-set") {
    return { results: keywordFallback(freeText, cands), candidateCount: cands.length };
  }
  const valid = new Set(cands.map((c) => c.id));
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const results = parseResults(await callClaude(apiKey, buildPrompt(freeText, cands)), valid);
      if (results) return { results, candidateCount: cands.length };
      console.error(`[member-search] 応答の解析に失敗（試行${attempt}/2）`);
    } catch (e) {
      console.error(`[member-search] 呼び出し失敗（試行${attempt}/2）`, e);
    }
  }
  return { results: keywordFallback(freeText, cands), candidateCount: cands.length, aiCallFailed: true };
}
