// =============================================================
// OCRサービス — Google Cloud Vision API
// 開発環境ではモックデータを返す
// =============================================================

export type OcrResult = {
  // 表面
  skillName1?: string;
  skillEmoji1?: string;
  skillIssue1?: string;
  skillSolution1?: string;
  skillName2?: string;
  skillEmoji2?: string;
  skillIssue2?: string;
  skillSolution2?: string;
  skillName3?: string;
  skillEmoji3?: string;
  skillIssue3?: string;
  skillSolution3?: string;
  memberName?: string;
  // 裏面
  company?: string;
  role?: string;
  phone?: string;
  email?: string;
  address?: string;
  // OCR生テキスト（確認用）
  rawText?: string;
};

/** 画像（base64）をOCRにかけてテキストを抽出する */
export async function extractTextFromImage(opts: {
  imageBase64: string;
  apiKey: string;
  isDev: boolean;
}): Promise<string> {
  if (opts.isDev || !opts.apiKey || opts.apiKey === "dev-not-set") {
    // 開発環境: ダミーテキストを返す
    return "[開発モード] OCRスキップ";
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
    throw new Error(`Vision API error: ${res.status}`);
  }

  const json = await res.json() as {
    responses: Array<{ fullTextAnnotation?: { text: string } }>;
  };
  return json.responses[0]?.fullTextAnnotation?.text ?? "";
}

/** OCRテキストをカード情報にパースする（簡易実装）
 *  実際の名刺フォーマットに合わせて改善が必要
 */
export function parseCardText(rawText: string, side: "front" | "back"): Partial<OcrResult> {
  const result: Partial<OcrResult> = { rawText };

  if (rawText.includes("[開発モード]")) {
    // 開発環境ではサンプルデータを返す
    if (side === "front") {
      return {
        rawText,
        memberName: "",
        skillName1: "", skillEmoji1: "💡", skillIssue1: "", skillSolution1: "",
        skillName2: "", skillEmoji2: "🔧", skillIssue2: "", skillSolution2: "",
        skillName3: "", skillEmoji3: "🎯", skillIssue3: "", skillSolution3: "",
      };
    } else {
      return { rawText, company: "", role: "", phone: "", email: "", address: "" };
    }
  }

  const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);

  if (side === "front") {
    // 名前を探す（漢字が含まれる行）
    for (const line of lines) {
      if (/[一-鿿]/.test(line) && line.length <= 10 && !result.memberName) {
        result.memberName = line;
      }
    }
  } else {
    // 裏面: メールアドレス・電話番号などをパース
    for (const line of lines) {
      if (/@/.test(line)) result.email = line.trim();
      if (/^[\d\-+()\s]{10,}$/.test(line)) result.phone = line.trim();
      if (/株式会社|有限会社|合同会社|事務所|オフィス/.test(line)) result.company = line.trim();
    }
  }

  return result;
}
