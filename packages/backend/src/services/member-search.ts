// =============================================================
// メンバー検索（AI）：「さがしたい人の条件」に近いメンバーを、メンバーの業種・事業内容・各USPの説明から見つける
// ・人脈検索の「メンバーのUSPから絞り込む」で使う。USPを選んでいれば、そのUSPを持つメンバーの中からさがす
// ・AIに渡すのは、全員に公開されている項目（名前・職種・事業内容・USPとその説明）のみ。会社名・連絡先などの名刺情報は渡さない
// =============================================================
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";

/** score: 条件との合致度（0〜100）。isSelf: 検索した本人 */
export type MemberHit = { memberId: string; why: string; score: number; isSelf: boolean };
export type MemberSearchResult = { results: MemberHit[]; candidateCount: number; aiCallFailed?: boolean };

const MAX_CANDIDATES = 150;
const MAX_RESULTS = 20;

// 専門分野の絞り込みに対して、メンバー本人の職種（category）が合うか（全角半角・空白・大文字小文字の違いを無視し、部分一致で判定）
export function memberMatchesSpecialties(category: string, specialties: string[]): boolean {
  const norm = (v: string) => v.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  const c = norm(category ?? "");
  if (!c) return false;
  return specialties.some((sp) => { const t = norm(sp); return !!t && (c.includes(t) || t.includes(c)); });
}

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

async function collectCandidates(db: Db, meId: string, usps: string[], specialties: string[]): Promise<Candidate[]> {
  // 検索した本人も対象に含める（自分自身が条件に合う力を持っているかも確かめられるように）
  const rows = await db.select().from(schema.members)
    .where(eq(schema.members.status, "active")).all();
  const wanted = new Set(usps.map(uspKeyOf));
  return rows
    .map((m) => ({ id: m.id, name: m.name, category: m.category, businessDescription: m.businessDescription, skills: parseSkills(m.skills) }))
    .filter((m) => wanted.size === 0 || m.skills.some((sk) => wanted.has(uspKeyOf(sk.name))))
    // 職種・事業内容・USPのどれも未入力のメンバーは、手がかりがなく検索の対象にならない
    .filter((m) => m.category || m.businessDescription || m.skills.length > 0)
    .filter((m) => specialties.length === 0 || memberMatchesSpecialties(m.category, specialties))
    // 候補が多いときも、検索した本人が先頭に来るようにして、件数の上限で外れないようにする
    .sort((a, b) => (a.id === meId ? -1 : 0) - (b.id === meId ? -1 : 0))
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
- score（0〜100の整数）：条件への合致度。目安は、90以上＝条件にほぼ完全に合う、70〜89＝強く合う、50〜69＝一部が合う、30〜49＝関連はあるが弱い。30未満の人は選ばない。同じ程度の人どうしで同点が並びすぎないよう、根拠の強さに応じて点数に差をつける。
- results は score の高い順に並べる。検討過程や一覧の読み上げは書かず、結論のJSONだけを出力する。
- 出力は次のJSON形式のみ。1文字目から必ず「{」で始める（前置き・コードブロックは不要）:
{"results":[{"memberId":"...","score":85,"why":"..."}]}

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

function parseResults(content: string, valid: Set<string>, meId: string): MemberHit[] | null {
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]) as { results?: unknown };
    if (!Array.isArray(parsed.results)) return null;
    const seen = new Set<string>();
    const out: MemberHit[] = [];
    for (const r of parsed.results) {
      const x = r as { memberId?: unknown; why?: unknown; score?: unknown };
      if (typeof x?.memberId !== "string" || !valid.has(x.memberId) || seen.has(x.memberId)) continue;
      seen.add(x.memberId);
      const rawScore = typeof x.score === "number" ? x.score : Number(x.score);
      const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 50;
      out.push({ memberId: x.memberId, why: typeof x.why === "string" ? x.why : "", score, isSelf: x.memberId === meId });
    }
    // AIの並びに関係なく、合致度の高い順にそろえる（同点のときはAIの並びのまま）
    return out.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
  } catch { return null; }
}

/** AIが使えないとき（開発環境・キー未設定・失敗）の代替：条件の言葉が、業種・事業内容・USPの説明に含まれるメンバーを返す */
function keywordFallback(freeText: string, cands: Candidate[], meId: string): MemberHit[] {
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
    .map((x) => ({
      memberId: x.c.id,
      // 条件の言葉のうち、いくつが含まれているかの割合（開発環境・AIが使えないときの簡易的な合致度）
      score: Math.min(95, Math.round(30 + (x.hits.length / terms.length) * 65)),
      isSelf: x.c.id === meId,
      why: `業種・事業内容・USPの説明に「${x.hits.slice(0, 3).join("」「")}」が含まれています`,
    }));
}

export async function runMemberSearch(args: {
  db: Db; apiKey: string | undefined; isDev: boolean; meId: string; usps: string[]; freeText: string;
  /** 専門分野で絞り込む場合（人脈検索）。メンバー本人は、職種がこの専門分野に合う人だけが対象になる */
  specialties?: string[];
}): Promise<MemberSearchResult> {
  const { db, apiKey, isDev, meId, usps, freeText } = args;
  const cands = await collectCandidates(db, meId, usps, args.specialties ?? []);
  if (cands.length === 0) return { results: [], candidateCount: 0 };

  if (isDev || !apiKey || apiKey === "dev-not-set") {
    return { results: keywordFallback(freeText, cands, meId), candidateCount: cands.length };
  }
  const valid = new Set(cands.map((c) => c.id));
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const results = parseResults(await callClaude(apiKey, buildPrompt(freeText, cands)), valid, meId);
      if (results) return { results, candidateCount: cands.length };
      console.error(`[member-search] 応答の解析に失敗（試行${attempt}/2）`);
    } catch (e) {
      console.error(`[member-search] 呼び出し失敗（試行${attempt}/2）`, e);
    }
  }
  return { results: keywordFallback(freeText, cands, meId), candidateCount: cands.length, aiCallFailed: true };
}
