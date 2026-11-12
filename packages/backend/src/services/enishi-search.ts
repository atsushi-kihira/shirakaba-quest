// =============================================================
// ご縁さがし マッチングサービス — Anthropic Claude API（単一LLM呼び出し方式）
//
// 候補データ（他メンバーの外部人脈、または他メンバーの金の卵/ガチョウ）を
// 構造化テキストとしてそのままClaude APIに渡し、マッチング判定と経路の
// ナラティブ生成を1回のLLM呼び出しで行う。埋め込み検索（Vectorize）は使わない
// ——チャプター規模（人脈数百〜千件程度）であれば候補を丸ごと渡しても
// 精度・コストの両面で十分に成立するため。
//
// プライバシー設計：LLMには「候補ID（不透明なトークン）」のみを渡し、
// 実名・会社名などの機微情報はvisibilityに応じてマスクした状態でのみ渡す。
// LLMの応答は候補IDの参照のみを信頼し、実際の表示用データ（氏名・経路文言）は
// サーバー側で候補IDから引き直して組み立てる（LLMの出力をそのまま信用しない）。
// =============================================================
import { runMemberSearch } from "./member-search.ts";
import { generateCollabIdeas, type CollabIdeas } from "./member-collab.ts";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { schema } from "../db/index.ts";
import type { createDb } from "../db/index.ts";

type Db = ReturnType<typeof createDb>;
export type Hop = "direct" | "2hop" | "3hop";

const HOP_ORDER: Hop[] = ["direct", "2hop", "3hop"];
const HOP_LABEL: Record<Hop, string> = { direct: "1次（直接）", "2hop": "2次", "3hop": "3次" };
// D1のバインド変数上限を避けるため、IN句に渡すID件数を安全な単位に分割する
const ID_CHUNK_SIZE = 50;

function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) chunks.push(ids.slice(i, i + ID_CHUNK_SIZE));
  return chunks;
}

async function attachRelationships(db: Db, contactIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (contactIds.length === 0) return map;
  const rows = (
    await Promise.all(
      chunkIds(contactIds).map((chunk) =>
        db.select().from(schema.externalContactRelationships)
          .where(inArray(schema.externalContactRelationships.contactId, chunk)).all()
      )
    )
  ).flat();
  for (const r of rows) {
    const list = map.get(r.contactId) ?? [];
    list.push(r.relationship);
    map.set(r.contactId, list);
  }
  return map;
}

export type EnishiTarget = { kind: "egg" | "goose"; id: string; description: string };

export type EnishiResultCard = {
  hop: Hop;
  type: "egg" | "goose";
  matchedTargetLabel: string;
  counterpart: { memberId: string; name: string; emoji: string; bgColor: string };
  path: string[];
  contactPathIndex: number; // pathの中で「相手の人脈本体」を表すノードのindex（名刺情報ポップアップの対象）
  dealDescription: string;
  why: string;
  privacyNote: string | null;
  linkedMemberId: string; // 1to1導線に使う相手（for-me: 仲介メンバー本人 / giver: 貢献先メンバー本人）。自分自身の人脈がヒットした場合は空文字
  actionLabel: string;
  isMemberCandidate?: boolean; // 人脈検索限定：外部人脈ではなく「メンバー本人」がヒットした場合true（candidateIdは空）
  score?: number; // 人脈検索限定（メンバー本人）：条件との合致度（0〜100）
  isSelfMember?: boolean; // 人脈検索限定：ヒットしたメンバーが、検索した本人自身の場合true
  isOwnContact?: boolean; // for-me限定：仲介者不要で、すでに自分の人脈として登録済みの相手がヒットした場合true
  candidateId: string; // マッチした人脈・卵/ガチョウの元ID（for-me限定：「このご縁で繋がりました」フラグの対象指定に使う）
  myContactId?: string; // giver限定：「あなたの人脈」の元ID（「紹介しました」フラグの対象指定に使う。candidateIdとの組み合わせで一意）
};

/** 候補のうち、どれだけ照合できたか（束に分けて照合した検索）。失敗した束は、1回やり直しても失敗した束 */
export type MatchCoverage = {
  totalCandidates: number; unmatchedCandidates: number;
  totalBatches: number; failedBatches: number;
  /** 1回目は失敗したが、やり直しで成功した束の数 */
  retriedOkBatches: number;
  /** 照合した相手を、画面で何と呼ぶか（省略すると「候補」）。貢献のご縁は「あなたの人脈」「なかまの金の卵・金のガチョウ」 */
  subject?: string;
};

export type EnishiSearchResult = {
  groups: { hop: Hop; label: string; results: EnishiResultCard[] }[];
  truncated: boolean;
  // 貢献のご縁で自分の人脈が多すぎて抜粋した場合、実際に検索対象にした人脈の専門分野別件数
  usedContactsBreakdown?: { specialty: string; count: number }[];
  // AI呼び出しが（リトライしても）失敗し、0件という結果自体が信頼できない場合にtrue。
  // 「該当なし」と区別して、時間をおいて再実行を促すメッセージを出すために使う。
  aiCallFailed?: boolean;
  // 裏で実行した検索の、照合のできた範囲。候補の人数と、AIの照合が間に合わず調べられなかった人数（失敗した束の分）
  coverage?: MatchCoverage;
  // 人脈検索限定：合致度の高い上位メンバーの力を合わせた協業イメージ（全体のチーム活動と、2〜3名の組み合わせ）
  memberCollab?: CollabIdeas | null;
};

// 人脈検索の対象範囲
//  all                 : メンバー本人 ＋ 自分の外部人脈 ＋ 他のメンバー全員の外部人脈
//  mine_and_members    : 自分の外部人脈 ＋ 他のメンバー全員の外部人脈
//  mine_only           : 自分の外部人脈のみ
//  others_only         : 他のメンバー全員の外部人脈（自分の人脈は除く）
//  specific_members    : 指定したメンバーの外部人脈のみ
export type ContactSearchScope = "all" | "mine_and_members" | "mine_only" | "others_only" | "specific_members";
export const CONTACT_SEARCH_SCOPES: ContactSearchScope[] = ["all", "mine_and_members", "mine_only", "others_only", "specific_members"];

function hopsUpTo(maxHop: Hop): Hop[] {
  const idx = HOP_ORDER.indexOf(maxHop);
  return HOP_ORDER.slice(0, idx + 1);
}

const NO_SPECIALTY_LABEL = "（専門分野未設定）";

// 「使う自分の人脈」が上限を超えた場合、特定の専門分野に偏らないよう専門分野ごとに
// ラウンドロビンで均等に抜粋する（単純な先頭N件だと、登録順によっては特定の専門分野が
// まるごと除外されてしまうため）。
function sampleContactsFairlyBySpecialty<T extends { specialty: string | null }>(contacts: T[], limit: number): T[] {
  if (contacts.length <= limit) return contacts;
  const groups = new Map<string, T[]>();
  for (const c of contacts) {
    const key = c.specialty?.trim() || NO_SPECIALTY_LABEL;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }
  const groupArrays = [...groups.values()];
  const result: T[] = [];
  for (let round = 0; result.length < limit; round++) {
    let addedAny = false;
    for (const arr of groupArrays) {
      if (round < arr.length) {
        result.push(arr[round]);
        addedAny = true;
        if (result.length >= limit) break;
      }
    }
    if (!addedAny) break;
  }
  return result;
}

// 実際に検索対象にした人脈の専門分野別件数（多い順）。抜粋結果を画面に説明するために使う。
function computeSpecialtyBreakdown<T extends { specialty: string | null }>(contacts: T[]): { specialty: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of contacts) {
    const key = c.specialty?.trim() || NO_SPECIALTY_LABEL;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([specialty, count]) => ({ specialty, count })).sort((a, b) => b.count - a.count);
}

// ---- Claude API 呼び出し ----
async function callClaude(apiKey: string, prompt: string, opts?: { timeoutMs?: number }): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    // 時間の上限を指定したときは、超えたところで中断する（裏の処理が打ち切られる前に、失敗として記録するため）
    signal: opts?.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      // 対象の人脈・候補が多いと出力するJSONも長くなり得るため、余裕を持って引き上げる
      // （8192だと、思考トークンだけで使い切られ本文が0文字で返ってくることがあった）。
      max_tokens: 16000,
      // claude-sonnet-5は thinking を明示しなくても既定でアダプティブ思考が有効になり、
      // 候補が多いプロンプトでは内部の思考にトークンを大きく消費してしまう。この用途は
      // 単純な照合・JSON出力なので、effort: "low" で思考の深さを抑え、本文用のトークンを
      // 確保する（実際にmax_tokensで打ち切られ本文が空になる不具合を確認したための対策）。
      // 注: effort: "medium" も試したが、実データ（人脈796件規模）で応答に約4分かかり
      // 実用にならなかったため、プロンプト側の指示（direct判定の自己チェック・具体例）を
      // 強化する方針で対応し、effort は low のまま維持する。
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API error ${res.status}: ${body}`);
  }
  const data = await res.json() as { content: Array<{ type: string; text?: string }>; stop_reason?: string };
  if (data.stop_reason === "max_tokens") {
    // max_tokensで打ち切られると応答のJSONが不完全になる。パースを試みて偶然「結果0件」等の
    // 不正確な形に成功してしまうより、ここで明示的に失敗させて呼び出し元にリトライさせる。
    throw new Error("[enishi-search] Claude応答がmax_tokensで打ち切られました（出力不完全の可能性）");
  }
  return data.content.filter((c) => c.type === "text" && c.text).map((c) => c.text).join("\n");
}

export type LlmMatch = { candidateId: string; matchedTargetId: string; hop: Hop; type: "egg" | "goose"; dealDescription: string; why: string };

// パース結果：ok=false は「AI呼び出し・応答形式そのものが失敗した」ことを表し、
// ok=true & matches=[] は「AIが正常に判定した結果、該当が無かった」ことを表す。
// この2つを区別しないと、一時的な失敗が「該当なし」として静かに握りつぶされてしまう。
type ParsedMatches = { ok: true; matches: LlmMatch[] } | { ok: false };

function parseLlmMatches(content: string): ParsedMatches {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("[enishi-search] Claude応答からJSONを抽出できませんでした（打ち切りの可能性）。応答冒頭:", content.slice(0, 300));
    return { ok: false };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { results?: unknown };
    if (!Array.isArray(parsed.results)) {
      console.error("[enishi-search] Claude応答のJSONにresults配列がありません。応答冒頭:", content.slice(0, 300));
      return { ok: false };
    }
    const matches = parsed.results.filter((r: unknown): r is LlmMatch => {
      const x = r as Record<string, unknown>;
      return typeof x?.candidateId === "string" && typeof x?.matchedTargetId === "string"
        && (x?.hop === "direct" || x?.hop === "2hop" || x?.hop === "3hop")
        && (x?.type === "egg" || x?.type === "goose")
        && typeof x?.dealDescription === "string" && typeof x?.why === "string";
    });
    return { ok: true, matches };
  } catch (err) {
    console.error("[enishi-search] Claude応答のJSONパースに失敗しました（打ち切りの可能性）。応答冒頭:", content.slice(0, 300), err);
    return { ok: false };
  }
}

// callClaude + parseLlmMatches を、失敗時は1回だけ自動リトライしてから呼び出し元に返す。
// 「時間をおいて再実行すると成功する」という報告があったため、ユーザーに手動での
// 再実行を求めずサーバー側で吸収する。それでも失敗した場合のみ failed:true を返す。
async function runClaudeMatching(apiKey: string, prompt: string, label: string): Promise<{ matches: LlmMatch[]; failed: boolean }> {
  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const parsed = parseLlmMatches(await callClaude(apiKey, prompt));
      if (parsed.ok) return { matches: parsed.matches, failed: false };
      console.error(`[enishi-search] ${label} 応答の解析に失敗（試行${attempt}/${MAX_ATTEMPTS}）`);
    } catch (err) {
      console.error(`[enishi-search] ${label} 呼び出し失敗（試行${attempt}/${MAX_ATTEMPTS}）`, err);
    }
  }
  return { matches: [], failed: true };
}

// direct（金の卵）と判定された候補は、「本人の説明文が、金の卵と同じテーマを扱う"サービス提供者"
// として書かれているだけなのに、本人自身をそのニーズを持つ当事者（買い手）と誤判定してしまう」
// ケースが一次判定（effort: low、候補全体を一括処理）で一定数見つかっている。direct判定は件数が
// 少なく（多くの検索で0〜数件）、誤判定の実害も大きい（見当違いの紹介につながる）ため、
// direct判定の分だけに絞って高精度な二次チェックを行う。対象件数が少ないため、ここだけeffortを
// 上げても全体の応答速度への影響は小さい（候補全体にeffort: mediumを適用すると応答が数分かかり
// 実用にならないことを確認済みのため、一次判定はeffort: lowのまま維持している）。
type DirectCheckItem = { key: string; personDescription: string; eggDescription: string };

async function verifyDirectMatches(apiKey: string, items: DirectCheckItem[]): Promise<Set<string>> {
  if (items.length === 0) return new Set();

  const prompt = `次の各ペアについて、「本人の説明」を読み、本人自身が「金の卵の説明」に当てはまる当事者（悩み・ニーズを持つ買い手本人）と言えそうかを判定してください。判定に迷う場合や情報が不足している場合は true（一次判定を維持）としてください。false と判定するのは、明確な根拠がある場合に限ります。

# false と判定してよい場合（限定的）
本人の説明が、金の卵とまったく同じ具体的なサービス・商品を「事業として提供する側」だと明確に書かれており、かつ金の卵の説明文自体が「そのサービスを外部から調達したい・依頼したい」という文脈である場合。つまり、本人がそのサービスの"供給元"であり、金の卵はその"顧客"を探しているという、直接の競合・重複関係が明確なケースに限ります。

# true と判定すべき場合（それ以外はすべてこちら）
- 本人の事業内容やテーマが金の卵と似ている・重なる部分があっても、明確な供給元／競合関係とまでは言えない場合。
- 本人が何らかの事業者であっても、個人としてまたは自社の経営課題として金の卵の悩みを抱えている可能性がある場合（例：経営コンサルタントも、自社の別の経営課題では困っている当事者になり得る）。
- 判定材料が乏しく、falseと断定できない場合。

# 判定対象
${items.map((it) => `- id: ${it.key}\n  本人の説明: ${it.personDescription}\n  金の卵の説明: ${it.eggDescription}`).join("\n")}

出力は次のJSON形式のみ。1文字目から必ず「{」で始めること（前置きの説明は書かない）:
{"results":[{"id":"...","isDirectBuyer":true|false}]}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 4000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return new Set(items.map((i) => i.key)); // フェイルセーフ: 検証呼び出し自体が失敗した場合は一次判定を維持する

    const data = await res.json() as { content: Array<{ type: string; text?: string }> };
    const text = data.content.filter((c) => c.type === "text" && c.text).map((c) => c.text).join("\n");
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return new Set(items.map((i) => i.key));

    const parsed = JSON.parse(jsonMatch[0]) as { results?: { id?: string; isDirectBuyer?: boolean }[] };
    const survivors = new Set<string>();
    for (const r of parsed.results ?? []) {
      if (r.id && r.isDirectBuyer) survivors.add(r.id);
    }
    return survivors;
  } catch (err) {
    console.error("[enishi-search] direct判定の二次チェックに失敗（フェイルセーフで一次判定を維持）", err);
    return new Set(items.map((i) => i.key));
  }
}

function buildInstructions(count: number, maxHop: Hop, perspective: "for-me" | "giver"): string {
  const selfCheck = `# direct判定の参考：見当違いの紹介を避けるための注意点
候補者本人の説明文（専門分野・事業内容）が、金の卵と全く同じ具体的なサービス・商品を「事業として提供する側」だと明確に書かれており、かつ金の卵の説明文自体が「そのサービスを外部から調達したい」という文脈である場合（＝候補者と金の卵が直接の競合・供給元と顧客の関係になる場合）は、候補者自身ではなく候補者の既存の顧客・取引先の方が買い手候補としてふさわしいため、2hop（金のガチョウ）として扱うことを検討してください。
ただし、これはあくまで「両者が全く同じサービスの供給元・顧客の関係」という明確なケースに限った注意点です。事業内容やテーマが部分的に重なる・似ている程度（例：どちらも「組織づくり」「チームビルディング」等の言葉を含む）では、direct（金の卵）の対象から外すべきではありません。候補者が何らかの事業を営んでいても、その候補者自身が別の経営課題やニーズを抱える当事者であることは十分あり得るため、判断に迷う場合は direct の対象に含めてください（除外しすぎるより、多少ノイズが混じる方が実用上望ましい）。`;
  const hopExplain = perspective === "for-me"
    ? `- direct: 候補（他メンバーの人脈）「本人」が、指定された「金の卵」の説明に当てはまり、本人自身が買い手（顧客）になり得る場合。候補と金の卵が全く同じサービスの供給元・顧客の関係になる（＝候補自身は仲介者・供給元であり、買い手にはならない）と明確に判断できる場合のみ、direct ではなく 2hop として扱うこと。
- 2hop: 候補の説明が、指定された「金のガチョウ」の説明に合致する（その人脈経由で、いずれ卵に辿り着けそうという想定）。上記の理由でdirectから2hopに回したケースもここに含める。
- 3hop: 候補の説明からは直接ガチョウには見えないが、業種・立場から見て「ガチョウ像に当てはまる人物を知っていそう／紹介できそう」と推測できる（例：商工会議所職員、業界団体の事務局など、多くの経営者・専門家と接点を持つ立場）。根拠が弱くても、もっともらしい推測であれば採用してよい。`
    : `- direct: あなたの人脈「本人」が、指定されたメンバーの「金の卵」の説明に当てはまり、本人自身がそのメンバーの顧客になり得る場合。あなたの人脈と金の卵が全く同じサービスの供給元・顧客の関係になる（＝その人脈自身は仲介者・供給元であり、買い手にはならない）と明確に判断できる場合のみ、direct ではなく 2hop（金のガチョウ）として扱うこと。
- 2hop: あなたの人脈の説明が、指定されたメンバーの「金のガチョウ」の説明に合致する（紹介元・継続的な卵の供給源になりそう）。上記の理由でdirectから2hopに回したケースもここに含める。
- 3hop: あなたの人脈からは直接ガチョウには見えないが、業種・立場から見て「ガチョウ像に当てはまる人物を知っていそう」と推測できる。`;

  return `あなたはBNIチャプターの紹介マッチングを支援するAIです。
以下の「さがす対象」と「候補一覧」を照らし合わせ、有望な紹介の道筋を最大${count}件、JSON形式のみで出力してください。

${selfCheck}

# 到達方法（hop）の判定基準
${hopExplain}
今回は「${HOP_LABEL[maxHop]}まで」が指定されているため、${hopsUpTo(maxHop).map((h) => HOP_LABEL[h]).join("・")} のいずれかに分類される候補のみを対象にしてください。

# 出力ルール
- 候補一覧に存在する candidateId のみを使うこと。存在しないIDや実名を作り出さないこと。
- 候補として渡された情報以外の個人情報（連絡先など）を推測・記載しないこと。
- dealDescription（1〜2文、日本語、温かみのある丁寧な文体）: どんな案件・貢献が期待できそうかの説明。
- why（1文、日本語）: どの「さがす対象」のどの特徴に合致したかの根拠。
- 数値スコアは一切出力しないこと。
- 対象・候補が多い場合でも、1件ずつの検討過程やリストの読み上げを本文として書き出さないこと。内部で判断した上で、結論のJSONだけを出力すること。
- 出力は次のJSON形式のみ。1文字目から必ず「{」で始めること（前置きの説明・検討過程・コードブロック記法は一切書かない）:
{"results":[{"candidateId":"...","matchedTargetId":"...","hop":"direct|2hop|3hop","type":"egg|goose","dealDescription":"...","why":"..."}]}`;
}

// 人脈検索（純粋な横断検索）用のプロンプト。他モードと異なり「さがす対象」は金の卵/ガチョウではなく
// 自由記述の検索条件そのものであり、hop（到達方法）の概念も存在しない。
function buildContactSearchInstructions(count: number, freeText: string): string {
  return `あなたはBNIチャプターの人脈検索を支援するAIです。
これは紹介の道筋をさがすものではなく、指定された条件に合う人物を人脈データベースから横断的に見つけ出す、純粋な検索機能です。
以下の「検索条件」に合致する人物を、候補一覧の中から最大${count}件、関連性が高い順にJSON形式のみで出力してください。

# 検索条件
${freeText}

# 出力ルール
- 候補一覧に存在する candidateId のみを使うこと。存在しないIDや実名を作り出さないこと。
- 候補として渡された情報以外の個人情報（連絡先など）を推測・記載しないこと。
- 検索条件に明確に合致しない候補は出力しないこと（無理に${count}件まで埋めようとしなくてよい）。
- dealDescription（1文、日本語）: その人物がどんな立場・事業をしている人かの要約。
- why（1文、日本語）: 検索条件のどの点に合致したかの根拠。
- matchedTargetId は常に "query"、hop は常に "direct"、type は常に "egg" を指定すること（内部処理用の固定値）。
- 数値スコアは一切出力しないこと。
- 候補が多い場合でも、1件ずつの検討過程やリストの読み上げを本文として書き出さないこと。内部で判断した上で、結論のJSONだけを出力すること。
- 出力は次のJSON形式のみ。1文字目から必ず「{」で始めること（前置きの説明・検討過程・コードブロック記法は一切書かない）:
{"results":[{"candidateId":"...","matchedTargetId":"query","hop":"direct","type":"egg","dealDescription":"...","why":"..."}]}`;
}

// ---- モード別: 候補収集 ----

type ForMeCandidate = {
  candidateId: string; ownerMemberId: string; ownerName: string; ownerEmoji: string; ownerBgColor: string;
  specialty: string | null; relationships: string[]; businessSummary: string | null;
  visibility: string; name: string | null; company: string | null;
  isOwn: boolean; // 自分自身が登録した人脈かどうか（自分の人脈も忘れずに検索対象へ含めるため）
};

async function collectForMeCandidates(db: Db, meId: string): Promise<ForMeCandidate[]> {
  // 「このご縁で繋がりました」「今後の表示は不要です」のいずれかがチェック済みの人脈は、
  // 本人の今後の検索から除外する（理由は別テーブルで管理するが、除外の効果は同じ）
  const [transactedRows, hiddenRows] = await Promise.all([
    db.select({ contactId: schema.enishiTransactedContacts.contactId })
      .from(schema.enishiTransactedContacts)
      .where(eq(schema.enishiTransactedContacts.memberId, meId))
      .all(),
    db.select({ contactId: schema.enishiHiddenContacts.contactId })
      .from(schema.enishiHiddenContacts)
      .where(eq(schema.enishiHiddenContacts.memberId, meId))
      .all(),
  ]);
  const transactedIds = new Set([...transactedRows, ...hiddenRows].map((r) => r.contactId));

  // なかまの人脈（非公開を除く）に加えて、自分自身の人脈も検索対象に含める
  // （自分で登録したはずの人脈を忘れているケースがあるため）。自分の人脈は
  // 公開範囲に関わらず含める——非公開設定は「他人に見せない」ためのものであり、
  // 本人自身の検索を妨げる理由にはならない。
  const allContactRows = await db.select().from(schema.externalContacts)
    .where(or(
      and(ne(schema.externalContacts.ownerMemberId, meId), ne(schema.externalContacts.visibility, "private")),
      eq(schema.externalContacts.ownerMemberId, meId)
    ))
    .all();
  const contactRows = allContactRows.filter((c) => !transactedIds.has(c.id));
  if (contactRows.length === 0) return [];

  const otherOwnerIds = [...new Set(contactRows.filter((c) => c.ownerMemberId !== meId).map((c) => c.ownerMemberId))];
  const owners = otherOwnerIds.length > 0
    ? (await Promise.all(chunkIds(otherOwnerIds).map((chunk) =>
        db.select().from(schema.members).where(inArray(schema.members.id, chunk)).all()
      ))).flat()
    : [];
  const ownerMap = new Map(owners.map((m) => [m.id, m]));
  const relMap = await attachRelationships(db, contactRows.map((c) => c.id));

  const candidates = contactRows.map((c) => {
    const isOwn = c.ownerMemberId === meId;
    const owner = isOwn ? null : ownerMap.get(c.ownerMemberId);
    // 自分自身の人脈は、公開範囲の設定に関わらず本人には常に詳細が見える
    const showDetail = isOwn || c.visibility === "full";
    return {
      candidateId: c.id,
      ownerMemberId: c.ownerMemberId,
      ownerName: isOwn ? "あなた自身" : (owner?.name ?? "不明なメンバー"),
      ownerEmoji: isOwn ? "👤" : (owner?.emoji ?? "❓"),
      ownerBgColor: isOwn ? "bg-stone-100" : (owner?.bgColor ?? "bg-stone-100"),
      specialty: c.specialty,
      relationships: relMap.get(c.id) ?? [],
      businessSummary: c.businessSummaryStatus === "done" ? c.businessSummary : null,
      visibility: c.visibility,
      name: showDetail ? c.name : null,
      company: showDetail ? c.company : null,
      isOwn,
    };
  });
  // AIに渡して意味のある情報（氏名・会社名・専門分野・事業概要・関係性）が1つもない人脈は、候補から外す。
  // 他のメンバーの人脈は、公開範囲が「存在のみ」だと氏名・会社名を伏せるため、説明の生成が終わるまでは
  // 「所属メンバー名」しか残らず、見つけようがない。そのまま混ぜると、上限（候補数）を占めて、
  // 説明のある人脈が候補から押し出されてしまう。
  return candidates.filter((c) => c.name || c.company || c.specialty || c.businessSummary || c.relationships.length > 0);
}

// 人脈検索「すべて」で、メンバー本人として結果に並べる最大件数（外部人脈の結果も十分に表示されるよう、上限を設ける）
const MEMBER_RESULT_LIMIT = 10;

type GiverCandidate = {
  candidateId: string; kind: "egg" | "goose"; memberId: string; memberName: string; memberEmoji: string; memberBgColor: string; description: string; extra: string | null;
  /** そのメンバーの職種・事業内容（全員に公開されている項目）。逆向きの検索で、メンバーの立場から役立つかを判断するために使う */
  memberBusiness: string;
};

/** メンバーの職種・事業内容（全員に公開されている項目）を、1行にまとめる */
function describeMemberBusiness(m: { category: string; businessDescription: string } | undefined): string {
  if (!m) return "";
  return [m.category && `職種: ${m.category}`, m.businessDescription && `事業内容: ${m.businessDescription.replace(/\s+/g, " ").slice(0, 200)}`].filter(Boolean).join(" ／ ");
}

async function collectGiverCandidates(db: Db, meId: string, targetMemberIds: string[] | null): Promise<GiverCandidate[]> {
  // 通常は、指定された貢献先メンバー（最大5名）の卵/ガチョウのみ。targetMemberIds が null のときは、自分以外の全メンバーのもの（逆向きの検索）
  const [eggs, geese] = await Promise.all([
    db.select().from(schema.goldenEggs)
      .where(targetMemberIds ? and(inArray(schema.goldenEggs.memberId, targetMemberIds), ne(schema.goldenEggs.memberId, meId)) : ne(schema.goldenEggs.memberId, meId)).all(),
    db.select().from(schema.goldenGeese)
      .where(targetMemberIds ? and(inArray(schema.goldenGeese.memberId, targetMemberIds), ne(schema.goldenGeese.memberId, meId)) : ne(schema.goldenGeese.memberId, meId)).all(),
  ]);
  if (eggs.length === 0 && geese.length === 0) return [];

  const memberIds = [...new Set([...eggs.map((e) => e.memberId), ...geese.map((g) => g.memberId)])];
  const members = (
    await Promise.all(chunkIds(memberIds).map((chunk) =>
      db.select().from(schema.members).where(inArray(schema.members.id, chunk)).all()
    ))
  ).flat();
  const memberMap = new Map(members.map((m) => [m.id, m]));
  // 全メンバーが対象のときは、退会・休会などで活動していないメンバーは除く
  const isTarget = (memberId: string): boolean => targetMemberIds !== null || memberMap.get(memberId)?.status === "active";

  const eggCandidates: GiverCandidate[] = eggs.filter((e) => isTarget(e.memberId)).map((e) => {
    const m = memberMap.get(e.memberId);
    return {
      candidateId: e.id, kind: "egg", memberId: e.memberId,
      memberName: m?.name ?? "不明なメンバー", memberEmoji: m?.emoji ?? "❓", memberBgColor: m?.bgColor ?? "bg-stone-100",
      description: e.description, extra: e.issue, memberBusiness: describeMemberBusiness(m),
    };
  });
  const gooseCandidates: GiverCandidate[] = geese.filter((g) => isTarget(g.memberId)).map((g) => {
    const m = memberMap.get(g.memberId);
    return {
      candidateId: g.id, kind: "goose", memberId: g.memberId,
      memberName: m?.name ?? "不明なメンバー", memberEmoji: m?.emoji ?? "❓", memberBgColor: m?.bgColor ?? "bg-stone-100",
      description: g.description, extra: g.contactHypothesis, memberBusiness: describeMemberBusiness(m),
    };
  });
  return [...eggCandidates, ...gooseCandidates];
}

// ---- モード別: プロンプト用テキストの構築 ----

function formatForMeCandidates(candidates: ForMeCandidate[]): string {
  return candidates.map((c) => {
    const parts = [`id: ${c.candidateId}`, `所属メンバー: ${c.ownerName}`];
    if (c.name) parts.push(`氏名: ${c.name}`);
    if (c.company) parts.push(`会社名: ${c.company}`);
    if (c.specialty) parts.push(`専門分野: ${c.specialty}`);
    if (c.relationships.length > 0) parts.push(`関係性: ${c.relationships.join("・")}`);
    if (c.businessSummary) parts.push(`事業概要: ${c.businessSummary}`);
    return `- ${parts.join(" / ")}`;
  }).join("\n");
}

function formatGiverCandidates(candidates: GiverCandidate[], withBusiness = false): string {
  return candidates.map((c) => {
    const label = c.kind === "egg" ? "金の卵" : "金のガチョウ";
    const parts = [`id: ${c.candidateId}`, `種別: ${label}`, `登録メンバー: ${c.memberName}`];
    if (withBusiness && c.memberBusiness) parts.push(`メンバーの${c.memberBusiness}`);
    parts.push(`説明: ${c.description}`);
    if (c.extra) parts.push(`補足: ${c.extra}`);
    return `- ${parts.join(" / ")}`;
  }).join("\n");
}

function formatTargets(targets: EnishiTarget[]): string {
  return targets.map((t) => `- id: ${t.id} / 種別: ${t.kind === "egg" ? "金の卵" : "金のガチョウ"} / 説明: ${t.description}`).join("\n");
}

/** 人脈検索で見つかったメンバー（合致度つき）を、結果のカードにする。人脈検索（すべて）とメンバーのUSPからの検索で共通 */
export async function buildMemberCards(
  db: Db, memberHits: { memberId: string; why: string; score: number; isSelf: boolean }[], freeText: string
): Promise<EnishiResultCard[]> {
  const cards: EnishiResultCard[] = [];
  if (memberHits.length === 0) return cards;
  const rows = await db.select().from(schema.members).where(inArray(schema.members.id, memberHits.map((h) => h.memberId))).all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const hit of memberHits) {
    const member = byId.get(hit.memberId);
    if (!member) continue;
    const summary = [member.category, member.businessDescription].filter(Boolean).join("／");
    cards.push({
      hop: "direct", type: "egg",
      matchedTargetLabel: freeText,
      counterpart: { memberId: member.id, name: member.name, emoji: member.emoji, bgColor: member.bgColor },
      path: hit.isSelf ? ["あなた自身"] : ["あなた", `${member.name}さん（メンバー）`],
      contactPathIndex: -1,
      dealDescription: summary || `${member.name}さん`, why: hit.why || "職種・事業内容・USPが条件に近いメンバーです。",
      privacyNote: null,
      linkedMemberId: member.id,
      actionLabel: hit.isSelf ? "あなた自身のカードを見る" : `${member.name}さんの詳細を見る`,
      isMemberCandidate: true,
      score: hit.score,
      isSelfMember: hit.isSelf,
      candidateId: "",
    });
  }
  return cards;
}

// =============================================================
// バックグラウンド実行（検索ジョブ）用の部品
// 「私のご縁」と「人脈をさがす」は、候補をすべて1回のAI呼び出しに詰め込まず、小さな束（バッチ）に分けて照合し、
// 結果を合算する。候補の数に上限はなく、1回の処理は短いので、裏で順に進められる（services/enishi-search-job.ts）。
// =============================================================

/** 1回のAI呼び出しで照合する候補の数。少ないほど1回が速く、確実に終わる */
export const JOB_BATCH_SIZE = 15;
/** 1回のAI呼び出しに待つ時間（ミリ秒）。裏の処理の1回分（約22秒）より短くして、超えたら失敗として記録する */
export const JOB_CALL_TIMEOUT_MS = 20_000;
/** 費用の暴走を防ぐ安全弁（この件数を超えるときだけ、専門分野ごとに均等に抜粋する） */
export const JOB_MAX_CANDIDATES = 3000;
/** メンバー本人の検索結果の最大件数（人脈検索「すべて」） */
export const JOB_MEMBER_RESULT_LIMIT = MEMBER_RESULT_LIMIT;

export type JobParams =
  | { mode: "for-me"; targets: EnishiTarget[]; targetIds: string[]; maxHop: Hop; includeOwnContacts: boolean; count: number; goodMatchContext?: string }
  | { mode: "contact-search"; specialties: string[]; freeText: string; scope: ContactSearchScope; memberIds: string[]; count: number; goodMatchContext?: string }
  // 貢献のご縁：自分の人脈（絞り込み済み）× 貢献先メンバーの金の卵・金のガチョウ。自分の人脈が多くても、すべてを小分けにして照合する
  // contactIds が空でないときは「逆向き」：選んだ外部人脈（自分の人脈）が、メンバーの誰に貢献できそうかをさがす（貢献先は、全メンバー）
  | { mode: "giver"; targetMemberIds: string[]; targetMemberNames: string[]; contactIds?: string[]; contactNames?: string[]; specialties: string[]; relationships: string[]; freeText: string; maxHop: Hop; count: number; goodMatchContext?: string };

/** 候補（なかまの人脈）を束に分けて照合する検索（私のご縁・人脈をさがす）のパラメータ */
export type CandidateJobParams = Exclude<JobParams, { mode: "giver" }>;
export type JobCandidate = ForMeCandidate;
export type JobMatch = LlmMatch;
export type MemberHit = { memberId: string; why: string; score: number; isSelf: boolean };

/** 検索の対象になる候補を集める（上限は安全弁のみ）。メンバー本人も対象にするかも返す */
export async function selectJobCandidates(db: Db, meId: string, params: CandidateJobParams): Promise<{ candidates: JobCandidate[]; wantMembers: boolean; truncated: boolean }> {
  const all = await collectForMeCandidates(db, meId);
  let candidates: JobCandidate[];
  let wantMembers = false;
  if (params.mode === "for-me") {
    candidates = [...(params.includeOwnContacts ? all.filter((c) => c.isOwn) : []), ...all.filter((c) => !c.isOwn)];
  } else {
    const memberIdSet = new Set(params.memberIds);
    candidates = all.filter((cnd) => {
      switch (params.scope) {
        case "mine_only": return cnd.isOwn;
        case "others_only": return !cnd.isOwn;
        case "specific_members": return !cnd.isOwn && memberIdSet.has(cnd.ownerMemberId);
        default: return true; // all / mine_and_members
      }
    });
    if (params.specialties.length > 0) candidates = candidates.filter((cnd) => cnd.specialty && params.specialties.includes(cnd.specialty));
    wantMembers = params.scope === "all";
  }
  const truncated = candidates.length > JOB_MAX_CANDIDATES;
  if (truncated) candidates = sampleContactsFairlyBySpecialty(candidates, JOB_MAX_CANDIDATES);
  return { candidates, wantMembers, truncated };
}

/** 1つの束をAIに照合させるときの依頼文 */
function buildBatchPrompt(params: CandidateJobParams, batch: JobCandidate[]): string {
  if (params.mode === "for-me") {
    return `${buildInstructions(params.count, params.maxHop, "for-me")}

# さがす対象（あなたの金の卵・金のガチョウ）
${formatTargets(params.targets)}

# 候補一覧（なかまの外部人脈）
${formatForMeCandidates(batch)}${params.goodMatchContext ?? ""}`;
  }
  return `${buildContactSearchInstructions(params.count, params.freeText)}

# 候補一覧（外部人脈）
${formatForMeCandidates(batch)}${params.goodMatchContext ?? ""}`;
}

/** 1つの束の照合の結果。失敗のときは、管理者へのお知らせに載せる理由（error）を返す */
export type BatchOutcome = { ok: true; matches: JobMatch[] } | { ok: false; error: string };

/**
 * 1つの束を、1回だけAIに照合させる。失敗（呼び出しの失敗・時間切れ・応答の形式不正）のときは ok:false を返す
 * （やり直しは、呼び出し側が束ごとに数えて、1回だけ行う）
 */
export async function matchJobBatch(apiKey: string | undefined, isDev: boolean, params: CandidateJobParams, batch: JobCandidate[]): Promise<BatchOutcome> {
  if (isDev || !apiKey || apiKey === "dev-not-set") {
    // 開発環境だけの失敗の再現（失敗の扱い・リトライ・管理者へのお知らせを確かめるため）。条件の文に印を入れると失敗する
    //   [dev-fail]      : すべての束が失敗する ／ [dev-fail-half] : 束の先頭の候補IDの文字コードが奇数の束だけ失敗する
    const marker = JSON.stringify(params);
    if (marker.includes("[dev-fail]")) return { ok: false, error: "開発用の失敗の再現" };
    if (marker.includes("[dev-fail-8]") && batch.length >= 8) return { ok: false, error: "開発用の失敗の再現（8件以上）" }; // 半分に分けたとき、大きいほうの半分だけが失敗する
    if (marker.includes("[dev-fail-big]") && batch.length > 8) return { ok: false, error: "開発用の失敗の再現（大きい束）" }; // 半分に分けたやり直しで成功する
    if (marker.includes("[dev-fail-half]") && ((batch[0]?.candidateId.charCodeAt(0) ?? 0) % 2 === 1)) return { ok: false, error: "開発用の失敗の再現（半分）" };
    // 開発環境用: 各束の先頭2件を「合致」として返す（束の分割・合算・通知の流れを確かめるため）
    const matches = batch.slice(0, 2).map((c): JobMatch => {
      if (params.mode === "contact-search") {
        return { candidateId: c.candidateId, matchedTargetId: "query", hop: "direct", type: "egg", dealDescription: "開発環境用のモックです。", why: "開発モックのため根拠は生成されていません。" };
      }
      const target = params.targets[0];
      return {
        candidateId: c.candidateId, matchedTargetId: target?.id ?? "dev", hop: target?.kind === "goose" ? "2hop" : "direct",
        type: target?.kind ?? "egg", dealDescription: "開発環境用のモックです。", why: "開発モックのため根拠は生成されていません。",
      };
    });
    return { ok: true, matches };
  }
  try {
    const parsed = parseLlmMatches(await callClaude(apiKey, buildBatchPrompt(params, batch), { timeoutMs: JOB_CALL_TIMEOUT_MS }));
    return parsed.ok ? { ok: true, matches: parsed.matches } : { ok: false, error: "応答の形式が不正" };
  } catch (err) {
    console.error("[enishi-search] 束の照合に失敗", err);
    return { ok: false, error: describeBatchError(err) };
  }
}

/** 失敗の理由を、管理者へのお知らせに載せられる短い言葉にする（個人情報や、AIの応答の中身は含めない） */
function describeBatchError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "時間切れ（AIの応答が遅い）";
    const m = /Claude API error (\d{3})/.exec(err.message);
    if (m) return m[1] === "429" ? "AIの利用回数の上限（429）" : m[1] === "529" ? "AIが混み合っている（529）" : `AIのエラー（${m[1]}）`;
    if (err.message.includes("max_tokens")) return "AIの応答が長すぎて途中で切れた";
  }
  return "原因不明のエラー";
}

/** 束ごとの結果を、束をまたいで順番に1件ずつ取り出して並べる（特定の束の結果だけが上位を占めないようにする） */
export function interleaveMatches(perBatch: JobMatch[][]): JobMatch[] {
  const out: JobMatch[] = [];
  const longest = Math.max(0, ...perBatch.map((m) => m.length));
  for (let i = 0; i < longest; i++) for (const m of perBatch) if (i < m.length) out.push(m[i]);
  return out;
}

/** 人脈検索「すべて」のメンバー本人の検索（AI）。結果は合致度の高い順の上位だけ */
export async function searchMemberHits(db: Db, apiKey: string | undefined, isDev: boolean, meId: string, freeText: string, specialties: string[]): Promise<MemberHit[]> {
  const out = await runMemberSearch({ db, apiKey, isDev, meId, usps: [], freeText, specialties });
  return (out.results ?? []).slice(0, JOB_MEMBER_RESULT_LIMIT);
}

/** メンバー本人が2名以上ヒットしたときだけ作る協業イメージ */
export async function buildMemberCollab(db: Db, apiKey: string | undefined, isDev: boolean, freeText: string, hits: MemberHit[]): Promise<CollabIdeas | null> {
  if (hits.length < 2) return null;
  return generateCollabIdeas({ db, apiKey, isDev, freeText, rankedMemberIds: hits.map((h) => h.memberId) });
}

/** 「私のご縁」の結果を組み立てる（照合済みの結果から、表示用のカードを作る） */
export async function finalizeForMeResult(args: {
  apiKey: string | undefined; isDev: boolean; params: Extract<JobParams, { mode: "for-me" }>;
  candidates: JobCandidate[]; matches: JobMatch[]; aiCallFailed: boolean; truncated: boolean;
}): Promise<EnishiSearchResult> {
  const { isDev, params, candidates, matches, aiCallFailed, truncated } = args;
  const apiKey = args.apiKey ?? "";
  const { targets, maxHop, count } = params;
  const candidateMap = new Map(candidates.map((c) => [c.candidateId, c]));
  const targetMap = new Map(targets.map((t) => [t.id, t]));
  const cards: EnishiResultCard[] = [];
  const directChecks: DirectCheckItem[] = [];
  for (const m of matches) {
    const cand = candidateMap.get(m.candidateId);
    const target = targetMap.get(m.matchedTargetId);
    if (!cand || !target || !hopsUpTo(maxHop).includes(m.hop)) continue;
    // hop/typeはAIの自己申告(m.hop, m.type)を鵜呑みにせず、実際にマッチした対象の種別（target.kind）から
    // 導出する。direct（1次）はegg、2hop/3hopはgooseに対応するはずで、一致しない場合は
    // AIの判定が内部矛盾している（例：ガチョウにマッチしたのに1次のエッグとして返す）ため破棄する。
    const type = target.kind;
    if ((m.hop === "direct") !== (type === "egg")) continue;
    const intermediaryLabel = cand.name ?? `${cand.specialty ?? "人脈"}（属性のみ）`;
    if (type === "egg") {
      directChecks.push({
        key: String(cards.length),
        personDescription: [cand.name, cand.company, cand.specialty, cand.businessSummary].filter(Boolean).join(" / "),
        eggDescription: target.description,
      });
    }

    // 自分自身の人脈がヒットした場合：なかまに仲介してもらう必要がなく、すでに直接の接点がある
    if (cand.isOwn) {
      const path = m.hop === "direct"
        ? ["あなた", `${intermediaryLabel}（あなた自身の人脈）`]
        : m.hop === "2hop"
          ? ["あなた", `${intermediaryLabel}（あなた自身の金のガチョウ）`, "卵"]
          : ["あなた", `${intermediaryLabel}（あなた自身のガチョウ候補）`, "あなたの金のガチョウ", "卵"];
      cards.push({
        hop: m.hop, type,
        matchedTargetLabel: target.description,
        counterpart: { memberId: "", name: intermediaryLabel, emoji: "👤", bgColor: "bg-stone-100" },
        path, contactPathIndex: 1, dealDescription: m.dealDescription, why: m.why,
        privacyNote: "これはあなた自身が登録した人脈です。すでに接点があるので、まずは直接連絡してみましょう。",
        linkedMemberId: "",
        actionLabel: `${intermediaryLabel}さんに直接連絡してみる`,
        isOwnContact: true,
        candidateId: cand.candidateId,
      });
      continue;
    }

    const path = m.hop === "direct"
      ? ["あなた", `${cand.ownerName}さん`, `${intermediaryLabel}（あなたの金の卵）`]
      : m.hop === "2hop"
        ? ["あなた", `${cand.ownerName}さん`, `${intermediaryLabel}（あなたの金のガチョウ）`, "卵"]
        : ["あなた", `${cand.ownerName}さん`, `${intermediaryLabel}（ガチョウを紹介できる人）`, "あなたの金のガチョウ", "卵"];
    cards.push({
      hop: m.hop, type,
      matchedTargetLabel: target.description,
      counterpart: { memberId: cand.ownerMemberId, name: cand.ownerName, emoji: cand.ownerEmoji, bgColor: cand.ownerBgColor },
      path, contactPathIndex: 2, dealDescription: m.dealDescription, why: m.why,
      privacyNote: cand.visibility === "full" ? null : "相手はなかまの人脈です。実名・連絡先は伏せています。まずはご本人に相談してみましょう。",
      linkedMemberId: cand.ownerMemberId,
      actionLabel: `${cand.ownerName}さんと1to1を組む`,
      candidateId: cand.candidateId,
    });
  }

  const directSurvivors = isDev ? new Set(directChecks.map((d) => d.key)) : await verifyDirectMatches(apiKey, directChecks);
  const rejectedIndices = new Set(
    directChecks.filter((d) => !directSurvivors.has(d.key)).map((d) => Number(d.key))
  );
  const verifiedCards = cards.filter((_, idx) => !rejectedIndices.has(idx));

  // なかま経由の結果を優先し、自分自身の人脈（isOwnContact）は表示件数の上限に達したときに
  // 後回しになるようにする（自分の人脈も検索対象に含めているが、新しい出会いにつながる
  // なかま経由のご縁の方を優先して見せたいため）。
  const sorted = HOP_ORDER.flatMap((h) => {
    const hopCards = verifiedCards.filter((c) => c.hop === h);
    return [...hopCards.filter((c) => !c.isOwnContact), ...hopCards.filter((c) => c.isOwnContact)];
  }).slice(0, count);
  return {
    groups: hopsUpTo(maxHop).map((h) => ({ hop: h, label: HOP_LABEL[h], results: sorted.filter((c) => c.hop === h) })),
    truncated,
    aiCallFailed,
  };
}

/** 「人脈をさがす」の結果を組み立てる */
export async function finalizeContactSearchResult(args: {
  db: Db; params: Extract<JobParams, { mode: "contact-search" }>;
  candidates: JobCandidate[]; matches: JobMatch[]; aiCallFailed: boolean; truncated: boolean;
  memberHits: MemberHit[]; memberCollab: CollabIdeas | null;
}): Promise<EnishiSearchResult> {
  const { db, params, candidates, matches, aiCallFailed, truncated, memberHits, memberCollab } = args;
  const { freeText, count } = params;
  const cards: EnishiResultCard[] = [];

  // メンバー本人（合致度の高い順）。外部人脈の結果より先に並べる
  cards.push(...await buildMemberCards(db, memberHits, freeText));

  const candidateMap = new Map(candidates.map((cnd) => [cnd.candidateId, cnd]));
  for (const m of matches) {
    const cand = candidateMap.get(m.candidateId);
    if (!cand) continue;
    const intermediaryLabel = cand.name ?? `${cand.specialty ?? "人脈"}（属性のみ）`;

    if (cand.isOwn) {
      cards.push({
        hop: "direct", type: "egg",
        matchedTargetLabel: freeText,
        counterpart: { memberId: "", name: intermediaryLabel, emoji: "👤", bgColor: "bg-stone-100" },
        path: ["あなた", `${intermediaryLabel}（あなた自身の人脈）`],
        contactPathIndex: 1,
        dealDescription: m.dealDescription, why: m.why,
        privacyNote: "これはあなた自身が登録した人脈です。すでに接点があるので、まずは直接連絡してみましょう。",
        linkedMemberId: "",
        actionLabel: `${intermediaryLabel}さんに直接連絡してみる`,
        isOwnContact: true,
        candidateId: cand.candidateId,
      });
      continue;
    }

    cards.push({
      hop: "direct", type: "egg",
      matchedTargetLabel: freeText,
      counterpart: { memberId: cand.ownerMemberId, name: cand.ownerName, emoji: cand.ownerEmoji, bgColor: cand.ownerBgColor },
      path: ["あなた", `${cand.ownerName}さん`, `${intermediaryLabel}（人脈）`],
      contactPathIndex: 2,
      dealDescription: m.dealDescription, why: m.why,
      privacyNote: cand.visibility === "full" ? null : "相手はなかまの人脈です。実名・連絡先は伏せています。まずはご本人に相談してみましょう。",
      linkedMemberId: cand.ownerMemberId,
      actionLabel: `${cand.ownerName}さんに紹介をお願いする`,
      candidateId: cand.candidateId,
    });
  }

  const sorted = cards.slice(0, count);
  return { groups: [{ hop: "direct", label: "検索結果", results: sorted }], truncated, aiCallFailed, memberCollab };
}


// =============================================================
// 貢献のご縁（giver）の、バックグラウンド実行用の部品
//   自分の人脈（絞り込み済み）× 貢献先メンバー（最大5名）の金の卵・金のガチョウ。
//   自分の人脈が多くても、一部を抜粋せず、人脈を小さな束に分け、貢献先ごとに照合して、結果を合算する。
//   束の中身は「<貢献先のメンバーID>|<自分の人脈ID>」の並び（同じ束の中は、同じ貢献先だけ）。
// =============================================================

/** 1つの束に入れる、自分の人脈の数 */
export const GIVER_BATCH_CONTACTS = 20;
/** 費用の暴走を防ぐ安全弁（自分の人脈がこの件数を超えるときだけ、専門分野ごとに均等に抜粋する） */
export const GIVER_MAX_CONTACTS = 1000;
/** 貢献先1人あたりの卵・ガチョウの件数の上限（1回の依頼文が大きくなりすぎないようにする安全弁） */
const GIVER_MAX_CANDIDATES_PER_MEMBER = 200;

export type GiverJobParams = Extract<JobParams, { mode: "giver" }>;
type MyContact = typeof schema.externalContacts.$inferSelect;

export type GiverContext = {
  /** 検索に使う自分の人脈（絞り込み済み） */
  contacts: MyContact[];
  /** 安全弁で、人脈を抜粋したか */
  truncated: boolean;
  /** 貢献先メンバーごとの、金の卵・金のガチョウ */
  candidatesByMember: Map<string, GiverCandidate[]>;
  /** 「紹介しました」済みの組み合わせ */
  introduced: { myContactId: string; candidateId: string }[];
};

/** 逆向きの検索（選んだ外部人脈が、メンバーの誰に貢献できそうか）か */
export function isReverseGiver(params: GiverJobParams): boolean { return (params.contactIds?.length ?? 0) > 0; }

/** 逆向きの検索で、1つの束に入れる、金の卵・金のガチョウの数と、自分の人脈の数 */
const REVERSE_BATCH_CANDIDATES = 30;
const REVERSE_BATCH_CONTACTS = 10;

/** 貢献のご縁の検索に使う、自分の人脈と、貢献先の卵・ガチョウを集める */
export async function loadGiverContext(db: Db, meId: string, params: GiverJobParams): Promise<GiverContext> {
  const reverse = isReverseGiver(params);
  let contacts = await db.select().from(schema.externalContacts)
    .where(and(eq(schema.externalContacts.ownerMemberId, meId), ne(schema.externalContacts.visibility, "private"))).all();
  let truncated = false;
  if (reverse) {
    // 逆向き：選んだ外部人脈だけ（絞り込みや抜粋はしない）
    const wanted = new Set(params.contactIds);
    contacts = contacts.filter((c) => wanted.has(c.id));
  } else {
    const { specialties, relationships, freeText } = params;
    if (specialties.length > 0) contacts = contacts.filter((c) => c.specialty && specialties.some((sp) => c.specialty!.includes(sp)));
    if (relationships.length > 0) {
      const relMap = await attachRelationships(db, contacts.map((c) => c.id));
      contacts = contacts.filter((c) => (relMap.get(c.id) ?? []).some((r) => relationships.includes(r)));
    }
    if (freeText) {
      const needle = freeText.toLowerCase();
      contacts = contacts.filter((c) => [c.name, c.company, c.note, c.specialty, c.businessSummary].some((v) => v?.toLowerCase().includes(needle)));
    }
    truncated = contacts.length > GIVER_MAX_CONTACTS;
    if (truncated) contacts = sampleContactsFairlyBySpecialty(contacts, GIVER_MAX_CONTACTS);
  }

  const candidatesByMember = new Map<string, GiverCandidate[]>();
  for (const cand of await collectGiverCandidates(db, meId, reverse ? null : params.targetMemberIds)) {
    const list = candidatesByMember.get(cand.memberId) ?? [];
    if (list.length < GIVER_MAX_CANDIDATES_PER_MEMBER) list.push(cand);
    candidatesByMember.set(cand.memberId, list);
  }
  const introduced = await db.select({
    myContactId: schema.enishiIntroducedContacts.myContactId,
    candidateId: schema.enishiIntroducedContacts.candidateId,
  }).from(schema.enishiIntroducedContacts).where(eq(schema.enishiIntroducedContacts.memberId, meId)).all();
  return { contacts, truncated, candidatesByMember, introduced };
}

/**
 * 束の分け方
 *  ・通常：貢献先ごとに、自分の人脈を GIVER_BATCH_CONTACTS 人ずつに分ける（束の中身は「<貢献先のメンバーID>|<人脈ID>」）
 *  ・逆向き：全メンバーの卵・ガチョウを REVERSE_BATCH_CANDIDATES 件ずつ、選んだ人脈を REVERSE_BATCH_CONTACTS 人ずつに分ける（束の中身は「<卵・ガチョウのID>|<人脈ID>」）
 * （卵・ガチョウのない貢献先は、照合しようがないので飛ばす）
 */
export function buildGiverBatches(params: GiverJobParams, ctx: GiverContext): string[][] {
  const batches: string[][] = [];
  if (isReverseGiver(params)) {
    const all = [...ctx.candidatesByMember.values()].flat();
    for (let i = 0; i < all.length; i += REVERSE_BATCH_CANDIDATES) {
      const candChunk = all.slice(i, i + REVERSE_BATCH_CANDIDATES);
      for (let k = 0; k < ctx.contacts.length; k += REVERSE_BATCH_CONTACTS) {
        const contactChunk = ctx.contacts.slice(k, k + REVERSE_BATCH_CONTACTS);
        // 卵・ガチョウごとに人脈を並べる（やり直しで半分に分けるとき、卵・ガチョウの側が半分になる）
        batches.push(candChunk.flatMap((cand) => contactChunk.map((c) => `${cand.candidateId}|${c.id}`)));
      }
    }
    return batches;
  }
  for (const memberId of params.targetMemberIds) {
    if ((ctx.candidatesByMember.get(memberId) ?? []).length === 0) continue;
    for (let i = 0; i < ctx.contacts.length; i += GIVER_BATCH_CONTACTS) {
      batches.push(ctx.contacts.slice(i, i + GIVER_BATCH_CONTACTS).map((c) => `${memberId}|${c.id}`));
    }
  }
  return batches;
}

/** 束の中身（<貢献先>|<人脈>）を、貢献先のIDと人脈のIDに分ける */
function parseGiverBatchIds(ids: string[]): { memberId: string; contactIds: string[] } {
  const memberId = ids[0]?.split("|")[0] ?? "";
  return { memberId, contactIds: ids.map((id) => id.slice(id.indexOf("|") + 1)) };
}

/**
 * 逆向きの検索（選んだ外部人脈が、メンバーの誰の役に立ちそうか）の依頼文。
 * 向きをはっきりさせる：「メンバーが外部人脈に何かを提供できるか」ではなく、「外部人脈が、メンバーのビジネスの役に立つか」を、メンバーの立場から見る。
 */
function buildReverseGiverInstructions(count: number, maxHop: Hop): string {
  return `あなたはBNIチャプターの紹介マッチングを支援するAIです。
これは「選んだ外部人脈（さがす対象）が、なかま（メンバー）のビジネスの役に立つか」を、メンバーの立場から探すものです。
各メンバーが登録した「金の卵」（そのメンバーが狙いたい案件・お客様像）と「金のガチョウ」（その卵を運んでくれそうな立場・紹介してくれそうな人）に、外部人脈が当てはまるかを照らし合わせ、有望な組み合わせを最大${count}件、JSON形式のみで出力してください。

# 向きについて（最重要）
- 考えるのは「外部人脈が、メンバーのビジネスにとって役に立つか」という向きだけです。
- 「メンバーが外部人脈の課題を解決できる」「メンバーのサービスが外部人脈に役立つ」という向きで合致させてはいけません。それは今回の目的ではありません。
- 外部人脈がメンバーの金の卵に当てはまるのは、メンバーにとって、その外部人脈が「お客様・案件の相手になり得る」ときだけです。

# 到達方法（hop）の判定基準（すべて、メンバーの立場から見た役立ち方）
- direct: 外部人脈「本人」が、そのメンバーの「金の卵」の説明に当てはまり、メンバーにとってお客様・案件の相手になり得る場合。外部人脈が、その卵と全く同じサービスを提供する側（メンバーの競合・同業の供給元）だと明確に判断できる場合は、direct にしないこと。
- 2hop: 外部人脈が、そのメンバーの「金のガチョウ」の説明に当てはまり、メンバーの卵（お客様・案件）を運んでくれそうな場合。
- 3hop: 外部人脈から直接ガチョウには見えないが、業種・立場から見て「メンバーの金のガチョウ像に当てはまる人を知っていそう」と推測できる場合。
今回は「${HOP_LABEL[maxHop]}まで」が指定されているため、${hopsUpTo(maxHop).map((h) => HOP_LABEL[h]).join("・")} のいずれかに分類されるものだけを対象にしてください。

# 出力ルール
- candidateId は候補一覧に存在するものだけを、matchedTargetId は「さがす対象（外部人脈）」に存在する id だけを使うこと。存在しないIDや実名を作り出さないこと。
- 渡された情報以外の個人情報（連絡先など）を推測・記載しないこと。
- 役立ちそうな根拠が弱いものは、無理に出さないこと（${count}件に満たなくてよい）。
- dealDescription（1〜2文、日本語、温かみのある丁寧な文体）: 「（メンバー名）さんにとって、この外部人脈と出会うと、どんな案件・お客様・紹介が期待できそうか」を、メンバーの立場で書く。
- why（1文、日本語）: 「この外部人脈は、（メンバー名）さんの（金の卵／金のガチョウ）のどの点に当てはまり、メンバーのビジネスにどう役立つか」を、メンバーの立場で書く。
- 数値スコアは一切出力しないこと。
- 対象・候補が多い場合でも、1件ずつの検討過程やリストの読み上げを本文として書き出さないこと。内部で判断した上で、結論のJSONだけを出力すること。
- 出力は次のJSON形式のみ。1文字目から必ず「{」で始めること（前置きの説明・検討過程・コードブロック記法は一切書かない）:
{"results":[{"candidateId":"...","matchedTargetId":"...","hop":"direct|2hop|3hop","type":"egg|goose","dealDescription":"...","why":"..."}]}`;
}

/** 貢献のご縁の束を、1回だけAIに照合させる（失敗のときは ok:false。やり直しは呼び出し側が数える） */
export async function matchGiverBatch(
  apiKey: string | undefined, isDev: boolean, params: GiverJobParams, ctx: GiverContext, ids: string[],
): Promise<BatchOutcome> {
  const contactMap = new Map(ctx.contacts.map((c) => [c.id, c]));
  let cands: GiverCandidate[];
  let contacts: MyContact[];
  if (isReverseGiver(params)) {
    // 逆向き：束の中身は「<卵・ガチョウのID>|<人脈ID>」。重ならないように、それぞれの一覧を取り出す
    const candById = new Map([...ctx.candidatesByMember.values()].flat().map((c) => [c.candidateId, c]));
    const candIds = [...new Set(ids.map((id) => id.split("|")[0]))];
    const contactIds = [...new Set(ids.map((id) => id.slice(id.indexOf("|") + 1)))];
    cands = candIds.map((id) => candById.get(id)).filter((c): c is GiverCandidate => !!c);
    contacts = contactIds.map((id) => contactMap.get(id)).filter((c): c is MyContact => !!c);
  } else {
    const { memberId, contactIds } = parseGiverBatchIds(ids);
    cands = ctx.candidatesByMember.get(memberId) ?? [];
    contacts = contactIds.map((id) => contactMap.get(id)).filter((c): c is MyContact => !!c);
  }
  if (contacts.length === 0 || cands.length === 0) return { ok: true, matches: [] };

  if (isDev || !apiKey || apiKey === "dev-not-set") {
    if (JSON.stringify(params).includes("[dev-fail]")) return { ok: false, error: "開発用の失敗の再現" };
    // 開発環境用: 束の先頭2人を「合致」として返す（束の分割・合算・通知の流れを確かめるため）。逆向きは、先頭の人脈と、先頭の2件の卵・ガチョウ
    if (isReverseGiver(params)) {
      return {
        ok: true,
        matches: cands.slice(0, 2).map((cand): JobMatch => ({
          candidateId: cand.candidateId, matchedTargetId: contacts[0].id,
          hop: cand.kind === "goose" ? "2hop" : "direct", type: cand.kind,
          dealDescription: "開発環境用のモックです。", why: "開発モックのため根拠は生成されていません。",
        })),
      };
    }
    const cand = cands[0];
    return {
      ok: true,
      matches: contacts.slice(0, 2).map((c): JobMatch => ({
        candidateId: cand.candidateId, matchedTargetId: c.id,
        hop: cand.kind === "goose" ? "2hop" : "direct", type: cand.kind,
        dealDescription: "開発環境用のモックです。", why: "開発モックのため根拠は生成されていません。",
      })),
    };
  }

  const relevantIntroduced = ctx.introduced.filter((r) => contacts.some((c) => c.id === r.myContactId) && cands.some((c) => c.candidateId === r.candidateId));
  const excludedPairsSection = relevantIntroduced.length > 0
    ? `\n\n# 除外リスト（既に紹介済みのため、以下の組み合わせは結果に含めないこと）\n${relevantIntroduced.map((r) => `- 人脈id: ${r.myContactId} / 候補id: ${r.candidateId}`).join("\n")}`
    : "";
  const reverse = isReverseGiver(params);
  const prompt = `${reverse ? buildReverseGiverInstructions(params.count, params.maxHop) : buildInstructions(params.count, params.maxHop, "giver")}

# さがす対象（${reverse ? "あなたが選んだ外部人脈" : "あなたの人脈。絞り込み済み"}）
${contacts.map((c) => `- id: ${c.id} / 説明: ${[c.name, c.company, c.specialty, c.businessSummary].filter(Boolean).join(" / ")}`).join("\n")}

# 候補一覧（なかまの金の卵・金のガチョウ）
${formatGiverCandidates(cands, reverse)}${excludedPairsSection}${params.goodMatchContext ?? ""}`;
  try {
    const parsed = parseLlmMatches(await callClaude(apiKey, prompt, { timeoutMs: JOB_CALL_TIMEOUT_MS }));
    return parsed.ok ? { ok: true, matches: parsed.matches } : { ok: false, error: "応答の形式が不正" };
  } catch (err) {
    console.error("[enishi-search] 貢献のご縁の束の照合に失敗", err);
    return { ok: false, error: describeBatchError(err) };
  }
}

// 逆向きの検索の、仕上げの検証：「その外部人脈は、本当に、そのメンバーのビジネスの役に立つか」を、メンバーの立場から確かめる。
// 照合の段階（束ごと）では、メンバーの卵・ガチョウに当てはまるかを広く拾うため、メンバーにとっての役立ち方が弱いもの、
// 向きが逆のもの（メンバーが外部人脈の役に立つだけ）が混じることがある。ここで、上位の候補だけを、まとめて確かめ直す。
type UsefulnessItem = { key: string; memberName: string; memberBusiness: string; targetLabel: string; targetDescription: string; contactDescription: string; hop: Hop };
type UsefulnessVerdict = { useful: boolean; reason: string };

/** 検証にかける候補の最大件数（1回のAI呼び出しに収める） */
const USEFULNESS_VERIFY_MAX = 30;
/** 検証の呼び出しを待つ時間（ミリ秒）。裏の処理の1回分に収まる長さ */
const USEFULNESS_VERIFY_TIMEOUT_MS = 18_000;

/** 失敗したとき（呼び出しの失敗・時間切れ・形式不正）は null（検証できなかった。呼び出し側は、照合の結果をそのまま使う） */
async function verifyUsefulToMember(apiKey: string, items: UsefulnessItem[]): Promise<Map<string, UsefulnessVerdict> | null> {
  if (items.length === 0) return new Map();
  const prompt = `あなたはBNIチャプターの紹介を支援するAIです。次の各組み合わせについて、「外部人脈が、そのメンバーのビジネスの役に立つか」を、メンバーの立場から検証してください。

# 検証の観点（すべて、メンバーの立場から）
- 向きは「外部人脈 → メンバーのビジネス」だけです。「メンバーのサービスが外部人脈の役に立つ」という理由では、useful を true にしないこと。
- 種別が「金の卵」の場合：外部人脈が、メンバーにとって、お客様・案件の相手になり得るか。外部人脈が、メンバーと同じサービスを提供する同業・競合だと明確なら false。
- 種別が「金のガチョウ」の場合：外部人脈が、メンバーのお客様（卵）を運んでくれそう・紹介してくれそうな立場か。
- メンバーの職種・事業内容に照らして、不自然な組み合わせ（業種が全く噛み合わない、役立つ筋道が想像できない）は false。
- 判断に迷う場合や、情報が乏しい場合は true としてください（false にするのは、はっきりした理由があるときだけ）。

# reason（1文、日本語）
「（メンバー名）さんにとって、この外部人脈は、〜の点で役立ちそう」という形で、メンバーの立場から書く。false のときは、役立たないと考えた理由を書く。

# 検証対象
${items.map((it) => `- id: ${it.key}
  メンバー: ${it.memberName}${it.memberBusiness ? `（${it.memberBusiness}）` : ""}
  メンバーの${it.targetLabel}: ${it.targetDescription}
  外部人脈: ${it.contactDescription}`).join("\n")}

出力は次のJSON形式のみ。1文字目から必ず「{」で始めること（前置きの説明は書かない）:
{"results":[{"id":"...","useful":true|false,"reason":"..."}]}`;
  try {
    const text = await callClaude(apiKey, prompt, { timeoutMs: USEFULNESS_VERIFY_TIMEOUT_MS });
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as { results?: { id?: unknown; useful?: unknown; reason?: unknown }[] };
    if (!Array.isArray(parsed.results)) return null;
    const out = new Map<string, UsefulnessVerdict>();
    for (const r of parsed.results) {
      if (typeof r.id === "string" && typeof r.useful === "boolean") out.set(r.id, { useful: r.useful, reason: typeof r.reason === "string" ? r.reason.trim() : "" });
    }
    return out;
  } catch (err) {
    console.error("[enishi-search] メンバーの立場からの役立ちの検証に失敗（照合の結果をそのまま使う）", err);
    return null;
  }
}

/** 「貢献のご縁」の結果を組み立てる（照合済みの結果から、表示用のカードを作る） */
export async function finalizeGiverResult(args: {
  apiKey: string | undefined; isDev: boolean; params: GiverJobParams; ctx: GiverContext;
  matches: JobMatch[]; aiCallFailed: boolean;
}): Promise<EnishiSearchResult> {
  const { isDev, params, ctx, matches, aiCallFailed } = args;
  const apiKey = args.apiKey ?? "";
  const { maxHop, count } = params;
  const introducedKeys = new Set(ctx.introduced.map((r) => `${r.myContactId}|${r.candidateId}`));
  const candidateMap = new Map([...ctx.candidatesByMember.values()].flat().map((c) => [c.candidateId, c]));
  const myContactMap = new Map(ctx.contacts.map((c) => [c.id, c]));
  const cards: EnishiResultCard[] = [];
  const directChecks: DirectCheckItem[] = [];
  for (const m of matches) {
    const cand = candidateMap.get(m.candidateId);
    const myContact = myContactMap.get(m.matchedTargetId);
    if (!cand || !myContact || !hopsUpTo(maxHop).includes(m.hop)) continue;
    // 上の依頼でAIに除外を伝えてあるが、従わない場合の保険として、ここでも除外する
    if (introducedKeys.has(`${myContact.id}|${cand.candidateId}`)) continue;
    // hop/typeはAIの自己申告ではなく、実際にマッチした候補の種別（cand.kind）から導出する。
    // direct（1次）はegg、2hop/3hopはgooseに対応するはずで、一致しない場合はAIの判定が内部矛盾しているため破棄する
    const type = cand.kind;
    if ((m.hop === "direct") !== (type === "egg")) continue;
    if (type === "egg") {
      directChecks.push({
        key: String(cards.length),
        personDescription: [myContact.name, myContact.company, myContact.specialty, myContact.businessSummary].filter(Boolean).join(" / "),
        eggDescription: cand.description,
      });
    }
    const path = m.hop === "direct"
      ? [`あなたの人脈：${myContact.name}`, `${cand.memberName}さんの金の卵`]
      : m.hop === "2hop"
        ? [`あなたの人脈：${myContact.name}`, `${cand.memberName}さんの金のガチョウ`, `${cand.memberName}さんの金の卵`]
        : [`あなたの人脈：${myContact.name}`, "ガチョウを紹介できそうな人", `${cand.memberName}さんの金のガチョウ`, `${cand.memberName}さんの金の卵`];
    cards.push({
      hop: m.hop, type,
      matchedTargetLabel: `${cand.memberName}さんの${cand.kind === "egg" ? "金の卵" : "金のガチョウ"}`,
      counterpart: { memberId: cand.memberId, name: cand.memberName, emoji: cand.memberEmoji, bgColor: cand.memberBgColor },
      path, contactPathIndex: 0, dealDescription: m.dealDescription, why: m.why,
      privacyNote: null, // 貢献のご縁で使うのは自分自身の人脈なので実名で問題ない
      linkedMemberId: cand.memberId,
      actionLabel: `${myContact.name}さんを${cand.memberName}さんに紹介する`,
      candidateId: cand.candidateId,
      myContactId: myContact.id,
    });
  }

  let verifiedCards: EnishiResultCard[];
  if (isReverseGiver(params)) {
    // 逆向き：上位の候補を、メンバーの立場から「外部人脈が役立つか」検証し、役立たないものを外して、根拠の文も、メンバーの立場のものにする
    const ordered = HOP_ORDER.flatMap((h) => cards.filter((c) => c.hop === h)).slice(0, USEFULNESS_VERIFY_MAX);
    const items: UsefulnessItem[] = ordered.map((card, i) => {
      const cand = candidateMap.get(card.candidateId);
      const contact = myContactMap.get(card.myContactId ?? "");
      return {
        key: String(i), memberName: card.counterpart.name, memberBusiness: cand?.memberBusiness ?? "",
        targetLabel: card.type === "egg" ? "金の卵" : "金のガチョウ", targetDescription: cand?.description ?? "",
        contactDescription: [contact?.name, contact?.company, contact?.specialty, contact?.businessSummary].filter(Boolean).join(" / "), hop: card.hop,
      };
    });
    const verdicts = isDev ? null : await verifyUsefulToMember(apiKey, items);
    // 検証できなかったときは、検証なしの結果を出さず、失敗として扱って、もう一度やり直す（呼び出し側が回数を数え、最後の1回だけは、検証を省いて仕上げる）
    if (!isDev && !verdicts && items.length > 0) throw new Error("[enishi-search] メンバーの立場からの役立ちの検証ができませんでした");
    verifiedCards = ordered.flatMap((card, i) => {
      const v = verdicts?.get(String(i));
      if (!verdicts) return [card]; // 検証できなかったときは、照合の結果をそのまま使う
      if (!v || !v.useful) return []; // 役立たないと判断されたもの、判定が返ってこなかったものは外す
      return [v.reason ? { ...card, why: v.reason } : card];
    });
  } else {
    const directSurvivors = isDev ? new Set(directChecks.map((d) => d.key)) : await verifyDirectMatches(apiKey, directChecks);
    const rejectedIndices = new Set(directChecks.filter((d) => !directSurvivors.has(d.key)).map((d) => Number(d.key)));
    verifiedCards = cards.filter((_, idx) => !rejectedIndices.has(idx));
  }
  const sorted = HOP_ORDER.flatMap((h) => verifiedCards.filter((c) => c.hop === h)).slice(0, count);
  return {
    groups: hopsUpTo(maxHop).map((h) => ({ hop: h, label: HOP_LABEL[h], results: sorted.filter((c) => c.hop === h) })),
    truncated: ctx.truncated,
    usedContactsBreakdown: ctx.truncated ? computeSpecialtyBreakdown(ctx.contacts) : undefined,
    aiCallFailed,
  };
}
