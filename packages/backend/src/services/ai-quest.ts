// =============================================================
// お題 AI 自動生成サービス — Anthropic Claude API
// =============================================================

export type AiQuestDraft = {
  title: string;
  story: string;
  mission: string;
  emoji: string;
  level: "normal" | "hard";
  skillCount: number;
  answerSkills: string[];
  reward: number;
};

type UspItem = { name: string; emoji: string; description?: string | null };

// すべてのAI生成に必ず付加する文字数・スタイル制約
const MANDATORY_CONSTRAINT =
  "他のクエストと同様に、titleは18文字以内、storyは30文字以内で、ミッションも16文字以内のシンプルなものを生成して。文面に必要なUSPを入れなくても良いです。";

const QUEST_SYSTEM_PROMPT = `あなたはBNI白樺チャプターの運営チームのアシスタントです。
チャプターメンバーが解決すべき「お題（クエスト）」を1件提案してください。

ルール:
- 提供されるUSPリストの中から、解決に必要なものを必ずちょうど3個選んでanswerSkillsに設定すること
- answerSkillsには必ずUSPリストに含まれている名前だけを使うこと（リスト外の名前は禁止）
- story（ストーリー）は依頼人の困りごとや課題が伝わるように書いてください
- mission（ミッション・対策）はどのように解決するかの方針を書いてください
- story文中でanswerSkillsに選んだUSP名が登場する場合は "[[USP名]]" のように二重角括弧で囲んでください（任意）
- 二重角括弧の中にはUSPリストの名前のみを記載し、絵文字や装飾は含めないこと
- 出力はJSONのみ（余分な説明不要）`;

const SKILLS_SYSTEM_PROMPT = `あなたはBNI白樺チャプターの運営チームのアシスタントです。
既存のお題（クエスト）に対して、解決に必要なUSP（スキル）を選んでください。

ルール:
- 提供されるUSPリストの中から、このお題の解決に最も適したものを必ずちょうど3個選ぶこと
- お題ストーリー文中で "[[USP名]]" のように二重角括弧で強調されているUSPがあれば、それを最優先でanswerSkillsに含めること
- USPリスト外の名前は絶対に使わないこと
- 出力はJSONのみ（余分な説明不要）`;

function buildQuestPrompt(usps: UspItem[], userPrompt?: string): string {
  const uspList = usps.map((u) => `- ${u.emoji}${u.name}${u.description ? `：${u.description}` : ""}`).join("\n");

  return `${QUEST_SYSTEM_PROMPT}

# 利用可能なUSP一覧（この中からanswerSkillsを選ぶこと）
${uspList}

# 出力形式（JSON のみ、コードブロック不要）
{
  "title": "お題のタイトル（18文字以内）",
  "story": "課題のストーリー（30文字以内）",
  "mission": "ミッション・対策（16文字以内）",
  "emoji": "絵文字1文字",
  "level": "normal",
  "skillCount": 3,
  "answerSkills": ["USP名1", "USP名2", "USP名3"],
  "reward": 5
}${userPrompt ? `\n\n# 追加の指示\n${userPrompt}` : ""}

# 必須制約
${MANDATORY_CONSTRAINT}`;
}

function buildBulkQuestPrompt(
  usps: UspItem[],
  items: { instruction: string }[],
  additionalPrompt?: string
): string {
  const uspList = usps.map((u) => `- ${u.emoji}${u.name}${u.description ? `：${u.description}` : ""}`).join("\n");
  const itemsList = items
    .map((item, i) => `${i + 1}. ${item.instruction || "BNIメンバーの業種に合った課題"}`)
    .join("\n");

  return `あなたはBNI白樺チャプターの運営チームのアシスタントです。
以下の${items.length}件のお題（クエスト）をまとめて生成してください。

ルール:
- 提供されるUSPリストの中から各お題の解決に必要なものをちょうど3個選んでanswerSkillsに設定すること
- answerSkillsには必ずUSPリストに含まれている名前だけを使うこと
- 各お題は異なる業種・シチュエーションになるようにすること
- 出力はJSON配列のみ（説明文・マークダウン不要）

# 利用可能なUSP一覧（answerSkillsはこの中からのみ選ぶこと）
${uspList}

# 生成する件数と各指示
${itemsList}

# 出力形式（JSON配列のみ、${items.length}件）
[
  {
    "title": "タイトル（18文字以内）",
    "story": "ストーリー（30文字以内）",
    "mission": "ミッション（16文字以内）",
    "emoji": "絵文字1文字",
    "level": "normal",
    "skillCount": 3,
    "answerSkills": ["USP名1", "USP名2", "USP名3"],
    "reward": 5
  }
]
${additionalPrompt ? `\n# 共通の追加指示\n${additionalPrompt}` : ""}

# 必須制約
${MANDATORY_CONSTRAINT}`;
}

function buildSkillsPrompt(usps: UspItem[], questTitle: string, questStory: string): string {
  const uspList = usps.map((u) => `- ${u.emoji}${u.name}${u.description ? `：${u.description}` : ""}`).join("\n");

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

/** Claude API でお題を1件生成する */
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

  const highlighted = extractHighlightedSkills(draft.story, usps);
  draft.answerSkills = ensureNSkills(
    highlighted.length > 0 ? highlighted : draft.answerSkills,
    usps,
    3
  );
  draft.skillCount = draft.answerSkills.length;
  draft.mission = draft.mission ?? "";

  return draft;
}

/** Claude API で複数のお題を一括生成する */
export async function bulkGenerateQuestsWithAi(opts: {
  usps: UspItem[];
  items: { instruction: string }[];
  additionalPrompt?: string;
  apiKey: string;
  isDev: boolean;
}): Promise<AiQuestDraft[]> {
  const { usps, items, additionalPrompt, apiKey, isDev } = opts;

  if (isDev || !apiKey || apiKey === "dev-not-set") {
    await new Promise((r) => setTimeout(r, 1200));
    return items.map((item, i) => mockQuestDraft(usps, item.instruction, i));
  }

  const content = await callClaude(
    apiKey,
    buildBulkQuestPrompt(usps, items, additionalPrompt),
    2048 + items.length * 256  // 件数に応じてトークン上限を増やす
  );

  // コードブロック内のJSONを優先して抽出し、なければブラケット深さで外側配列を特定
  const jsonStr = extractOutermostArray(content);
  if (!jsonStr) throw new Error("AI応答からJSON配列を抽出できませんでした");

  const drafts = JSON.parse(jsonStr) as AiQuestDraft[];

  return drafts.map((draft) => {
    const highlighted = extractHighlightedSkills(draft.story, usps);
    const n = draft.level === "hard" ? 5 : 3;
    draft.answerSkills = ensureNSkills(
      highlighted.length > 0 ? highlighted : (draft.answerSkills ?? []),
      usps,
      n
    );
    draft.skillCount = draft.answerSkills.length;
    draft.mission = draft.mission ?? "";
    return draft;
  });
}

/** AI応答から外側のJSON配列を抽出する（ネストした配列を誤マッチしない） */
function extractOutermostArray(content: string): string | null {
  // コードブロック内を優先
  const codeBlock = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    const inner = codeBlock[1].trim();
    if (inner.startsWith("[")) return inner;
  }
  // ブラケット深さを数えて外側の [ ... ] を抽出
  const start = content.indexOf("[");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < content.length; i++) {
    if (content[i] === "[") depth++;
    else if (content[i] === "]") {
      depth--;
      if (depth === 0) return content.slice(start, i + 1);
    }
  }
  return null;
}

/** USPリスト外の名前を除去し、不足分は補い、必ずN個にする */
function ensureNSkills(answerSkills: string[], usps: UspItem[], n: number): string[] {
  const uspNames = new Set(usps.map((u) => u.name));
  const filtered = [...new Set(answerSkills.filter((s) => uspNames.has(s)))];

  if (filtered.length > n) return filtered.slice(0, n);

  if (filtered.length < n) {
    const remaining = usps.map((u) => u.name).filter((nm) => !filtered.includes(nm));
    const shuffled = [...remaining].sort(() => Math.random() - 0.5);
    while (filtered.length < n && shuffled.length > 0) {
      filtered.push(shuffled.shift()!);
    }
  }

  return filtered;
}

/** ストーリー文中の `[[...]]` のうち、USPリストに存在するものを順番に抽出する */
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
  targetCount?: number;
  apiKey: string;
  isDev: boolean;
}): Promise<{ answerSkills: string[]; skillCount: number }> {
  const { usps, questTitle, questStory, targetCount = 3, apiKey, isDev } = opts;

  const highlighted = extractHighlightedSkills(questStory, usps);
  if (highlighted.length >= targetCount) {
    const answerSkills = highlighted.slice(0, targetCount);
    return { answerSkills, skillCount: answerSkills.length };
  }

  if (isDev || !apiKey || apiKey === "dev-not-set") {
    await new Promise((r) => setTimeout(r, 500));
    const remaining = usps.map((u) => u.name).filter((n) => !highlighted.includes(n));
    const shuffled = [...remaining].sort(() => Math.random() - 0.5);
    const answerSkills = ensureNSkills([...highlighted, ...shuffled], usps, targetCount);
    return { answerSkills, skillCount: answerSkills.length };
  }

  const content = await callClaude(apiKey, buildSkillsPrompt(usps, questTitle, questStory));

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI応答からJSONを抽出できませんでした");

  const result = JSON.parse(jsonMatch[0]) as { answerSkills: string[]; skillCount: number };

  result.answerSkills = ensureNSkills([...highlighted, ...result.answerSkills], usps, targetCount);
  result.skillCount = result.answerSkills.length;

  return result;
}

async function callClaude(apiKey: string, prompt: string, maxTokens = 1024): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-5",
      max_tokens: maxTokens,
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

/** 開発環境用モックお題（1件） */
function mockQuestDraft(usps: UspItem[], instruction?: string, index?: number): AiQuestDraft {
  const shuffled = [...usps].sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, 3).map((u) => u.name);
  const answerSkills = picked.length >= 3 ? picked : usps.slice(0, 3).map((u) => u.name);

  const mocks = [
    { title: "新規事業の立ち上げ支援", story: "新サービスを始めたいが方向性が定まらない。", mission: "専門家と連携し事業化を支援", emoji: "🚀" },
    { title: "採用難で人手が足りない", story: "良い人材が来ず現場が回らない状況が続く。", mission: "採用ブランディングで解決", emoji: "👥" },
    { title: "売上が頭打ちになっている", story: "既存顧客は安定しているが新規が取れない。", mission: "新市場開拓で売上回復", emoji: "📈" },
    { title: "顧客からのクレームが多い", story: "対応に追われサービス品質が下がっている。", mission: "業務フロー整備で品質向上", emoji: "🔧" },
    { title: "デジタル化が進んでいない", story: "紙と人力で限界が近づいている現場がある。", mission: "段階的DXで業務効率化", emoji: "⚙️" },
  ];

  const base = mocks[(index ?? 0) % mocks.length];

  return {
    title: instruction ? `【${instruction.slice(0, 8)}】${base.title}`.slice(0, 18) : base.title,
    story: base.story,
    mission: base.mission,
    emoji: base.emoji,
    level: "normal",
    skillCount: 3,
    answerSkills,
    reward: 5,
  };
}
