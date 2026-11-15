// =============================================================
// 資料メモの一覧表（CSV・Excel）の列と、ひな形のダウンロード
// =============================================================

/** CSVの列（この順に並べたものを、ひな形にする） */
export const COLUMNS = [
  { key: "name", header: "名前", match: ["名前", "氏名", "お名前"] },
  { key: "furigana", header: "ふりがな", match: ["ふりがな", "フリガナ", "読み"] },
  { key: "company", header: "会社・屋号", match: ["会社", "屋号"] },
  { key: "title", header: "業種・肩書き", match: ["業種", "肩書"] },
  { key: "oneononeDate", header: "1to1した日", match: ["1to1", "1対1", "面談日"] },
  { key: "expertise", header: "専門・強み", match: ["専門", "強み"] },
  { key: "wantedReferrals", header: "紹介してほしい相手（理想のお客様）", match: ["紹介してほしい", "理想のお客", "理想"] },
  { key: "personality", header: "人柄・話題メモ", match: ["人柄", "話題"] },
  { key: "contactInfo", header: "連絡手段", match: ["連絡"] },
  { key: "tags", header: "タグ", match: ["タグ"] },
] as const;

export function downloadSheetTemplate() {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const sample = ["山田 太郎", "やまだ たろう", "株式会社サンプル", "ITコンサルタント", "2026-06-03", "システム開発の相談が得意です", "システム開発に困っている経営者", "ゴルフ・コーヒー好き", "https://example.com", "#ITコンサル #ゴルフ"];
  const csv = "\uFEFF" + [COLUMNS.map((c) => esc(c.header)).join(","), sample.map(esc).join(",")].join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = "紹介シート_取り込み用ひな形.csv"; a.click();
  URL.revokeObjectURL(url);
}

