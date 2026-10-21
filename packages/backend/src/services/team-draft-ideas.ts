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
  /** AIが考えた、チーム案の名前（タイトルをAIに任せた場合に使う） */
  teamTitle?: string;
  businessTitle: string;
  /** どんなお客様・対象に提供する事業か */
  targetCustomers?: string;
  summary: string;
  roles: { key: string; role: string }[];
  firstSteps: string[];
  /** まとめたときのメンバー構成（"m:…"/"c:…" の並べ替え済み）と目的。現在の内容と違えば「まとめ直し」を促す */
  participantKeys: string[];
  goal: string;
  generatedAt: number;
  isMock?: boolean;
};

const OUTPUT_FIELDS = `- teamTitle：チーム案の名前（15〜25文字程度）
- businessTitle：協働事業のタイトル（20〜30文字程度）
- targetCustomers：どんなお客様・対象に提供する事業かを、1〜2文で具体的に
- summary：誰の、どんな課題に、どんなサービス・活動を提供する事業かを、2〜4文で具体的に`;

const RULES = `# ルール
- 根拠は、メンバー一覧に書かれている情報のみ。実績・数字・会社名・取引先などを作り話で補わない。
- 実現を約束する表現ではなく、「〜できそうです」「〜が考えられます」という提案のトーンで書く。
- 存在しない key を使わない。出力は指定のJSON形式のみ。1文字目から必ず「{」で始める（前置き・コードブロックは不要）。`;

function listPeople(people: DraftParticipant[]): string {
  return people.map((p) => `- key: ${p.key} / 名前: ${p.name}${p.kind === "contact" ? "（外部人脈・まだお声がけ前の候補）" : ""} / ${p.profile}`).join("\n");
}

/** メンバーが決まっているとき：その全員の力を合わせた協働事業・役割をまとめる */
function buildPrompt(title: string, goal: string, people: DraftParticipant[]): string {
  return `あなたはBNIチャプターのメンバー同士の協働事業（共同での事業・サービスづくり）を企画するAIです。
下の「検討中のチーム案」のメンバー全員の力を合わせると、どんな協働事業ができそうかを提案し、それぞれの役割をまとめてください。

# 出力する内容
${OUTPUT_FIELDS}
- roles：メンバー全員分の役割（key と role＝1文）。key は下の一覧の key をそのまま使う。外部人脈の方は、参加の意思が未確認の候補なので「お声がけできれば〜を担当してもらう」という書き方にする
- firstSteps：このチームが最初に取り組むとよい行動を、3件以内（各1文）

${RULES}
{"teamTitle":"...","businessTitle":"...","targetCustomers":"...","summary":"...","roles":[{"key":"...","role":"..."}],"firstSteps":["...","..."]}

# チーム案のタイトル
${title.trim() || "（未定。上の teamTitle として、あなたが考えてください）"}

# このチームで考えたいこと（目的・テーマ）
${goal.trim() || "（指定なし。メンバーの強みを活かせる協働事業を提案してください）"}

# メンバー一覧
${listPeople(people)}`;
}

/** タイトルと協業の内容だけが決まっているとき：それに合うチームメンバー案（自分を含む）を、候補の中から選んで提案する */
function buildProposePrompt(title: string, goal: string, me: DraftParticipant, candidates: DraftParticipant[], maxOthers: number): string {
  return `あなたはBNIチャプターのメンバー同士の協働事業（共同での事業・サービスづくり）を企画するAIです。
「チーム案のタイトル」と「考えたい協業の内容」に合うチームのメンバー案を、下の「候補一覧」の中から選び、協業の内容をブラッシュアップして、それぞれの役割までまとめてください。

# 進め方
- 「あなた（依頼した本人）」は、必ずチームに含まれます。本人の強みも活かすように考える。
- 候補一覧から、本人のほかに1〜${maxOthers}名を選ぶ。強みが補い合い、事業を実現するのに必要な役割がそろうメンバーを優先する。人数を無理に増やさない。
- 外部人脈の方も選んでよい。ただし、まだお声がけ前の候補なので、参加の意思が未確認であることを前提にする。
- 考えたい協業の内容は、そのまま写さず、対象のお客様・提供するサービス・強みの掛け合わせが具体的になるようにブラッシュアップする。

# 出力する内容
${OUTPUT_FIELDS}
- memberKeys：選んだメンバーの key（本人は含めない。候補一覧の key をそのまま使う）
- roles：本人と、選んだメンバー全員の役割（key と role＝1文）。本人の key も含める
- firstSteps：このチームが最初に取り組むとよい行動を、3件以内（各1文）

${RULES}
{"teamTitle":"...","businessTitle":"...","targetCustomers":"...","summary":"...","memberKeys":["..."],"roles":[{"key":"...","role":"..."}],"firstSteps":["..."]}

# チーム案のタイトル
${title}

# 考えたい協業の内容
${goal}

# あなた（依頼した本人）
- key: ${me.key} / 名前: ${me.name} / ${me.profile}

# 候補一覧
${listPeople(candidates)}`;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

type ParsedIdeas = Pick<TeamDraftIdeas, "teamTitle" | "businessTitle" | "targetCustomers" | "summary" | "roles" | "firstSteps"> & { memberKeys: string[] };

function parse(content: string, valid: Set<string>): ParsedIdeas | null {
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]) as { teamTitle?: unknown; businessTitle?: unknown; targetCustomers?: unknown; summary?: unknown; roles?: unknown; firstSteps?: unknown; memberKeys?: unknown };
    if (!str(p.businessTitle) || !str(p.summary)) return null;
    const seen = new Set<string>();
    const roles = (Array.isArray(p.roles) ? p.roles : []).flatMap((r: unknown) => {
      const x = r as { key?: unknown; role?: unknown };
      if (typeof x?.key !== "string" || !valid.has(x.key) || seen.has(x.key) || !str(x.role)) return [];
      seen.add(x.key);
      return [{ key: x.key, role: str(x.role) }];
    });
    const firstSteps = (Array.isArray(p.firstSteps) ? p.firstSteps : []).map(str).filter(Boolean).slice(0, 3);
    const memberKeys = [...new Set((Array.isArray(p.memberKeys) ? p.memberKeys : []).filter((k): k is string => typeof k === "string" && valid.has(k)))];
    return {
      teamTitle: str(p.teamTitle) || undefined, businessTitle: str(p.businessTitle), targetCustomers: str(p.targetCustomers) || undefined,
      summary: str(p.summary), roles, firstSteps, memberKeys,
    };
  } catch { return null; }
}

function mockIdeas(title: string, goal: string, people: DraftParticipant[]): Omit<ParsedIdeas, "memberKeys"> {
  return {
    teamTitle: title.trim() || "AI提案のチーム案（見本）",
    businessTitle: `「${title.trim() || "チーム案"}」の協働事業（見本）`,
    targetCustomers: "開発環境のため見本です。本番では、提供する対象のお客様を具体的に提案します。",
    summary: `開発環境のため、AIによる提案の代わりに見本を表示しています。${goal ? `考えたいこと：${goal.slice(0, 60)}。` : ""}本番では、メンバーの強みを組み合わせた具体的な協働事業を提案します。`,
    roles: people.map((p) => ({ key: p.key, role: `${p.name}さんの強みを活かして関わります（見本）` })),
    firstSteps: ["メンバーで一度集まって、事業のイメージをすり合わせる（見本）", "役割の分担を確認する（見本）"],
  };
}

/** メンバーが決まっているチーム案の、協働事業と役割をまとめる。失敗したときは null（呼び出し側でエラー表示する） */
export async function generateTeamDraftIdeas(args: {
  apiKey: string | undefined; isDev: boolean; title: string; goal: string; people: DraftParticipant[];
}): Promise<TeamDraftIdeas | null> {
  const { apiKey, isDev, title, goal, people } = args;
  const base = { participantKeys: people.map((p) => p.key).sort(), goal, generatedAt: Math.floor(Date.now() / 1000) };
  if (isDev || !apiKey || apiKey === "dev-not-set") return { ...mockIdeas(title, goal, people), ...base, isMock: true };
  const valid = new Set(people.map((p) => p.key));
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const parsed = parse(await callClaude(apiKey, buildPrompt(title, goal, people)), valid);
      if (parsed) { const { memberKeys: _unused, ...ideas } = parsed; void _unused; return { ...ideas, ...base }; }
      console.error(`[team-draft-ideas] 応答の解析に失敗（試行${attempt}/2）`);
    } catch (e) {
      console.error(`[team-draft-ideas] 呼び出し失敗（試行${attempt}/2）`, e);
    }
  }
  return null;
}

/**
 * タイトルと協業の内容から、チームメンバー案（自分を含む）を候補の中から選び、協業内容のブラッシュアップと役割をまとめる。
 * 戻り値の otherKeys は、選ばれたメンバー・外部人脈（自分は含まない。最大 maxOthers 件）。失敗したときは null。
 */
export async function proposeTeamFromIdea(args: {
  apiKey: string | undefined; isDev: boolean; title: string; goal: string;
  me: DraftParticipant; candidates: DraftParticipant[]; maxOthers: number;
}): Promise<{ otherKeys: string[]; ideas: TeamDraftIdeas } | null> {
  const { apiKey, isDev, title, goal, me, candidates, maxOthers } = args;
  const finish = (otherKeys: string[], parsed: Omit<ParsedIdeas, "memberKeys">, isMock?: boolean) => {
    const keys = [me.key, ...otherKeys];
    const roles = parsed.roles.filter((r) => keys.includes(r.key));
    return {
      otherKeys,
      ideas: { ...parsed, roles, participantKeys: [...keys].sort(), goal, generatedAt: Math.floor(Date.now() / 1000), ...(isMock ? { isMock: true } : {}) } as TeamDraftIdeas,
    };
  };
  if (candidates.length === 0) return null;
  if (isDev || !apiKey || apiKey === "dev-not-set") {
    const picked = candidates.slice(0, Math.min(3, maxOthers));
    return finish(picked.map((p) => p.key), mockIdeas(title, goal, [me, ...picked]), true);
  }
  const valid = new Set([me.key, ...candidates.map((c) => c.key)]);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const parsed = parse(await callClaude(apiKey, buildProposePrompt(title, goal, me, candidates, maxOthers)), valid);
      const otherKeys = (parsed?.memberKeys ?? []).filter((k) => k !== me.key).slice(0, maxOthers);
      if (parsed && otherKeys.length >= 1) { const { memberKeys: _unused, ...rest } = parsed; void _unused; return finish(otherKeys, rest); }
      console.error(`[team-draft-ideas] メンバー案の応答の解析に失敗（試行${attempt}/2）`);
    } catch (e) {
      console.error(`[team-draft-ideas] メンバー案の呼び出し失敗（試行${attempt}/2）`, e);
    }
  }
  return null;
}
