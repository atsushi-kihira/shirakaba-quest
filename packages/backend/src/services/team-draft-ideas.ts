// =============================================================
// 検討中のチーム案：明示的に選んだメンバー（外部人脈の人を含む）の力を合わせた「協働事業」と「それぞれの役割」のまとめ（AI）
// 人脈検索の協業イメージ（member-collab.ts）と同じ考え方で、AIに渡すのは公開されている項目（メンバー：職種・事業内容・USP、
// 外部人脈：本人が登録した専門分野・会社名・事業概要・備考）のみ。連絡先は渡さない。
// =============================================================
import { callClaude } from "./member-collab.ts";

export type DraftParticipant = {
  /** "m:<メンバーID>" または "c:<外部人脈ID>" */
  key: string;
  kind: "member" | "contact";
  name: string;
  /** AIに渡す、その人の情報（職種・事業内容・USP など） */
  profile: string;
};

export type TeamDraftIdeas = {
  businessTitle: string;
  summary: string;
  roles: { key: string; role: string }[];
  firstSteps: string[];
  /** まとめたときのメンバー構成（"m:…"/"c:…" の並べ替え済み）と目的。現在の内容と違えば「まとめ直し」を促す */
  participantKeys: string[];
  goal: string;
  generatedAt: number;
  isMock?: boolean;
};

function buildPrompt(title: string, goal: string, people: DraftParticipant[]): string {
  const list = people.map((p) => `- key: ${p.key} / 名前: ${p.name}${p.kind === "contact" ? "（外部人脈・まだお声がけ前の候補）" : ""} / ${p.profile}`).join("\n");
  return `あなたはBNIチャプターのメンバー同士の協働事業（共同での事業・サービスづくり）を企画するAIです。
下の「検討中のチーム案」のメンバー全員の力を合わせると、どんな協働事業ができそうかを提案し、それぞれの役割をまとめてください。

# 出力する内容
- businessTitle：協働事業のタイトル（20〜30文字程度）
- summary：誰の、どんな課題に、どんなサービス・活動を提供する事業かを、2〜4文で具体的に
- roles：メンバー全員分の役割（key と role＝1文）。key は下の一覧の key をそのまま使う。外部人脈の方は、参加の意思が未確認の候補なので「お声がけできれば〜を担当してもらう」という書き方にする
- firstSteps：このチームが最初に取り組むとよい行動を、3件以内（各1文）

# ルール
- 根拠は、メンバー一覧に書かれている情報のみ。実績・数字・会社名・取引先などを作り話で補わない。
- 実現を約束する表現ではなく、「〜できそうです」「〜が考えられます」という提案のトーンで書く。
- 存在しない key を使わない。出力は次のJSON形式のみ。1文字目から必ず「{」で始める（前置き・コードブロックは不要）。
{"businessTitle":"...","summary":"...","roles":[{"key":"...","role":"..."}],"firstSteps":["...","..."]}

# チーム案のタイトル
${title}

# このチームで考えたいこと（目的・テーマ）
${goal.trim() || "（指定なし。メンバーの強みを活かせる協働事業を提案してください）"}

# メンバー一覧
${list}`;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function parse(content: string, valid: Set<string>): Pick<TeamDraftIdeas, "businessTitle" | "summary" | "roles" | "firstSteps"> | null {
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]) as { businessTitle?: unknown; summary?: unknown; roles?: unknown; firstSteps?: unknown };
    if (!str(p.businessTitle) || !str(p.summary)) return null;
    const seen = new Set<string>();
    const roles = (Array.isArray(p.roles) ? p.roles : []).flatMap((r: unknown) => {
      const x = r as { key?: unknown; role?: unknown };
      if (typeof x?.key !== "string" || !valid.has(x.key) || seen.has(x.key) || !str(x.role)) return [];
      seen.add(x.key);
      return [{ key: x.key, role: str(x.role) }];
    });
    const firstSteps = (Array.isArray(p.firstSteps) ? p.firstSteps : []).map(str).filter(Boolean).slice(0, 3);
    return { businessTitle: str(p.businessTitle), summary: str(p.summary), roles, firstSteps };
  } catch { return null; }
}

function mock(title: string, goal: string, people: DraftParticipant[]): Pick<TeamDraftIdeas, "businessTitle" | "summary" | "roles" | "firstSteps"> {
  return {
    businessTitle: `「${title}」の協働事業（見本）`,
    summary: `開発環境のため、AIによる提案の代わりに見本を表示しています。${goal ? `考えたいこと：${goal.slice(0, 60)}。` : ""}本番では、メンバーの強みを組み合わせた具体的な協働事業を提案します。`,
    roles: people.map((p) => ({ key: p.key, role: `${p.name}さんの強みを活かして関わります（見本）` })),
    firstSteps: ["メンバーで一度集まって、事業のイメージをすり合わせる（見本）", "役割の分担を確認する（見本）"],
  };
}

/** 選んだメンバー全員の協働事業と役割をまとめる。失敗したときは null（呼び出し側でエラー表示する） */
export async function generateTeamDraftIdeas(args: {
  apiKey: string | undefined; isDev: boolean; title: string; goal: string; people: DraftParticipant[];
}): Promise<TeamDraftIdeas | null> {
  const { apiKey, isDev, title, goal, people } = args;
  const base = { participantKeys: people.map((p) => p.key).sort(), goal, generatedAt: Math.floor(Date.now() / 1000) };
  if (isDev || !apiKey || apiKey === "dev-not-set") return { ...mock(title, goal, people), ...base, isMock: true };
  const valid = new Set(people.map((p) => p.key));
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const parsed = parse(await callClaude(apiKey, buildPrompt(title, goal, people)), valid);
      if (parsed) return { ...parsed, ...base };
      console.error(`[team-draft-ideas] 応答の解析に失敗（試行${attempt}/2）`);
    } catch (e) {
      console.error(`[team-draft-ideas] 呼び出し失敗（試行${attempt}/2）`, e);
    }
  }
  return null;
}
