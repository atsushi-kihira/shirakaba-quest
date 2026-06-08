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
- 提供されるUSPリストの中から、解決に必要なものを2〜4個選んでanswerSkillsに設定すること
- answerSkillsには必ずUSPリストに含まれている名前だけを使うこと（リスト外の名前は禁止）
- ストーリーは2〜3文で、依頼人の困りごとが伝わるように書いてください
- 出力はJSONのみ（余分な説明不要）`;

const SKILLS_SYSTEM_PROMPT = `あなたはBNI白樺チャプターの運営チームのアシスタントです。
既存のお題（クエスト）に対して、解決に必要なUSP（スキル）を選んでください。

ルール:
- 提供されるUSPリストの中から、このお題の解決に最も適したものを2〜4個選ぶこと
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
  "story": "課題のストーリー（2〜3文）",
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

  // USPリスト外の名前が混入していたら除去
  const uspNames = new Set(usps.map((u) => u.name));
  draft.answerSkills = draft.answerSkills.filter((s) => uspNames.has(s));
  draft.skillCount = draft.answerSkills.length;

  return draft;
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

  if (isDev || !apiKey || apiKey === "dev-not-set") {
    await new Promise((r) => setTimeout(r, 500));
    const shuffled = [...usps].sort(() => Math.random() - 0.5).slice(0, 3);
    return { answerSkills: shuffled.map((u) => u.name), skillCount: 3 };
  }

  const content = await callClaude(apiKey, buildSkillsPrompt(usps, questTitle, questStory));

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI応答からJSONを抽出できませんでした");

  const result = JSON.parse(jsonMatch[0]) as { answerSkills: string[]; skillCount: number };

  const uspNames = new Set(usps.map((u) => u.name));
  result.answerSkills = result.answerSkills.filter((s) => uspNames.has(s));
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

  return {
    title: "新規事業立ち上げ支援プロジェクト",
    story:
      "地元の老舗企業から相談が届きました。新しいサービスを始めたいのですが、法務・デザイン・デジタル化をどう進めたらよいか途方に暮れています。チームのスキルを組み合わせて道筋を示してあげましょう！",
    emoji: "🚀",
    level: "normal",
    skillCount: 3,
    answerSkills: picked.length >= 3 ? picked : ["リスク判断力", "ビジュアル構成力", "DX設計力"],
    reward: 5,
  };
}
