// =============================================================
// 金の卵・金のガチョウの「1つの入力欄に複数まとめて入力されたもの」を、1件ずつに分ける
//
// 分ける基準（本文を勝手に書き換えない・誤って1件を割らないことを優先する）:
//  1. 行頭に「・」「●」「-」「①」「1.」「(1)」などの印が付いた行が2行以上ある → その印ごとに分ける
//  2. 空行で区切られた段落が2つ以上ある → 段落ごとに分ける
//  3. 改行で区切られた行が2行以上あり、どの行も短い（60字以内）→ 1行ずつに分ける
//  上記のどれにも当てはまらない（1行だけ・長い文章が改行されているだけ等）場合は、分けずにそのまま1件とする。
// =============================================================

const BULLET = /^\s*(?:[・･•●○◆◇■□▪▫★☆◎▶▷\-－ー*＊]|[（(]?[0-9０-９]{1,2}[)）.．、]|[①-⑳]|[（(][①-⑳][)）])\s*/;
const SHORT_LINE_MAX = 60;

function clean(s: string): string {
  return s.replace(/[ \t　]+$/g, "").trim();
}

export function splitMultiEntries(text: string): string[] {
  const normalized = (text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  // 「→」「⇒」で始まる行は、直前の行の補足（説明の続き）なので、前の行につなげて1項目として扱う
  const rawLines = normalized.split("\n").map((l) => l.replace(/[ \t　]+$/g, ""));
  const lines: string[] = [];
  for (const l of rawLines) {
    if (/^\s*[→⇒➡↳]/.test(l) && lines.length > 0) lines[lines.length - 1] = `${lines[lines.length - 1]} ${l.trim()}`;
    else lines.push(l);
  }
  const nonEmpty = lines.filter((l) => l.trim() !== "");

  // 1) 印付きの行
  const bulletCount = nonEmpty.filter((l) => BULLET.test(l)).length;
  if (bulletCount >= 2) {
    const entries: string[] = [];
    for (const l of lines) {
      if (l.trim() === "") continue;
      if (BULLET.test(l)) entries.push(clean(l.replace(BULLET, "")));
      else if (entries.length > 0) entries[entries.length - 1] = clean(`${entries[entries.length - 1]} ${l.trim()}`); // 印のない続きの行は直前の項目に含める
      else entries.push(clean(l));
    }
    return entries.filter(Boolean);
  }

  // 2) 空行で区切られた段落
  const paragraphs = normalized.split(/\n\s*\n/).map((p) => p.split("\n").map((l) => l.trim()).filter(Boolean).join(" ")).filter(Boolean);
  if (paragraphs.length >= 2) return paragraphs.map(clean).filter(Boolean);

  // 同じ行に「① … ② …」のように丸数字で並べている場合
  if (nonEmpty.length === 1) {
    const circled = nonEmpty[0].match(/[①-⑳]/g) ?? [];
    if (circled.length >= 2) {
      return nonEmpty[0].split(/(?=[①-⑳])/).map((p) => clean(p.replace(BULLET, ""))).filter(Boolean);
    }
  }

  // 3) 短い行が並んでいる（文の途中で改行しただけの行〔読点などで終わる行〕がある場合は、1件の文章とみなして分けない）
  const wrapped = nonEmpty.slice(0, -1).some((l) => /[、，,]$/.test(l.trim()));
  if (!wrapped && nonEmpty.length >= 2 && nonEmpty.every((l) => l.trim().length <= SHORT_LINE_MAX)) {
    return nonEmpty.map((l) => clean(l)).filter(Boolean);
  }

  return [clean(nonEmpty.join(" "))];
}
