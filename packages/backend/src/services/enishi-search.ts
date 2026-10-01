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
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { schema } from "../db/index.ts";
import type { createDb } from "../db/index.ts";

type Db = ReturnType<typeof createDb>;
export type Hop = "direct" | "2hop" | "3hop";

const HOP_ORDER: Hop[] = ["direct", "2hop", "3hop"];
const HOP_LABEL: Record<Hop, string> = { direct: "1次（直接）", "2hop": "2次", "3hop": "3次" };
// D1のバインド変数上限を避けるため、IN句に渡すID件数を安全な単位に分割する
const ID_CHUNK_SIZE = 50;
// 候補が多すぎる場合にLLMへ渡す件数の上限（コスト・トークン量の安全弁）
const MAX_CANDIDATES = 400;
// 貢献のご縁で「さがす対象」に使う自分の人脈が多すぎると、LLMへの入力が肥大化し出力が
// max_tokensで打ち切られてJSONが壊れる（結果0件になる）ことがあったため、候補側と同様に上限を設ける
const MAX_MY_CONTACTS = 150;

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
  isOwnContact?: boolean; // for-me限定：仲介者不要で、すでに自分の人脈として登録済みの相手がヒットした場合true
  candidateId: string; // マッチした人脈・卵/ガチョウの元ID（for-me限定：「このご縁で繋がりました」フラグの対象指定に使う）
  myContactId?: string; // giver限定：「あなたの人脈」の元ID（「紹介しました」フラグの対象指定に使う。candidateIdとの組み合わせで一意）
};

export type EnishiSearchResult = {
  groups: { hop: Hop; label: string; results: EnishiResultCard[] }[];
  truncated: boolean;
  // 貢献のご縁で自分の人脈が多すぎて抜粋した場合、実際に検索対象にした人脈の専門分野別件数
  usedContactsBreakdown?: { specialty: string; count: number }[];
  // AI呼び出しが（リトライしても）失敗し、0件という結果自体が信頼できない場合にtrue。
  // 「該当なし」と区別して、時間をおいて再実行を促すメッセージを出すために使う。
  aiCallFailed?: boolean;
};

type ForMeParams = {
  db: Db; apiKey: string; isDev: boolean;
  mode: "for-me"; meId: string;
  targets: EnishiTarget[]; maxHop: Hop; count: number;
  includeOwnContacts: boolean; // false の場合、自分自身の人脈は検索対象から除外し「なかまの人脈」のみを対象にする
  goodMatchContext?: string; // 過去に「良いご縁だった」と評価された組み合わせ（プロンプトに追記する参考情報）
};
type GiverParams = {
  db: Db; apiKey: string; isDev: boolean;
  mode: "giver"; meId: string;
  myContacts: (typeof schema.externalContacts.$inferSelect)[];
  targetMemberIds: string[]; // 貢献先として指定されたメンバー（最大5名）。この人たちの卵/ガチョウのみを候補にする
  specialties: string[]; relationships: string[]; freeText: string;
  maxHop: Hop; count: number;
  goodMatchContext?: string;
};
// 人脈検索：誰かに貢献する・紹介の道筋をさがすものではなく、純粋に「条件に合う人物」を
// 全メンバーの外部人脈から横断検索するモード。到達方法（hop）の概念は存在しないため、
// 内部的には常に maxHop: "direct" の単一グループとして扱う（型・履歴まわりの既存実装を再利用するため）。
type ContactSearchParams = {
  db: Db; apiKey: string; isDev: boolean;
  mode: "contact-search"; meId: string;
  specialties: string[]; // 空配列 = 専門分野を問わずすべて対象
  freeText: string; // 検索条件（自由記述）。AIへの指示本体になる
  includeOwnContacts: boolean; // false の場合、自分自身の人脈は検索対象から除外する
  maxHop: Hop; count: number;
  goodMatchContext?: string;
};

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
async function callClaude(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
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

type LlmMatch = { candidateId: string; matchedTargetId: string; hop: Hop; type: "egg" | "goose"; dealDescription: string; why: string };

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

  return contactRows.map((c) => {
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
}

type GiverCandidate = { candidateId: string; kind: "egg" | "goose"; memberId: string; memberName: string; memberEmoji: string; memberBgColor: string; description: string; extra: string | null };

async function collectGiverCandidates(db: Db, meId: string, targetMemberIds: string[]): Promise<GiverCandidate[]> {
  // AIの消費量が際限なく増えないよう、候補は指定された貢献先メンバー（最大5名）の卵/ガチョウのみに絞る
  const [eggs, geese] = await Promise.all([
    db.select().from(schema.goldenEggs).where(and(inArray(schema.goldenEggs.memberId, targetMemberIds), ne(schema.goldenEggs.memberId, meId))).all(),
    db.select().from(schema.goldenGeese).where(and(inArray(schema.goldenGeese.memberId, targetMemberIds), ne(schema.goldenGeese.memberId, meId))).all(),
  ]);
  if (eggs.length === 0 && geese.length === 0) return [];

  const memberIds = [...new Set([...eggs.map((e) => e.memberId), ...geese.map((g) => g.memberId)])];
  const members = (
    await Promise.all(chunkIds(memberIds).map((chunk) =>
      db.select().from(schema.members).where(inArray(schema.members.id, chunk)).all()
    ))
  ).flat();
  const memberMap = new Map(members.map((m) => [m.id, m]));

  const eggCandidates: GiverCandidate[] = eggs.map((e) => {
    const m = memberMap.get(e.memberId);
    return {
      candidateId: e.id, kind: "egg", memberId: e.memberId,
      memberName: m?.name ?? "不明なメンバー", memberEmoji: m?.emoji ?? "❓", memberBgColor: m?.bgColor ?? "bg-stone-100",
      description: e.description, extra: e.issue,
    };
  });
  const gooseCandidates: GiverCandidate[] = geese.map((g) => {
    const m = memberMap.get(g.memberId);
    return {
      candidateId: g.id, kind: "goose", memberId: g.memberId,
      memberName: m?.name ?? "不明なメンバー", memberEmoji: m?.emoji ?? "❓", memberBgColor: m?.bgColor ?? "bg-stone-100",
      description: g.description, extra: g.contactHypothesis,
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

function formatGiverCandidates(candidates: GiverCandidate[]): string {
  return candidates.map((c) => {
    const label = c.kind === "egg" ? "金の卵" : "金のガチョウ";
    const parts = [`id: ${c.candidateId}`, `種別: ${label}`, `登録メンバー: ${c.memberName}`, `説明: ${c.description}`];
    if (c.extra) parts.push(`補足: ${c.extra}`);
    return `- ${parts.join(" / ")}`;
  }).join("\n");
}

function formatTargets(targets: EnishiTarget[]): string {
  return targets.map((t) => `- id: ${t.id} / 種別: ${t.kind === "egg" ? "金の卵" : "金のガチョウ"} / 説明: ${t.description}`).join("\n");
}

// ---- 開発用モック ----
function devMockResult(maxHop: Hop, mode: "for-me" | "giver" | "contact-search"): EnishiSearchResult {
  if (mode === "contact-search") {
    return {
      groups: [{
        hop: "direct", label: "検索結果",
        results: [{
          hop: "direct", type: "egg",
          matchedTargetLabel: "検索条件（開発モック）",
          counterpart: { memberId: "dev-member", name: "開発モック 太郎", emoji: "🧪", bgColor: "bg-stone-100" },
          path: ["あなた", "開発モック 太郎さん", "候補の人脈（属性のみ・開発モック）"],
          contactPathIndex: 2,
          dealDescription: "これは開発環境用のモックデータです。本番環境ではAIが実際の候補データから検索します。",
          why: "開発モックのため根拠は生成されていません。",
          privacyNote: "相手はなかまの人脈です。実名・連絡先は伏せています。",
          linkedMemberId: "dev-member",
          actionLabel: "開発モック 太郎さんに紹介をお願いする",
          candidateId: "dev-candidate",
        }],
      }],
      truncated: false,
    };
  }
  const groups = hopsUpTo(maxHop).map((hop) => ({
    hop, label: HOP_LABEL[hop],
    results: hop === "direct" ? [{
      hop, type: "egg" as const,
      matchedTargetLabel: mode === "for-me" ? "金の卵①（開発モック）" : "相手の金の卵（開発モック）",
      counterpart: { memberId: "dev-member", name: "開発モック 太郎", emoji: "🧪", bgColor: "bg-stone-100" },
      path: mode === "for-me"
        ? ["あなた", "開発モック 太郎さん", "候補の人脈（属性のみ・開発モック）"]
        : ["あなたの人脈（開発モック）", "開発モック 太郎さん"],
      contactPathIndex: mode === "for-me" ? 2 : 0,
      dealDescription: "これは開発環境用のモックデータです。本番環境ではAIが実際の候補データから経路を生成します。",
      why: "開発モックのため根拠は生成されていません。",
      privacyNote: mode === "for-me" ? "相手はメンバーの人脈です。実名・連絡先は伏せています。" : null,
      linkedMemberId: "dev-member",
      actionLabel: "開発モック 太郎さんと1to1を組む",
      candidateId: "dev-candidate",
      myContactId: mode === "giver" ? "dev-my-contact" : undefined,
    }] : [],
  }));
  return { groups, truncated: false };
}

// ---- メイン ----
export async function runEnishiSearch(params: ForMeParams | GiverParams | ContactSearchParams): Promise<EnishiSearchResult> {
  const { db, apiKey, isDev, maxHop, count } = params;

  if (isDev || !apiKey || apiKey === "dev-not-set") {
    await new Promise((r) => setTimeout(r, 500));
    return devMockResult(maxHop, params.mode);
  }

  if (params.mode === "contact-search") {
    const { specialties, freeText, includeOwnContacts } = params;
    const allCandidates = await collectForMeCandidates(db, params.meId);
    let candidates = includeOwnContacts ? allCandidates : allCandidates.filter((cnd) => !cnd.isOwn);
    if (specialties.length > 0) candidates = candidates.filter((cnd) => cnd.specialty && specialties.includes(cnd.specialty));
    if (candidates.length === 0) {
      return { groups: [{ hop: "direct", label: "検索結果", results: [] }], truncated: false };
    }
    const candidatesTruncated = candidates.length > MAX_CANDIDATES;
    if (candidatesTruncated) candidates = sampleContactsFairlyBySpecialty(candidates, MAX_CANDIDATES);

    const prompt = `${buildContactSearchInstructions(count, freeText)}

# 候補一覧（外部人脈）
${formatForMeCandidates(candidates)}${params.goodMatchContext ?? ""}`;

    const { matches, failed: aiCallFailed } = await runClaudeMatching(apiKey, prompt, "contact-search");

    const candidateMap = new Map(candidates.map((cnd) => [cnd.candidateId, cnd]));
    const cards: EnishiResultCard[] = [];
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
    return { groups: [{ hop: "direct", label: "検索結果", results: sorted }], truncated: candidatesTruncated, aiCallFailed };
  }

  if (params.mode === "for-me") {
    const { targets } = params;
    const allCandidates = await collectForMeCandidates(db, params.meId);

    // 自分自身の人脈となかまの人脈を分けて、それぞれ別枠で上限を設けたうえで合算する。
    // 単純に全体をMAX_CANDIDATESで切ってしまうと、自分の人脈が大量にある場合になかまの人脈が
    // 候補にまったく残らなくなったり、逆に自分の人脈が並び順次第で候補から抜け落ちたりし得るため。
    let ownCandidates = params.includeOwnContacts ? allCandidates.filter((c) => c.isOwn) : [];
    let nakamaCandidates = allCandidates.filter((c) => !c.isOwn);
    const ownTruncated = ownCandidates.length > MAX_MY_CONTACTS;
    if (ownTruncated) ownCandidates = sampleContactsFairlyBySpecialty(ownCandidates, MAX_MY_CONTACTS);
    const nakamaBudget = Math.max(0, MAX_CANDIDATES - ownCandidates.length);
    const nakamaTruncated = nakamaCandidates.length > nakamaBudget;
    if (nakamaTruncated) nakamaCandidates = nakamaCandidates.slice(0, nakamaBudget);
    const candidates = [...ownCandidates, ...nakamaCandidates];
    const truncated = ownTruncated || nakamaTruncated;
    if (candidates.length === 0) return { groups: hopsUpTo(maxHop).map((h) => ({ hop: h, label: HOP_LABEL[h], results: [] })), truncated: false };

    const prompt = `${buildInstructions(count, maxHop, "for-me")}

# さがす対象（あなたの金の卵・金のガチョウ）
${formatTargets(targets)}

# 候補一覧（なかまの外部人脈）
${formatForMeCandidates(candidates)}${params.goodMatchContext ?? ""}`;

    const { matches, failed: aiCallFailed } = await runClaudeMatching(apiKey, prompt, "for-me");

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

    const directSurvivors = await verifyDirectMatches(apiKey, directChecks);
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

  // ---- giver mode ----
  const { specialties, relationships, freeText, myContacts } = params;
  let filteredContacts = myContacts;
  if (specialties.length > 0) filteredContacts = filteredContacts.filter((c) => c.specialty && specialties.some((s) => c.specialty!.includes(s)));
  if (relationships.length > 0) {
    const relMap = await attachRelationships(db, filteredContacts.map((c) => c.id));
    filteredContacts = filteredContacts.filter((c) => (relMap.get(c.id) ?? []).some((r) => relationships.includes(r)));
  }
  if (freeText) {
    const needle = freeText.toLowerCase();
    filteredContacts = filteredContacts.filter((c) =>
      [c.name, c.company, c.note, c.specialty, c.businessSummary].some((v) => v?.toLowerCase().includes(needle))
    );
  }
  if (filteredContacts.length === 0) {
    return { groups: hopsUpTo(maxHop).map((h) => ({ hop: h, label: HOP_LABEL[h], results: [] })), truncated: false };
  }
  const myContactsTruncated = filteredContacts.length > MAX_MY_CONTACTS;
  if (myContactsTruncated) filteredContacts = sampleContactsFairlyBySpecialty(filteredContacts, MAX_MY_CONTACTS);
  const usedContactsBreakdown = myContactsTruncated ? computeSpecialtyBreakdown(filteredContacts) : undefined;

  let candidates = await collectGiverCandidates(db, params.meId, params.targetMemberIds);
  const candidatesTruncated = candidates.length > MAX_CANDIDATES;
  if (candidatesTruncated) candidates = candidates.slice(0, MAX_CANDIDATES);
  const truncated = candidatesTruncated || myContactsTruncated;
  if (candidates.length === 0) return { groups: hopsUpTo(maxHop).map((h) => ({ hop: h, label: HOP_LABEL[h], results: [] })), truncated: false };

  const myContactsForPrompt: { id: string; description: string }[] = filteredContacts.map((c) => ({
    id: c.id,
    description: [c.name, c.company, c.specialty, c.businessSummary].filter(Boolean).join(" / "),
  }));

  // 「紹介しました」済みの組み合わせ（自分の人脈×相手の金の卵/ガチョウ）は、この時点でAIに伝えて
  // 最初から除外候補として扱ってもらう。最大件数（count）の結果を返したあとに事後フィルタで
  // 除外すると、既に紹介済みの組み合わせをAIが上位に選びがちな場合に結果が大きく減ってしまう
  // 不具合があったため（例：貢献先を固定して何度も「紹介しました」を押していくと、AIが毎回同じ
  // 上位候補を選び続け、そのすべてが除外されて結果がほぼ0件になる）。
  const introducedRows = await db.select({
    myContactId: schema.enishiIntroducedContacts.myContactId,
    candidateId: schema.enishiIntroducedContacts.candidateId,
  }).from(schema.enishiIntroducedContacts).where(eq(schema.enishiIntroducedContacts.memberId, params.meId)).all();
  const introducedKeys = new Set(introducedRows.map((r) => `${r.myContactId}|${r.candidateId}`));

  // 貢献先メンバーが複数（最大5名）指定された場合、その全員分の金の卵・金のガチョウを1回のAI呼び出しに
  // まとめると、対象の一部が判定困難（例：個人の特性ベースの記述で本人の説明文と照合しにくい）な場合に、
  // AIがバッチ全体に対して結果0件を返してしまう不具合が実運用で確認された（単独メンバーなら見つかる
  // マッチも、他のメンバーと同時に照合すると消えてしまう）。そのため、貢献先メンバーごとに候補を分割し、
  // それぞれ独立したAI呼び出しで照合したうえで結果をマージする。
  const candidatesByMember = new Map<string, GiverCandidate[]>();
  for (const c of candidates) {
    const list = candidatesByMember.get(c.memberId) ?? [];
    list.push(c);
    candidatesByMember.set(c.memberId, list);
  }

  const matchResults = await Promise.all(
    [...candidatesByMember.entries()].map(([memberId, memberCandidates]) => {
      const relevantIntroduced = introducedRows.filter((r) =>
        filteredContacts.some((c) => c.id === r.myContactId) && memberCandidates.some((c) => c.candidateId === r.candidateId)
      );
      const excludedPairsSection = relevantIntroduced.length > 0
        ? `\n\n# 除外リスト（既に紹介済みのため、以下の組み合わせは結果に含めないこと）\n${relevantIntroduced.map((r) => `- 人脈id: ${r.myContactId} / 候補id: ${r.candidateId}`).join("\n")}`
        : "";

      const prompt = `${buildInstructions(count, maxHop, "giver")}

# さがす対象（あなたの人脈。絞り込み済み）
${myContactsForPrompt.map((t) => `- id: ${t.id} / 説明: ${t.description}`).join("\n")}

# 候補一覧（なかまの金の卵・金のガチョウ）
${formatGiverCandidates(memberCandidates)}${excludedPairsSection}${params.goodMatchContext ?? ""}`;

      return runClaudeMatching(apiKey, prompt, `giver:${memberId}`);
    })
  );

  const matches = matchResults.flatMap((r) => r.matches);
  const aiCallFailed = matchResults.some((r) => r.failed);

  // 上のプロンプトでAIに除外を依頼済みだが、指示に従わない場合の保険としてここでも念のため除外する
  const candidateMap = new Map(candidates.map((c) => [c.candidateId, c]));
  const myContactMap = new Map(filteredContacts.map((c) => [c.id, c]));
  const cards: EnishiResultCard[] = [];
  const directChecks: DirectCheckItem[] = [];
  for (const m of matches) {
    const cand = candidateMap.get(m.candidateId);
    const myContact = myContactMap.get(m.matchedTargetId);
    if (!cand || !myContact || !hopsUpTo(maxHop).includes(m.hop)) continue;
    if (introducedKeys.has(`${myContact.id}|${cand.candidateId}`)) continue;
    // hop/typeはAIの自己申告(m.hop, m.type)ではなく、実際にマッチした候補の種別（cand.kind）から
    // 導出する。direct（1次）はegg、2hop/3hopはgooseに対応するはずで、一致しない場合は
    // AIの判定が内部矛盾しているため破棄する（例：ガチョウにマッチしたのに1次のエッグとして返す）。
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

  const directSurvivors = await verifyDirectMatches(apiKey, directChecks);
  const rejectedIndices = new Set(
    directChecks.filter((d) => !directSurvivors.has(d.key)).map((d) => Number(d.key))
  );
  const verifiedCards = cards.filter((_, idx) => !rejectedIndices.has(idx));

  const sorted = HOP_ORDER.flatMap((h) => verifiedCards.filter((c) => c.hop === h)).slice(0, count);
  return {
    groups: hopsUpTo(maxHop).map((h) => ({ hop: h, label: HOP_LABEL[h], results: sorted.filter((c) => c.hop === h) })),
    truncated,
    usedContactsBreakdown,
    aiCallFailed,
  };
}
