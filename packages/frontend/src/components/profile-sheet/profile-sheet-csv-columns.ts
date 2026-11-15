// =============================================================
// 資料メモの一覧表（CSV・Excel）の列と、ひな形のダウンロード
// =============================================================

/** 一覧表の列（この順に並べたものを、ひな形にする）。hint は、書式の説明に出す一言 */
export const COLUMNS = [
  { key: "name", header: "名前", match: ["名前", "氏名", "お名前"], hint: "必須。例）山田 太郎。登録済みの人と名前が同じなら、その人のメモを更新します" },
  { key: "furigana", header: "ふりがな", match: ["ふりがな", "フリガナ", "読み"], hint: "任意。例）やまだ たろう" },
  { key: "company", header: "会社・屋号", match: ["会社", "屋号"], hint: "任意。同じ名前の人が複数いるとき、この列で見分けます。入れると、会社のホームページと事業内容を自動で調べます（取り込みが10人までのとき）" },
  { key: "title", header: "業種・肩書き", match: ["業種", "肩書"], hint: "任意。例）ITコンサルタント" },
  { key: "oneononeDate", header: "1to1した日", match: ["1to1", "1対1", "面談日"], hint: "任意。例）2026-06-03 または 2026/6/3（Excelの日付のままでも読み取れます）" },
  { key: "expertise", header: "専門・強み", match: ["専門", "強み"], hint: "任意。提供しているサービス・経歴・実績など（セルの中で改行してもかまいません）" },
  { key: "wantedReferrals", header: "紹介してほしい相手（理想のお客様）", match: ["紹介してほしい", "理想のお客", "理想"], hint: "任意。紹介できそうな人をさがすときに使われます" },
  { key: "personality", header: "人柄・話題メモ", match: ["人柄", "話題"], hint: "任意。出身・趣味・話のきっかけなど" },
  { key: "contactInfo", header: "連絡手段", match: ["連絡"], hint: "任意。Webサイト・SNS・メール・電話など。あなただけが見られ、検索やAIには使いません" },
  { key: "tags", header: "タグ", match: ["タグ"], hint: "任意。空白かカンマで区切ります。例）#ITコンサル #ゴルフ" },
] as const;

export function downloadSheetTemplate() {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const sample = ["山田 太郎", "やまだ たろう", "株式会社サンプル", "ITコンサルタント", "2026-06-03", "システム開発の相談が得意です", "システム開発に困っている経営者", "ゴルフ・コーヒー好き", "https://example.com", "#ITコンサル #ゴルフ"];
  const csv = "﻿" + [COLUMNS.map((c) => esc(c.header)).join(","), sample.map(esc).join(",")].join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = "紹介シート_取り込み用ひな形.csv"; a.click();
  URL.revokeObjectURL(url);
}
