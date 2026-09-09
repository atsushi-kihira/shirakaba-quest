// =============================================================
// OCRサービス — Google Cloud Vision API + Claude 構造化解析
// =============================================================

export type SkillOcr = {
  name: string;
  emoji: string;
  issue: string;
  connector: string;
  solution: string;
};

export type CardOcrResult = {
  // 表面（スキルカード）
  memberName?: string;
  skills: SkillOcr[];       // 0〜3件
  // 裏面（名刺）
  company?: string;
  role?: string;
  phone?: string;
  email?: string;
  address?: string;
  // 生テキスト（確認・デバッグ用）
  rawText: string;
  // 表面のみ: 読み取った内容が白樺クエストカード（USP/SKILLsが3件、課題→解決の構造を持つカード）の
  // レイアウトに見えるかどうか。false の場合、呼び出し元は骨組みの自動入力をせず手入力に誘導する。
  cardMatched?: boolean;
};

// -------------------------------------------------------
// Step1: Google Cloud Vision API でテキスト抽出
// -------------------------------------------------------
export async function extractTextFromImage(opts: {
  imageBase64: string;
  apiKey: string;
  isDev: boolean;
}): Promise<string> {
  if (opts.isDev || !opts.apiKey || opts.apiKey === "dev-not-set") {
    return "";   // 開発環境: 空文字を返す（呼び出し元でモック判定）
  }

  const res = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${opts.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: opts.imageBase64 },
            features: [{ type: "TEXT_DETECTION", maxResults: 1 }],
          },
        ],
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Vision API error ${res.status}: ${body}`);
  }

  const json = await res.json() as {
    responses: Array<{ fullTextAnnotation?: { text: string } }>;
  };
  return json.responses[0]?.fullTextAnnotation?.text ?? "";
}

// -------------------------------------------------------
// Step2: Claude API でカードテキストを構造化
// -------------------------------------------------------
export async function parseCardWithClaude(opts: {
  rawText: string;
  side: "front" | "back";
  apiKey: string;
  cardLabel?: string; // 表面カードのタイトル文言（組織ごとにカスタマイズ可。例:「USP・SKILLs」）
}): Promise<Omit<CardOcrResult, "rawText">> {
  const { rawText, side, apiKey } = opts;
  const cardLabel = opts.cardLabel?.trim() || "USP・SKILLs";

  const prompt = side === "front"
    ? `以下は、あるカードの表面をOCRで読み取ったテキストです。
このアプリの正規のカード表面は「${cardLabel}」という見出しのもとに、名前と1〜3個の
「スキル（各スキルには スキル名・絵文字・課題シーン・解決内容 の組が書かれている）」が
記載された、専用レイアウトのカードです。単なる一般的な名刺（会社名・役職・電話番号・
メールアドレスなど連絡先中心の情報しかないもの）や、無関係な書類・写真とは明確に区別してください。

OCRテキスト:
"""
${rawText}
"""

まず、このテキストが上記の専用カード表面（名前＋課題→解決の構造を持つスキルの記載）に
一致するかどうかを判定してください。一般的な名刺・書類・その他の文書にしか見えない場合は
matched を false にし、skills は空配列にしてください（memberNameだけ読み取れても matched は
trueにしないでください。課題→解決の構造を持つスキル記載が最低1つ必要です）。

以下のJSON形式で返してください。コードブロック不要、JSONのみ。
{
  "matched": true,
  "memberName": "山田 太郎",
  "skills": [
    {
      "name": "スキル名",
      "emoji": "💡",
      "issue": "課題シーン（〜に対して、の前の部分）",
      "connector": "に対して、",
      "solution": "解決内容（〜することができる）"
    }
  ]
}

注意:
- matched が false の場合、skills は必ず空配列 []
- 絵文字が読み取れない場合は "💡" をデフォルトにする
- 課題・解決が一文になっている場合は適切に分割する`
    : `以下はBNI名刺カード裏面のOCR結果です。
会社名・役職・電話番号・メールアドレス・住所を抽出してください。

OCRテキスト:
"""
${rawText}
"""

以下のJSON形式で返してください。コードブロック不要、JSONのみ。
{
  "company": "株式会社〇〇",
  "role": "代表取締役",
  "phone": "090-0000-0000",
  "email": "xxx@example.com",
  "address": "東京都〇〇区..."
}

注意: 見つからない項目は null にする`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API error ${res.status}: ${body}`);
  }

  const data = await res.json() as {
    content: Array<{ type: string; text: string }>;
  };
  const text = data.content.find((c) => c.type === "text")?.text ?? "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude応答からJSONを抽出できませんでした");

  const parsed = JSON.parse(jsonMatch[0]);
  if (side === "front") {
    const { matched, ...rest } = parsed as { matched?: boolean } & Record<string, unknown>;
    return { ...rest, cardMatched: matched !== false } as Omit<CardOcrResult, "rawText">;
  }
  return parsed;
}

// -------------------------------------------------------
// メイン: OCR + 構造化 を一括実行
// -------------------------------------------------------
export async function scanCard(opts: {
  imageBase64: string;
  side: "front" | "back";
  visionApiKey: string;
  anthropicApiKey: string;
  isDev: boolean;
  cardLabel?: string;
}): Promise<CardOcrResult> {
  const { imageBase64, side, visionApiKey, anthropicApiKey, isDev, cardLabel } = opts;

  // 開発環境: モックデータを返す
  if (isDev) {
    return side === "front"
      ? {
          rawText: "[開発モード]",
          memberName: "",
          skills: [
            { name: "", emoji: "💡", issue: "", connector: "に対して、", solution: "" },
            { name: "", emoji: "🔧", issue: "", connector: "に対して、", solution: "" },
            { name: "", emoji: "🎯", issue: "", connector: "に対して、", solution: "" },
          ],
        }
      : {
          rawText: "[開発モード]",
          skills: [],
          company: "",
          role: "",
          phone: "",
          email: "",
          address: "",
        };
  }

  // Step1: Vision API でテキスト抽出
  const rawText = await extractTextFromImage({
    imageBase64,
    apiKey: visionApiKey,
    isDev: false,
  });

  if (!rawText.trim()) {
    return { rawText: "", skills: [], cardMatched: side === "front" ? false : undefined };
  }

  // Step2: Claude で構造化
  const structured = await parseCardWithClaude({
    rawText,
    side,
    apiKey: anthropicApiKey,
    cardLabel,
  });

  return {
    rawText,
    ...structured,
    skills: structured.skills ?? [],
  };
}
