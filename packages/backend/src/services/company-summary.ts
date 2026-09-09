// =============================================================
// 人脈の会社概要 自動生成サービス — Anthropic Claude API (Web検索ツール利用)
// 会社名だけを手がかりにWeb検索し、事業概要を生成する。
// 名前・会社名の公開設定に関わらず生成しておき、表示時にのみ絞り込む。
// =============================================================

export type CompanySummaryResult = {
  status: "done" | "not_found" | "error";
  summary: string | null;      // 一覧表示用の一言概要（40字程度）
  detail: string | null;       // 詳細表示用のより詳しい説明
  specialty: string | null;    // 専門分野の短いラベル（例: "税務相談"）
};

const SYSTEM_PROMPT = `あなたはビジネスネットワーキング団体のアシスタントです。
Web検索を使って、指定された会社・屋号の事業内容を調べてください。

ルール:
- 会社名は日本の中小企業・個人事業主であることが多い点に注意して検索すること
- 検索しても信頼できる情報が見つからない場合は、無理に推測せず "not_found" と判定すること
- 個人のプライバシーに踏み込む情報（住所・電話番号など）は含めないこと。事業内容・業種・特徴のみを書くこと
- 【重要】summary・detailの本文中に、調べた会社・屋号の名称そのもの、および代表者・創業者・社員など個人の実名を一切含めないこと。
  この会社概要は、会社名や氏名を伏せて（非公開のまま）表示されるため、本文に会社名や個人名を書いてしまうと非公開設定の意味がなくなる。
  「同社」「この会社」のように会社名を伏せた言い方をするか、単に主語を省略して業種・事業内容だけを説明すること。
  （例：「◯◯株式会社は、山田太郎氏が代表を務めるIT企業」ではなく「地域のIT企業で、システム開発を主に手がける」のように書く）
- 出力は最後に必ず以下のJSON形式のみを1個、コードブロックなしで出力すること（それより前に検索結果の説明文があってもよい）

{
  "status": "done" または "not_found",
  "summary": "一覧表示用の一言概要（30〜40文字程度、会社名・個人名を含めない。見つからない場合はnull）",
  "detail": "詳細表示用の説明（2〜4文程度、会社名・個人名を含めない。見つからない場合はnull）",
  "specialty": "専門分野を表す短いラベル（例: 税務相談、Web制作、リスク保険。10文字程度、会社名・個人名を含めない。見つからない場合はnull）"
}`;

function buildPrompt(company: string): string {
  return `${SYSTEM_PROMPT}

# 調べる会社・屋号名
${company}`;
}

/** Claude API (Web検索ツール付き) を呼び出し、応答中の全テキストブロックを結合して返す */
async function callClaudeWithWebSearch(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      // 会社名からの事業概要抽出は複雑な推論を要さないため、Opusより十分高速なSonnetを使う
      // （遅延生成はwaitUntilの実行時間制限内に収める必要があり、応答速度が重要）
      model: "claude-sonnet-5",
      // claude-sonnet-5はthinkingを明示しなくても既定でアダプティブ思考が有効になり、
      // Web検索を伴う場合は特に思考・検索結果の要約にトークンを消費してしまう。
      // max_tokensが小さいと、最終的なJSON出力の手前で打ち切られてしまい
      // 実在する会社でも not_found/error 扱いになる不具合の原因になっていたため、
      // 余裕を持って引き上げ、effort: "low" で思考の深さも抑える。
      max_tokens: 4096,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: prompt }],
      // claude-sonnet-5 は web_search_20260209（動的フィルタリング対応）を使う。
      // 旧型式の web_search_20250305 は古いモデル向けの基本版で、この会社概要生成では
      // 実在企業なのに情報が見つからない（not_found/error）という不具合の原因になっていた。
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API error ${res.status}: ${body}`);
  }

  const data = await res.json() as { content: Array<{ type: string; text?: string }>; stop_reason?: string };
  if (data.stop_reason === "max_tokens") {
    // max_tokensで打ち切られると最終JSONが出力されず、必ず not_found/error 扱いになる。
    // 原因究明のため必ずログに残す。
    console.error("[company-summary] Claude応答がmax_tokensで打ち切られました。");
  }
  return data.content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n");
}

function parseResult(content: string): CompanySummaryResult {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { status: "error", summary: null, detail: null, specialty: null };

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { status?: string; summary?: string | null; detail?: string | null; specialty?: string | null };
    if (parsed.status === "done" && parsed.summary) {
      return { status: "done", summary: parsed.summary, detail: parsed.detail ?? parsed.summary, specialty: parsed.specialty ?? null };
    }
    return { status: "not_found", summary: null, detail: null, specialty: null };
  } catch {
    return { status: "error", summary: null, detail: null, specialty: null };
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * プロンプトで指示していても、AIが会社名・個人名をそのまま書いてしまうことがあるための保険。
 * 本文中に会社名・個人名の文字列がそのまま含まれていたら、伏せ字表現に置き換える。
 * 「会社名+社」（例:「dbt Labs社」）は「同社社」のような重複を避けて「同社」に、
 * 会社名・個人名の直後に続く読み仮名や通称の丸括弧（例:「株式会社XEENUTS（ジーナッツ）」）も
 * まとめて伏せ字に置き換える。
 * （完全に自然な文章にはならない場合があるが、非公開情報の漏洩を防ぐことを優先する）
 */
export function sanitizeGeneratedText(text: string, company: string, name: string): string {
  let result = text;
  const trailingParen = "(?:\\s*[（(][^）)]*[）)])?";

  const trimmedCompany = company.trim();
  if (trimmedCompany && result.includes(trimmedCompany)) {
    const pattern = new RegExp(`${escapeRegExp(trimmedCompany)}社?${trailingParen}`, "g");
    result = result.replace(pattern, "同社");
  }
  const trimmedName = name.trim();
  if (trimmedName && result.includes(trimmedName)) {
    const pattern = new RegExp(`${escapeRegExp(trimmedName)}${trailingParen}`, "g");
    result = result.replace(pattern, "担当者");
  }
  return result;
}

/** 会社名からWeb検索で事業概要を生成する。company が空の場合は呼び出し側で "skipped" 扱いにすること */
export async function generateCompanySummary(opts: {
  company: string;
  name?: string; // 個人名の漏洩チェック用（任意）
  apiKey: string;
  isDev: boolean;
}): Promise<CompanySummaryResult> {
  const { company, name = "", apiKey, isDev } = opts;

  if (isDev || !apiKey || apiKey === "dev-not-set") {
    await new Promise((r) => setTimeout(r, 500));
    return {
      status: "done",
      summary: `${company}（開発モックの事業概要）`,
      detail: `${company} は開発環境のモックデータです。本番環境ではWeb検索の結果をもとに事業概要が生成されます。`,
      specialty: "開発モック分野",
    };
  }

  try {
    const content = await callClaudeWithWebSearch(apiKey, buildPrompt(company));
    const result = parseResult(content);
    return {
      ...result,
      summary: result.summary ? sanitizeGeneratedText(result.summary, company, name) : null,
      detail: result.detail ? sanitizeGeneratedText(result.detail, company, name) : null,
      specialty: result.specialty ? sanitizeGeneratedText(result.specialty, company, name) : null,
    };
  } catch (err) {
    console.error("[company-summary] 生成失敗", err);
    return { status: "error", summary: null, detail: null, specialty: null };
  }
}
