// =============================================================
// お題 AI 自動生成サービス — Anthropic Claude API
// =============================================================

type Member = {
  name: string;
  category: string;
  businessDescription: string;
  skills: Array<{ name: string; emoji: string }>;
};

export type AiQuestDraft = {
  title: string;
  story: string;
  emoji: string;
  level: "normal" | "hard";
  skillCount: number;
  answerSkills: string[];
  reward: number;
};

const SYSTEM_PROMPT = `あなたはBNI白樺チャプターの運営チームのアシスタントです。
チャプターメンバーが解決すべき「お題（クエスト）」を提案してください。

ルール:
- メンバーの業種・スキル範囲内で解決可能な、具体的なビジネス課題にしてください
- ストーリーは2〜3文で、依頼人の困りごとが伝わるように書いてください
- 必要スキル数は3〜4個にしてください
- answerSkillsには、提示されたメンバーが実際に持っているスキル名のみを使ってください
- 出力はJSONのみ（余分な説明不要）`;

function buildPrompt(members: Member[], userPrompt?: string): string {
  const memberList = members
    .map(
      (m) =>
        `- ${m.name}（${m.category}）: ${m.businessDescription} ／ スキル: ${m.skills.map((s) => `${s.emoji}${s.name}`).join("、")}`
    )
    .join("\n");

  return `${SYSTEM_PROMPT}

# 現在のメンバー一覧
${memberList}

# 出力形式（JSON のみ、コードブロック不要）
{
  "title": "お題のタイトル",
  "story": "課題のストーリー（2〜3文）",
  "emoji": "絵文字1文字",
  "level": "normal",
  "skillCount": 3,
  "answerSkills": ["スキル名1", "スキル名2", "スキル名3"],
  "reward": 5
}${userPrompt ? `\n\n# 追加の指示\n${userPrompt}` : ""}`;
}

/** Claude API でお題を生成する */
export async function generateQuestWithAi(opts: {
  members: Member[];
  userPrompt?: string;
  apiKey: string;
  isDev: boolean;
}): Promise<AiQuestDraft> {
  const { members, userPrompt, apiKey, isDev } = opts;

  if (isDev || !apiKey || apiKey === "dev-not-set") {
    // 開発環境ではモックデータを返す
    await new Promise((r) => setTimeout(r, 800)); // 疑似ディレイ
    return mockQuestDraft(members);
  }

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
      messages: [
        {
          role: "user",
          content: buildPrompt(members, userPrompt),
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API error ${res.status}: ${body}`);
  }

  const data = await res.json() as {
    content: Array<{ type: string; text: string }>;
  };

  const text = data.content.find((c) => c.type === "text")?.text ?? "";

  // JSON 部分を抽出（前後の余計な文字を除去）
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI応答からJSONを抽出できませんでした");
  }

  try {
    return JSON.parse(jsonMatch[0]) as AiQuestDraft;
  } catch {
    throw new Error("AI応答のJSON解析に失敗しました");
  }
}

/** 開発環境用モックお題 */
function mockQuestDraft(members: Member[]): AiQuestDraft {
  // メンバーからランダムにスキルを3つ選ぶ
  const allSkills = members.flatMap((m) => m.skills.map((s) => s.name));
  const shuffled = allSkills.sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, 3);

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
