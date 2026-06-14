// =============================================================
// お題 AI 自動生成サービス — Anthropic Claude API
// =============================================================

export type AiQuestDraft = {
  title: string;
  story: string;
  emoji: string;
  level: "normal" | "hard";
  skillCount: number;
  answerSkills: string[];
  reward: number;
};

type UspItem = { name: string; emoji: string };

const QUEST_SYSTEM_PROMPT = `あなたはBNI白樺チャプターの運営チームのアシスタントです。
チャプターメンバーが解決すべき「お題（クエスト）」を1件提案してください。

ルール:
- 提供されるUSPリストの中から、解決に必要なものを必ずちょうど3個選んでanswerSkillsに設定すること
- answerSkillsには必ずUSPリストに含まれている名前だけを使うこと（リスト外の名前は禁止）
- ストーリーは2〜3文で、依頼人の困りごとが伝わるように書いてください
- ストーリー文中で、answerSkillsに選んだUSP名が登場する箇所は、必ず "[[USP名]]" のように二重角括弧で囲んでください（例: "[[リスク判断力]]を活かして..."）。これによりアプリ上でそのUSPが強調表示されます
- 二重角括弧の中にはUSPリストの名前のみを記載し、絵文字や装飾は含めないこと（正しい例: [[資金調達力]] / 誤った例: [[💰資金調達力]]）
- 二重角括弧で囲むUSP名はUSPリストの名前と完全一致させること
- ストーリー文中に [[USP名]] で登場させるUSPは、必ずanswerSkillsで選んだ3個と完全に一致させること（過不足なく、ちょうど3箇所）
- 出力はJSONのみ（余分な説明不要）`;

const SKILLS_SYSTEM_PROMPT = `あなたはBNI白樺チャプターの運営チームのアシスタントです。
既存のお題（クエスト）に対して、解決に必要なUSP（スキル）を選んでください。

ルール:
- 提供されるUSPリストの中から、このお題の解決に最も適したものを必ずちょうど3個選ぶこと
- お題ストーリー文中で "[[USP名]]" のように二重角括弧で強調されているUSPがあれば、それを最優先でanswerSkillsに含めること
- USPリスト外の名前は絶対に使わないこと
- 出力はJSONのみ（余分な説明不要）`;

function buildQuestPrompt(usps: UspItem[], userPrompt?: string): string {
  const uspList = usps
    .map((u) => `- ${u.emoji}${u.name}`)
    .join("\n");

  return `${QUEST_SYSTEM_PROMPT}

# 利用可能なUSP一覧（この中からanswerSkillsを選ぶこと）
${uspList}

# 出力形式（JSON のみ、コードブロック不要）
{
  "title": "お題のタイトル",
  "story": "課題のストーリー（2〜3文。answerSkillsのUSP名は [[USP名]] のように囲むこと）",
  "emoji": "絵文字1文字",
  "level": "normal",
  "skillCount": 3,
  "answerSkills": ["USP名1", "USP名2", "USP名3"],
  "reward": 5
}${userPrompt ? `\n\n# 追加の指示\n${userPrompt}` : ""}`;
}

function buildSkillsPrompt(usps: UspItem[], questTitle: string, questStory: string): string {
  const uspList = usps
    .map((u) => `- ${u.emoji}${u.name}`)
    .join("\n");

  return `${SKILLS_SYSTEM_PROMPT}

# お題タイトル
${questTitle}

# お題ストーリー
${questStory}

# 利用可能なUSP一覧（この中からのみ選ぶこと）
${uspList}

# 出力形式（JSON のみ）
{
  "answerSkills": ["USP名1", "USP名2", "USP名3"],
  "skillCount": 3
}`;
}

/** Claude API でお題を生成する */
export async function generateQuestWithAi(opts: {
  usps: UspItem[];
  userPrompt?: string;
  apiKey: string;
  isDev: boolean;
}): Promise<AiQuestDraft> {
  const { usps, userPrompt, apiKey, isDev } = opts;

  if (isDev || !apiKey || apiKey === "dev-not-set") {
    await new Promise((r) => setTimeout(r, 800));
    return mockQuestDraft(usps);
  }

  const content = await callClaude(apiKey, buildQuestPrompt(usps, userPrompt));

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI応答からJSONを抽出できませんでした");

  const draft = JSON.parse(jsonMatch[0]) as AiQuestDraft;

  // ストーリー文中で [[USP名]] と強調されているUSPを正解USPとしてそのまま採用する
  // （AIが選んだanswerSkillsとストーリーの強調箇所がズレないようにするため、再検討はしない）
  const highlighted = extractHighlightedSkills(draft.story, usps);
  draft.answerSkills = ensureThreeSkills(
    highlighted.length > 0 ? highlighted : draft.answerSkills,
    usps
  );
  draft.skillCount = draft.answerSkills.length;

  return draft;
}

/** USPリスト外の名前を除去し、不足分は未選択のUSPから補い、超過分は切り詰めて必ず3個にする */
function ensureThreeSkills(answerSkills: string[], usps: UspItem[]): string[] {
  const uspNames = new Set(usps.map((u) => u.name));
  const filtered = [...new Set(answerSkills.filter((s) => uspNames.has(s)))];

  if (filtered.length > 3) return filtered.slice(0, 3);

  if (filtered.length < 3) {
    const remaining = usps.map((u) => u.name).filter((n) => !filtered.includes(n));
    const shuffled = [...remaining].sort(() => Math.random() - 0.5);
    while (filtered.length < 3 && shuffled.length > 0) {
      filtered.push(shuffled.shift()!);
    }
  }

  return filtered;
}

/**
 * ストーリー文中の `[[...]]` のうち、USPリストに存在するものを順番に抽出する。
 * AIが絵文字などをUSP名と一緒に括弧内へ入れてしまうことがあるため、
 * 完全一致だけでなく「USP名を含んでいるか」でも判定する。
 */
function extractHighlightedSkills(story: string, usps: UspItem[]): string[] {
  const matches = [...story.matchAll(/\[\[([^[\]]+)\]\]/g)].map((m) => m[1].trim());
  const result: string[] = [];

  for (const raw of matches) {
    const usp = usps.find((u) => raw === u.name || raw.includes(u.name));
    if (usp && !result.includes(usp.name)) result.push(usp.name);
  }

  return result;
}

/** 既存お題の正解USPのみをAIで再生成する */
export async function regenerateAnswerSkillsWithAi(opts: {
  usps: UspItem[];
  questTitle: string;
  questStory: string;
  apiKey: string;
  isDev: boolean;
}): Promise<{ answerSkills: string[]; skillCount: number }> {
  const { usps, questTitle, questStory, apiKey, isDev } = opts;

  // ストーリー文中で [[USP名]] と強調されているものを最優先で正解USPにする
  const highlighted = extractHighlightedSkills(questStory, usps);
  if (highlighted.length >= 3) {
    const answerSkills = highlighted.slice(0, 3);
    return { answerSkills, skillCount: answerSkills.length };
  }

  if (isDev || !apiKey || apiKey === "dev-not-set") {
    await new Promise((r) => setTimeout(r, 500));
    const remaining = usps.map((u) => u.name).filter((n) => !highlighted.includes(n));
    const shuffled = [...remaining].sort(() => Math.random() - 0.5);
    const answerSkills = ensureThreeSkills([...highlighted, ...shuffled], usps);
    return { answerSkills, skillCount: answerSkills.length };
  }

  const content = await callClaude(apiKey, buildSkillsPrompt(usps, questTitle, questStory));

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI応答からJSONを抽出できませんでした");

  const result = JSON.parse(jsonMatch[0]) as { answerSkills: string[]; skillCount: number };

  // ハイライト済みのUSPを優先しつつ、AIの提案で不足分を補う
  result.answerSkills = ensureThreeSkills([...highlighted, ...result.answerSkills], usps);
  result.skillCount = result.answerSkills.length;

  return result;
}

async function callClaude(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API error ${res.status}: ${body}`);
  }

  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  return data.content.find((c) => c.type === "text")?.text ?? "";
}

/** 開発環境用モックお題 */
function mockQuestDraft(usps: UspItem[]): AiQuestDraft {
  const shuffled = [...usps].sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, 3).map((u) => u.name);
  const answerSkills = picked.length >= 3 ? picked : ["リスク判断力", "ビジュアル構成力", "DX設計力"];

  return {
    title: "新規事業立ち上げ支援プロジェクト",
    story:
      `地元の老舗企業から相談が届きました。新しいサービスを始めたいのですが、` +
      `[[${answerSkills[0]}]]や[[${answerSkills[1]}]]、[[${answerSkills[2]}]]をどう活かしたらよいか途方に暮れています。` +
      `チームのスキルを組み合わせて道筋を示してあげましょう！`,
    emoji: "🚀",
    level: "normal",
    skillCount: 3,
    answerSkills,
    reward: 5,
  };
}
