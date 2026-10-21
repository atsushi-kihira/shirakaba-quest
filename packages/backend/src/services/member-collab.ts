// =============================================================
// 協業イメージの生成（AI）：人脈検索で合致度の高かった上位メンバーの力を合わせて、どんな協業事業ができそうかを提案する
// ・全体（上位メンバーで取り組むチーム活動）の協業イメージ
// ・2名または3名の組み合わせで考えられる協業イメージ
// AIに渡すのは、全員に公開されている項目（名前・職種・事業内容・USPとその説明）のみ。会社名・連絡先などの名刺情報は渡さない。
// =============================================================
import { inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";

export type CollabMember = { memberId: string; name: string; emoji: string; bgColor: string; category: string };
export type CollabTeamIdea = { title: string; summary: string; roles: { memberId: string; role: string }[] };
export type CollabComboIdea = { memberIds: string[]; title: string; summary: string };
export type CollabIdeas = {
  /** 協業イメージの対象にした、合致度の高い上位メンバー（合致度の高い順） */
  members: CollabMember[];
  team: CollabTeamIdea | null;
  combos: CollabComboIdea[];
  /** 開発環境などでAIを使わずに作った見本（本番では出ない） */
  isMock?: boolean;
  aiCallFailed?: boolean;
};

export const COLLAB_MEMBER_LIMIT = 10;
const MAX_COMBOS = 6;

export type Profile = { id: string; name: string; emoji: string; bgColor: string; category: string; businessDescription: string; skills: { name: string; description: string }[] };

function parseSkills(raw: string | null): Profile["skills"] {
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

export async function loadProfiles(db: Db, memberIds: string[]): Promise<Profile[]> {
  if (memberIds.length === 0) return [];
  const rows = await db.select().from(schema.members).where(inArray(schema.members.id, memberIds)).all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  // 渡されたID（合致度の高い順）の並びを保つ
  return memberIds.flatMap((id) => {
    const m = byId.get(id);
    return m ? [{ id: m.id, name: m.name, emoji: m.emoji, bgColor: m.bgColor, category: m.category, businessDescription: m.businessDescription, skills: parseSkills(m.skills) }] : [];
  });
}

export function formatProfiles(profiles: Profile[]): string {
  return profiles.map((p) => {
    const parts = [`id: ${p.id}`, `名前: ${p.name}`];
    if (p.category) parts.push(`職種: ${p.category}`);
    if (p.businessDescription) parts.push(`事業内容: ${p.businessDescription}`);
    if (p.skills.length > 0) parts.push(`USP: ${p.skills.map((s) => (s.description ? `${s.name}（${s.description}）` : s.name)).join(" ／ ")}`);
    return `- ${parts.join(" / ")}`;
  }).join("\n");
}

function buildPrompt(freeText: string, profiles: Profile[]): string {
  return `あなたはBNIチャプターのメンバー同士の協業（共同での事業・サービスづくり）を企画するAIです。
「さがしたい人の条件・目的」に対して、下の「メンバー一覧」のメンバーの力を合わせると、どんな協業ができそうかを提案してください。

# 提案する内容
1. team：メンバー全員（または大半）の力を合わせて取り組む、全体でのチーム活動（協業事業）のイメージを1つ。
   - title：20〜30文字程度のタイトル
   - summary：誰の、どんな課題に、どんなサービス・活動を提供するかを2〜4文で具体的に
   - roles：各メンバーが担う役割（memberId と role＝1文）。役割が思いつかないメンバーは無理に入れない
2. combos：2名または3名の組み合わせで考えられる協業イメージを${MAX_COMBOS - 2}〜${MAX_COMBOS}件。
   - memberIds：2名または3名のID
   - title：20〜30文字程度のタイトル
   - summary：その組み合わせならではの強み（誰の何と誰の何を掛け合わせるか）と、提供できるサービスを1〜3文で
   - 同じ組み合わせを重複させない。異なる切り口（対象のお客様・提供の形）になるよう、バラエティを出す

# ルール
- 根拠は、メンバー一覧に書かれている職種・事業内容・USPのみ。実績・数字・会社名・取引先などを作り話で補わない。
- 実現を約束する表現ではなく、「〜できそうです」「〜が考えられます」という提案のトーンで書く。
- 存在しないIDを使わない。出力は次のJSON形式のみ。1文字目から必ず「{」で始める（前置き・コードブロックは不要）。
{"team":{"title":"...","summary":"...","roles":[{"memberId":"...","role":"..."}]},"combos":[{"memberIds":["...","..."],"title":"...","summary":"..."}]}

# さがしたい人の条件・目的
${freeText}

# メンバー一覧（条件への合致度が高い順）
${formatProfiles(profiles)}`;
}

export async function callClaude(apiKey: string, prompt: string): Promise<string> {
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

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function parseIdeas(content: string, valid: Set<string>): { team: CollabTeamIdea | null; combos: CollabComboIdea[] } | null {
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]) as { team?: unknown; combos?: unknown };
    let team: CollabTeamIdea | null = null;
    const t = parsed.team as { title?: unknown; summary?: unknown; roles?: unknown } | undefined;
    if (t && str(t.title) && str(t.summary)) {
      const seen = new Set<string>();
      const roles = (Array.isArray(t.roles) ? t.roles : []).flatMap((r: unknown) => {
        const x = r as { memberId?: unknown; role?: unknown };
        if (typeof x?.memberId !== "string" || !valid.has(x.memberId) || seen.has(x.memberId) || !str(x.role)) return [];
        seen.add(x.memberId);
        return [{ memberId: x.memberId, role: str(x.role) }];
      });
      team = { title: str(t.title), summary: str(t.summary), roles };
    }
    const seenCombos = new Set<string>();
    const combos: CollabComboIdea[] = [];
    for (const c of Array.isArray(parsed.combos) ? parsed.combos : []) {
      const x = c as { memberIds?: unknown; title?: unknown; summary?: unknown };
      const ids = [...new Set((Array.isArray(x?.memberIds) ? x.memberIds : []).filter((id): id is string => typeof id === "string" && valid.has(id)))];
      if (ids.length < 2 || ids.length > 3 || !str(x.title) || !str(x.summary)) continue;
      const key = [...ids].sort().join("|");
      if (seenCombos.has(key)) continue;
      seenCombos.add(key);
      combos.push({ memberIds: ids, title: str(x.title), summary: str(x.summary) });
    }
    if (!team && combos.length === 0) return null;
    return { team, combos: combos.slice(0, MAX_COMBOS) };
  } catch { return null; }
}

/** 開発環境などでAIが使えないときの見本（画面の確認用。本番では使わない） */
function mockIdeas(freeText: string, profiles: Profile[]): { team: CollabTeamIdea; combos: CollabComboIdea[] } {
  const label = (p: Profile) => p.category || p.name;
  const combos: CollabComboIdea[] = [];
  for (let i = 0; i + 1 < profiles.length && combos.length < 3; i++) {
    combos.push({
      memberIds: [profiles[i].id, profiles[i + 1].id],
      title: `${label(profiles[i])}×${label(profiles[i + 1])}の協業（見本）`,
      summary: "開発環境のため、AIによる提案の代わりに見本を表示しています。本番ではメンバーの職種・事業内容・USPをもとに、具体的な協業イメージを提案します。",
    });
  }
  if (profiles.length >= 3) {
    combos.push({
      memberIds: [profiles[0].id, profiles[1].id, profiles[2].id],
      title: `${label(profiles[0])}×${label(profiles[1])}×${label(profiles[2])}の協業（見本）`,
      summary: "3名の組み合わせの見本です。",
    });
  }
  return {
    team: {
      title: `「${freeText.slice(0, 20)}」に応えるチーム活動（見本）`,
      summary: "開発環境のため、AIによる提案の代わりに見本を表示しています。",
      roles: profiles.slice(0, 3).map((p) => ({ memberId: p.id, role: `${label(p)}の立場で関わります（見本）` })),
    },
    combos,
  };
}

/** 合致度の高い順に並んだメンバーIDのうち、上位（最大10名）の協業イメージを作る。メンバーが2名未満のときは何も返さない */
export async function generateCollabIdeas(args: {
  db: Db; apiKey: string | undefined; isDev: boolean; freeText: string; rankedMemberIds: string[];
}): Promise<CollabIdeas | null> {
  const { db, apiKey, isDev, freeText } = args;
  const profiles = await loadProfiles(db, args.rankedMemberIds.slice(0, COLLAB_MEMBER_LIMIT));
  if (profiles.length < 2) return null;
  const members: CollabMember[] = profiles.map((p) => ({ memberId: p.id, name: p.name, emoji: p.emoji, bgColor: p.bgColor, category: p.category }));

  if (isDev || !apiKey || apiKey === "dev-not-set") {
    return { members, ...mockIdeas(freeText, profiles), isMock: true };
  }
  const valid = new Set(profiles.map((p) => p.id));
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ideas = parseIdeas(await callClaude(apiKey, buildPrompt(freeText, profiles)), valid);
      if (ideas) return { members, ...ideas };
      console.error(`[member-collab] 応答の解析に失敗（試行${attempt}/2）`);
    } catch (e) {
      console.error(`[member-collab] 呼び出し失敗（試行${attempt}/2）`, e);
    }
  }
  return { members, team: null, combos: [], aiCallFailed: true };
}
