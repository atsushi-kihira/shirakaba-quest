// =============================================================
// CSV・タブ区切りファイルの読み込み（外部人脈の取り込み・紹介シートの取り込みで共用）
// =============================================================

/** UTF-8として読み、文字化け（置換文字）が多ければShift-JISとして読み直す */
export async function decodeFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  const brokenCount = (utf8.match(/�/g) ?? []).length;
  if (brokenCount > 0) {
    try {
      return new TextDecoder("shift_jis" as never).decode(buf);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

/** カンマ／タブ区切り・引用符対応の簡易パーサー */
export function parseDelimited(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/^﻿/, "");
  const firstLine = normalized.split("\n")[0] ?? "";
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const delimiter = tabCount > commaCount ? "\t" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
