// =============================================================
// 検討中のチーム案：明示的に選んだメンバー（外部人脈の人を含む）の力を合わせた「協働事業」と「それぞれの役割」のまとめ（AI）
// 人脈検索の協業イメージ（member-collab.ts）と同じ考え方で、AIに渡すのは公開されている項目（メンバー：職種・事業内容・USP、
// 外部人脈：本人が登録した専門分野・会社名・事業概要・備考）のみ。連絡先は渡さない。
// =============================================================
import { callClaude } from "./member-collab.ts";

export type DraftParticipant = {
  /** "m:<メンバーID>" / "c:<外部人脈ID>" / "t:<募集人材ID>" */
  key: string;
  kind: "member" | "contact" | "talent";
  /** AIに渡す名前。外部人脈は、本名を渡さず「外部人脈の候補A」のような呼び名にする */
  name: string;
  /** AIに渡す、その人の情報（職種・事業内容・USP など） */
  profile: string;
  /** 立場：参加中（正式メンバー）／候補／募集中の人材像。省略時は「メンバー案」として扱う */
  status?: "active" | "candidate" | "recruiting";
  /** 確定（まとめ直しで外さない）。参加中の人は常に確定 */
  locked?: boolean;
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

/** チームをパワーアップするために加えられるとよい人材（実在の人ではなく、業種・職種とビジネス面での人物像） */
export type DesiredTalent = {
  /** 業種・職種（例：ウェブマーケター（中小企業の集客支援）） */
  title: string;
  /** ビジネス面での人物像（どんな経験・強み・価値観の人か） */
  profile: string;
  /** いまのチームに足りない点を、どう補うか */
  reason: string;
  /** 協働事業での役割 */
  role: string;
};
/** 追加できるとよい人材の最大人数 */
export const MAX_DESIRED_TALENTS = 3;

export type SuggestedMember = { key: string; name: string; kind: "member" | "contact" | "talent"; reason: string };

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
  /** チームをパワーアップするために追加できるとよい人材（最大3名。役割つき） */
  desiredTalents?: DesiredTalent[];
  /** 幅を広げる観点のとき：ほかの切り口の協働事業アイデア */
  alternativeIdeas?: { title: string; summary: string }[];
  /** メンバー提案の観点のとき：チームに加えるとよさそうな人（メンバー・外部人脈） */
  suggestedMembers?: SuggestedMember[];
  /** 確定していない候補・募集人材について、AIが「見送り」をすすめるもの（提案のみ。実際には外れない） */
  memberAdvice?: { key: string; advice: "drop"; reason: string }[];
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

/** 「追加できるとよい人材」の出力の指示（maxTalents が 0 のときは出さない） */
function talentFields(maxTalents: number): string {
  if (maxTalents <= 0) return "";
  return `- desiredTalents：このチームをよりパワーアップするために、メンバーに加えられるとよい人材を最大${maxTalents}名分。
  いまのメンバーの業種・職種・強みと重ならず、協働事業を実現するために足りない役割を補う人にする。必要性が薄ければ、無理に${maxTalents}名にしなくてよい（0名でもよい）。
  実在の人物・会社名・個人名は作らず、ビジネス面での人物像だけを書く。各項目は
    title＝業種・職種（20文字程度。例：「ウェブマーケター（中小企業の集客支援）」）、
    profile＝ビジネス面での人物像（どんな事業経験・得意分野・価値観を持つ人か。2〜3文）、
    reason＝いまのチームに足りない点を、どう補うか（1文）、
    role＝この協働事業での役割（1文）
`;
}
const TALENT_JSON = ',"desiredTalents":[{"title":"...","profile":"...","reason":"...","role":"..."}]';

const RULES = `# ルール
- 根拠は、メンバー一覧に書かれている情報のみ。実績・数字・会社名・取引先などを作り話で補わない。
- 実現を約束する表現ではなく、「〜できそうです」「〜が考えられます」という提案のトーンで書く。
- 存在しない key を使わない。出力は指定のJSON形式のみ。1文字目から必ず「{」で始める（前置き・コードブロックは不要）。`;

function standingLabel(p: DraftParticipant): string {
  if (p.status === "active") return "【参加中・確定】";
  if (p.status === "recruiting") return p.locked ? "【募集中の人材像・確定】" : "【募集中の人材像】";
  if (p.status === "candidate") return p.locked ? "【候補・確定】" : "【候補】";
  return p.locked ? "【確定】" : "";
}

function listPeople(people: DraftParticipant[]): string {
  return people.map((p) => `- key: ${p.key} / ${standingLabel(p)}名前: ${p.name}${p.kind === "contact" ? "（外部人脈・まだお声がけ前の候補）" : p.kind === "talent" ? "（まだいない人の人物像）" : ""} / ${p.profile}`).join("\n");
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
- 役割：${previous.roles.map((r) => `${nameOf.get(r.key) ?? r.key}（${r.key}）＝${r.role}`).join(" ／ ") || "（なし）"}${previous.desiredTalents?.length ? `
- 前回提案した「追加できるとよい人材」：${previous.desiredTalents.map((t) => `${t.title}（${t.role}）`).join(" ／ ")}` : ""}
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

/** 確定・候補の扱い。確定していない候補・募集人材があるときだけ、「見送りのおすすめ」を出力させる */
function buildLockRules(people: DraftParticipant[]): { rules: string; outputLines: string; json: string } {
  const unlocked = people.filter((p) => (p.status === "candidate" || p.status === "recruiting") && !p.locked);
  const hasStatus = people.some((p) => p.status);
  if (!hasStatus) return { rules: "", outputLines: "", json: "" };
  const rules = `
- 【参加中・確定】【候補・確定】【募集中の人材像・確定】の人は、必ずチームに含め、役割を考える。外す・見送るおすすめは出さない。
- 【候補】【募集中の人材像】で確定していない人は、事業に不要・重複すると判断した場合に限り、見送りをおすすめしてよい（提案のみ）。
- 【候補】【募集中の人材像】の人にも、チームに加わった場合の役割を考える（roles に含める）。`;
  return {
    rules,
    outputLines: unlocked.length > 0 ? "- memberAdvice：確定していない候補・募集人材のうち、見送りをおすすめする人（key と reason＝1文）。おすすめがなければ空の配列\n" : "",
    json: unlocked.length > 0 ? ',"memberAdvice":[{"key":"...","reason":"..."}]' : "",
  };
}

/** メンバーが決まっているとき：その全員の力を合わせた協働事業・役割をまとめる */
function buildPrompt(title: string, goal: string, people: DraftParticipant[], opt?: RegenerateOptions, maxTalents = 0): string {
  const x = buildExtras(people, opt);
  const lockRules = buildLockRules(people);
  return `あなたはBNIチャプターのメンバー同士の協働事業（共同での事業・サービスづくり）を企画するAIです。
下の「検討中のチーム案」のメンバー全員の力を合わせると、どんな協働事業ができそうかを提案し、それぞれの役割をまとめてください。

# 出力する内容
${OUTPUT_FIELDS}
- roles：メンバー全員分の役割（key と role＝1文）。key は下の一覧の key をそのまま使う。外部人脈の方は、参加の意思が未確認の候補なので「お声がけできれば〜を担当してもらう」という書き方にする
- firstSteps：このチームが最初に取り組むとよい行動を、3件以内（各1文）
${talentFields(maxTalents)}${lockRules.outputLines}${x.outputLines ? `${x.outputLines}\n` : ""}
${RULES}${lockRules.rules}
{"teamTitle":"...","businessTitle":"...","targetCustomers":"...","summary":"...","roles":[{"key":"...","role":"..."}],"firstSteps":["...","..."]${maxTalents > 0 ? TALENT_JSON : ""}${lockRules.json}${x.jsonExtra}}

# チーム案のタイトル
${title.trim() || "（未定。上の teamTitle として、あなたが考えてください）"}

# このチームで考えたいこと（目的・テーマ）
${goal.trim() || "（指定なし。メンバーの強みを活かせる協働事業を提案してください）"}

# メンバー一覧
${listPeople(people)}
${x.previousSection}${x.perspectiveSection}${x.candidateSection}`;
}

/** タイトルと協業の内容だけが決まっているとき：それに合うチームメンバー案（自分を含む）を、候補の中から選んで提案する */
function buildProposePrompt(title: string, goal: string, me: DraftParticipant, candidates: DraftParticipant[], maxOthers: number, maxTalents: number): string {
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
${talentFields(maxTalents)}
${RULES}
{"teamTitle":"...","businessTitle":"...","targetCustomers":"...","summary":"...","memberKeys":["..."],"roles":[{"key":"...","role":"..."}],"firstSteps":["..."]${maxTalents > 0 ? TALENT_JSON : ""}}

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

type ParsedIdeas = Pick<TeamDraftIdeas, "teamTitle" | "businessTitle" | "targetCustomers" | "summary" | "roles" | "firstSteps" | "alternativeIdeas" | "desiredTalents" | "memberAdvice"> & {
  memberKeys: string[];
  /** 追加をおすすめする人の key と理由（候補一覧にある key だけ） */
  suggested: { key: string; reason: string }[];
};

function parse(content: string, valid: Set<string>, suggestable?: Set<string>): ParsedIdeas | null {
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]) as { teamTitle?: unknown; businessTitle?: unknown; targetCustomers?: unknown; summary?: unknown; roles?: unknown; firstSteps?: unknown; memberKeys?: unknown; alternativeIdeas?: unknown; suggestedMembers?: unknown; desiredTalents?: unknown; memberAdvice?: unknown };
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
    const desiredTalents = (Array.isArray(p.desiredTalents) ? p.desiredTalents : []).flatMap((t: unknown) => {
      const x = t as { title?: unknown; profile?: unknown; reason?: unknown; role?: unknown };
      return str(x?.title) && str(x?.profile) ? [{ title: str(x.title), profile: str(x.profile), reason: str(x.reason), role: str(x.role) }] : [];
    }).slice(0, MAX_DESIRED_TALENTS);
    const memberAdvice = (Array.isArray(p.memberAdvice) ? p.memberAdvice : []).flatMap((m: unknown) => {
      const x = m as { key?: unknown; reason?: unknown };
      return typeof x?.key === "string" && valid.has(x.key) ? [{ key: x.key, advice: "drop" as const, reason: str(x.reason) }] : [];
    });
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
      ...(desiredTalents.length > 0 ? { desiredTalents } : {}),
      ...(memberAdvice.length > 0 ? { memberAdvice } : {}),
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
    desiredTalents: [
      { title: "ウェブマーケター（集客支援）（見本）", profile: "開発環境のため見本です。本番では、チームに足りない業種・職種と、ビジネス面での人物像を提案します。", reason: "お客様との接点づくりを補えます。", role: "事業を知ってもらうための集客・発信を担当します。" },
      { title: "営業・販路開拓の経験者（見本）", profile: "法人のお客様への提案や紹介ルートづくりの経験が豊富で、メンバーの強みを商談につなげるのが得意な人です。", reason: "事業を売り込む力を補えます。", role: "お客様への提案と紹介ルートの開拓を担当します。" },
    ],
  };
}

/**
 * メンバーが決まっているチーム案の、協働事業と役割をまとめる。失敗したときは null（呼び出し側でエラー表示する）。
 * regenerate を渡すと、「まとめ直す」の追加の観点（幅を広げる・メンバーの提案・役割の考え直しなど）を AI に与える。
 */
export async function generateTeamDraftIdeas(args: {
  apiKey: string | undefined; isDev: boolean; title: string; goal: string; people: DraftParticipant[]; regenerate?: RegenerateOptions;
  /** 「追加できるとよい人材」の最大人数（チームの人数の上限までの空きに合わせる。省略時は上限の3名） */
  maxTalents?: number;
}): Promise<TeamDraftIdeas | null> {
  const { apiKey, isDev, title, goal, people, regenerate } = args;
  const maxTalents = Math.max(0, Math.min(MAX_DESIRED_TALENTS, args.maxTalents ?? MAX_DESIRED_TALENTS));
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
    const { desiredTalents: mockTalents, ...mock } = mockIdeas(title, goal, people);
    const has = (p: RegeneratePerspective) => !!regenerate?.perspectives.includes(p);
    return {
      ...mock, ...base, ...applied, isMock: true,
      ...(maxTalents > 0 && mockTalents ? { desiredTalents: mockTalents.slice(0, maxTalents) } : {}),
      ...(has("broaden") ? { alternativeIdeas: [{ title: "別の切り口の協働事業（見本）", summary: "開発環境のため見本です。本番では、対象のお客様や提供の形を変えた案を提案します。" }] } : {}),
      ...(suggestable.size > 0 ? { suggestedMembers: [...suggestable.values()].slice(0, Math.min(2, regenerate!.maxSuggest)).map((c) => ({ key: c.key, name: c.name, kind: c.kind, reason: "見本：強みがチームを補えそうです（開発環境の見本）" })) } : {}),
    };
  }
  const valid = new Set(people.map((p) => p.key));
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const parsed = parse(await callClaude(apiKey, buildPrompt(title, goal, people, regenerate, maxTalents)), valid, new Set(suggestable.keys()));
      if (parsed) {
        const { memberKeys: _unused, suggested, desiredTalents, ...ideas } = parsed; void _unused;
        const suggestedMembers = toSuggested(suggested);
        return {
          ...ideas, ...base, ...applied,
          ...(maxTalents > 0 && desiredTalents?.length ? { desiredTalents: desiredTalents.slice(0, maxTalents) } : {}),
          ...(suggestedMembers.length > 0 ? { suggestedMembers } : {}),
        };
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
    // 「追加できるとよい人材」は、チームの人数の上限までの空きの分だけ
    const talentSlots = Math.max(0, Math.min(MAX_DESIRED_TALENTS, maxOthers + 1 - keys.length));
    const desiredTalents = (parsed.desiredTalents ?? []).slice(0, talentSlots);
    return {
      otherKeys,
      ideas: { ...parsed, roles, desiredTalents: desiredTalents.length > 0 ? desiredTalents : undefined, participantKeys: [...keys].sort(), goal, generatedAt: Math.floor(Date.now() / 1000), ...(isMock ? { isMock: true } : {}) } as TeamDraftIdeas,
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
      const parsed = parse(await callClaude(apiKey, buildProposePrompt(title, goal, me, candidates, maxOthers, Math.min(MAX_DESIRED_TALENTS, Math.max(0, maxOthers - 1)))), valid);
      const otherKeys = (parsed?.memberKeys ?? []).filter((k) => k !== me.key).slice(0, maxOthers);
      if (parsed && otherKeys.length >= 1) { const { memberKeys: _unused, suggested: _s, ...rest } = parsed; void _unused; void _s; return finish(otherKeys, rest); }
      console.error(`[team-draft-ideas] メンバー案の応答の解析に失敗（試行${attempt}/2）`);
    } catch (e) {
      console.error(`[team-draft-ideas] メンバー案の呼び出し失敗（試行${attempt}/2）`, e);
    }
  }
  return null;
}
