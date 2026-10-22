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

/** 「まとめ直す」で、システムの指示に加えて AI に与える観点 */
export type RegeneratePerspective = "broaden" | "suggest_members" | "new_member_roles" | "reassign_roles";
export const REGENERATE_PERSPECTIVES: RegeneratePerspective[] = ["broaden", "suggest_members", "new_member_roles", "reassign_roles"];
export const REGENERATE_NOTE_MAX = 500;

export type RegenerateOptions = {
  perspectives: RegeneratePerspective[];
  /** ユーザーが自由に書いた、さらに伝えたい観点 */
  note: string;
  /** 前回のまとめ（これをもとに作り直す） */
  previous: TeamDraftIdeas | null;
  /** 追加メンバーの提案に使う候補（すでにメンバーの人は含めない） */
  candidates: DraftParticipant[];
  /** 提案するメンバーの最大数（チームの人数の上限までの空き） */
  maxSuggest: number;
};

export type SuggestedMember = { key: string; name: string; kind: "member" | "contact"; reason: string };

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
  /** 幅を広げる観点のとき：ほかの切り口の協働事業アイデア */
  alternativeIdeas?: { title: string; summary: string }[];
  /** メンバー提案の観点のとき：チームに加えるとよさそうな人（メンバー・外部人脈） */
  suggestedMembers?: SuggestedMember[];
  /** 今回のまとめ直しで与えた観点（表示用） */
  appliedPerspectives?: RegeneratePerspective[];
  appliedNote?: string;
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

/** 「まとめ直す」の追加の観点を、プロンプトに足す文章にする */
function buildExtras(people: DraftParticipant[], opt: RegenerateOptions | undefined) {
  const has = (p: RegeneratePerspective) => !!opt?.perspectives.includes(p);
  const suggest = has("suggest_members") && opt!.maxSuggest > 0 && opt!.candidates.length > 0;
  const previous = opt?.previous ?? null;
  const nameOf = new Map(people.map((p) => [p.key, p.name]));
  const prevKeys = new Set(previous?.participantKeys ?? []);
  const newKeys = previous ? people.map((p) => p.key).filter((k) => !prevKeys.has(k)) : [];

  const lines: string[] = [];
  if (has("broaden")) lines.push("- 協働ビジネスの幅を広げる：前回と同じ発想にとどまらず、対象のお客様・提供の形・メンバーの強みの掛け合わせ方の別の可能性を取り入れて、協働事業の内容を広げる。");
  if (suggest) lines.push(`- 追加するメンバーの提案：「追加候補一覧」の中から、このチームに加えると事業の幅や実現性が高まる人を、最大${opt!.maxSuggest}名まで選び、なぜ加えるとよいかを書く。無理に人数を増やさない。`);
  if (has("new_member_roles")) {
    lines.push(newKeys.length > 0
      ? `- 新しく追加されたメンバーの役割を考える：前回のまとめのあとに追加された ${newKeys.map((k) => `${nameOf.get(k) ?? k}（${k}）`).join("、")} の役割を、既存メンバーの強みとの関係も踏まえて具体的に考える。既存メンバーの役割は、無理がなければ前回の内容を保つ。`
      : "- 新しく追加されたメンバーの役割を考える：前回のまとめのあとに追加された人はいないので、この観点は考慮しなくてよい。");
  }
  if (has("reassign_roles")) lines.push("- 役割の割り振り直し：前回の役割にとらわれず、全員の強みがより活きるように、役割を割り振り直す。");
  const note = (opt?.note ?? "").trim();
  if (note) lines.push(`- ユーザーからの追加の観点（そのまま尊重する）：${note}`);

  const perspectiveSection = lines.length === 0 ? "" : `
# 今回の追加の観点（ユーザーが指定した、ここを重視してまとめ直す）
${lines.join("\n")}
${previous && !has("reassign_roles") && !has("new_member_roles") ? "- 役割は、メンバーに変更がなければ前回の内容を基本的に保ちつつ、事業の変更に合わせて調整する。\n" : ""}`;

  const previousSection = previous ? `
# 前回のまとめ（これをもとに、上の観点を取り入れて作り直す）
- 協働事業：${previous.businessTitle}
- 概要：${previous.summary}
- 役割：${previous.roles.map((r) => `${nameOf.get(r.key) ?? r.key}（${r.key}）＝${r.role}`).join(" ／ ") || "（なし）"}
` : "";

  const candidateSection = suggest ? `
# 追加候補一覧（追加メンバーの提案は、この中の key から選ぶ）
${listPeople(opt!.candidates)}
` : "";

  const outputLines = [
    has("broaden") ? "- alternativeIdeas：ほかの切り口の協働事業アイデアを2〜3件（title＝20文字程度、summary＝1〜2文）。上の businessTitle とは違う方向のものにする" : "",
    suggest ? "- suggestedMembers：追加をおすすめする人（key＝追加候補一覧の key、reason＝1文）" : "",
  ].filter(Boolean).join("\n");
  const jsonExtra = [
    has("broaden") ? ',"alternativeIdeas":[{"title":"...","summary":"..."}]' : "",
    suggest ? ',"suggestedMembers":[{"key":"...","reason":"..."}]' : "",
  ].join("");
  return { perspectiveSection, previousSection, candidateSection, outputLines, jsonExtra, suggest };
}

/** メンバーが決まっているとき：その全員の力を合わせた協働事業・役割をまとめる */
function buildPrompt(title: string, goal: string, people: DraftParticipant[], opt?: RegenerateOptions): string {
  const x = buildExtras(people, opt);
  return `あなたはBNIチャプターのメンバー同士の協働事業（共同での事業・サービスづくり）を企画するAIです。
下の「検討中のチーム案」のメンバー全員の力を合わせると、どんな協働事業ができそうかを提案し、それぞれの役割をまとめてください。

# 出力する内容
${OUTPUT_FIELDS}
- roles：メンバー全員分の役割（key と role＝1文）。key は下の一覧の key をそのまま使う。外部人脈の方は、参加の意思が未確認の候補なので「お声がけできれば〜を担当してもらう」という書き方にする
- firstSteps：このチームが最初に取り組むとよい行動を、3件以内（各1文）
${x.outputLines ? `${x.outputLines}\n` : ""}
${RULES}
{"teamTitle":"...","businessTitle":"...","targetCustomers":"...","summary":"...","roles":[{"key":"...","role":"..."}],"firstSteps":["...","..."]${x.jsonExtra}}

# チーム案のタイトル
${title.trim() || "（未定。上の teamTitle として、あなたが考えてください）"}

# このチームで考えたいこと（目的・テーマ）
${goal.trim() || "（指定なし。メンバーの強みを活かせる協働事業を提案してください）"}

# メンバー一覧
${listPeople(people)}
${x.previousSection}${x.perspectiveSection}${x.candidateSection}`;
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

type ParsedIdeas = Pick<TeamDraftIdeas, "teamTitle" | "businessTitle" | "targetCustomers" | "summary" | "roles" | "firstSteps" | "alternativeIdeas"> & {
  memberKeys: string[];
  /** 追加をおすすめする人の key と理由（候補一覧にある key だけ） */
  suggested: { key: string; reason: string }[];
};

function parse(content: string, valid: Set<string>, suggestable?: Set<string>): ParsedIdeas | null {
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]) as { teamTitle?: unknown; businessTitle?: unknown; targetCustomers?: unknown; summary?: unknown; roles?: unknown; firstSteps?: unknown; memberKeys?: unknown; alternativeIdeas?: unknown; suggestedMembers?: unknown };
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
    const alternativeIdeas = (Array.isArray(p.alternativeIdeas) ? p.alternativeIdeas : []).flatMap((a: unknown) => {
      const x = a as { title?: unknown; summary?: unknown };
      return str(x?.title) && str(x?.summary) ? [{ title: str(x.title), summary: str(x.summary) }] : [];
    }).slice(0, 3);
    const seenSuggest = new Set<string>();
    const suggested = (Array.isArray(p.suggestedMembers) ? p.suggestedMembers : []).flatMap((m: unknown) => {
      const x = m as { key?: unknown; reason?: unknown };
      if (typeof x?.key !== "string" || !suggestable?.has(x.key) || seenSuggest.has(x.key)) return [];
      seenSuggest.add(x.key);
      return [{ key: x.key, reason: str(x.reason) }];
    });
    return {
      teamTitle: str(p.teamTitle) || undefined, businessTitle: str(p.businessTitle), targetCustomers: str(p.targetCustomers) || undefined,
      summary: str(p.summary), roles, firstSteps, memberKeys, suggested,
      ...(alternativeIdeas.length > 0 ? { alternativeIdeas } : {}),
    };
  } catch { return null; }
}

function mockIdeas(title: string, goal: string, people: DraftParticipant[]): Omit<ParsedIdeas, "memberKeys" | "suggested"> {
  return {
    teamTitle: title.trim() || "AI提案のチーム案（見本）",
    businessTitle: `「${title.trim() || "チーム案"}」の協働事業（見本）`,
    targetCustomers: "開発環境のため見本です。本番では、提供する対象のお客様を具体的に提案します。",
    summary: `開発環境のため、AIによる提案の代わりに見本を表示しています。${goal ? `考えたいこと：${goal.slice(0, 60)}。` : ""}本番では、メンバーの強みを組み合わせた具体的な協働事業を提案します。`,
    roles: people.map((p) => ({ key: p.key, role: `${p.name}さんの強みを活かして関わります（見本）` })),
    firstSteps: ["メンバーで一度集まって、事業のイメージをすり合わせる（見本）", "役割の分担を確認する（見本）"],
  };
}

/**
 * メンバーが決まっているチーム案の、協働事業と役割をまとめる。失敗したときは null（呼び出し側でエラー表示する）。
 * regenerate を渡すと、「まとめ直す」の追加の観点（幅を広げる・メンバーの提案・役割の考え直しなど）を AI に与える。
 */
export async function generateTeamDraftIdeas(args: {
  apiKey: string | undefined; isDev: boolean; title: string; goal: string; people: DraftParticipant[]; regenerate?: RegenerateOptions;
}): Promise<TeamDraftIdeas | null> {
  const { apiKey, isDev, title, goal, people, regenerate } = args;
  const base = { participantKeys: people.map((p) => p.key).sort(), goal, generatedAt: Math.floor(Date.now() / 1000) };
  const applied = regenerate && (regenerate.perspectives.length > 0 || regenerate.note.trim())
    ? { appliedPerspectives: regenerate.perspectives, ...(regenerate.note.trim() ? { appliedNote: regenerate.note.trim() } : {}) }
    : {};
  const suggestable = regenerate && regenerate.perspectives.includes("suggest_members") && regenerate.maxSuggest > 0
    ? new Map(regenerate.candidates.map((p) => [p.key, p])) : new Map<string, DraftParticipant>();
  const toSuggested = (list: { key: string; reason: string }[]): SuggestedMember[] =>
    list.flatMap((m) => {
      const c = suggestable.get(m.key);
      return c ? [{ key: c.key, name: c.name, kind: c.kind, reason: m.reason }] : [];
    }).slice(0, regenerate?.maxSuggest ?? 0);

  if (isDev || !apiKey || apiKey === "dev-not-set") {
    const mock = mockIdeas(title, goal, people);
    const has = (p: RegeneratePerspective) => !!regenerate?.perspectives.includes(p);
    return {
      ...mock, ...base, ...applied, isMock: true,
      ...(has("broaden") ? { alternativeIdeas: [{ title: "別の切り口の協働事業（見本）", summary: "開発環境のため見本です。本番では、対象のお客様や提供の形を変えた案を提案します。" }] } : {}),
      ...(suggestable.size > 0 ? { suggestedMembers: [...suggestable.values()].slice(0, Math.min(2, regenerate!.maxSuggest)).map((c) => ({ key: c.key, name: c.name, kind: c.kind, reason: "見本：強みがチームを補えそうです（開発環境の見本）" })) } : {}),
    };
  }
  const valid = new Set(people.map((p) => p.key));
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const parsed = parse(await callClaude(apiKey, buildPrompt(title, goal, people, regenerate)), valid, new Set(suggestable.keys()));
      if (parsed) {
        const { memberKeys: _unused, suggested, ...ideas } = parsed; void _unused;
        const suggestedMembers = toSuggested(suggested);
        return { ...ideas, ...base, ...applied, ...(suggestedMembers.length > 0 ? { suggestedMembers } : {}) };
      }
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
  const finish = (otherKeys: string[], parsed: Omit<ParsedIdeas, "memberKeys" | "suggested">, isMock?: boolean) => {
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
      if (parsed && otherKeys.length >= 1) { const { memberKeys: _unused, suggested: _s, ...rest } = parsed; void _unused; void _s; return finish(otherKeys, rest); }
      console.error(`[team-draft-ideas] メンバー案の応答の解析に失敗（試行${attempt}/2）`);
    } catch (e) {
      console.error(`[team-draft-ideas] メンバー案の呼び出し失敗（試行${attempt}/2）`, e);
    }
  }
  return null;
}
