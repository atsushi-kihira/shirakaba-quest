// =============================================================
// CSV・タブ区切り・Excel（.xlsx）ファイルの読み込み（外部人脈の取り込み・紹介シートの取り込みで共用）
// =============================================================
import { parseXlsx } from "./xlsx-parse";

/** 取り込みに使えるファイルの種類（ファイル選択の accept に使う） */
export const TABLE_FILE_ACCEPT = ".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** CSV・Excelのファイルを、行×列の文字列の表にして読む。読めないときは、画面に出せる日本語のメッセージの Error を投げる */
export async function readTableFile(file: File): Promise<string[][]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xls")) {
    throw new Error("古い形式のExcelファイル（.xls）は読み込めません。Excelで「.xlsx」または「CSV UTF-8」で保存し直してください");
  }
  if (lower.endsWith(".xlsx")) {
    try {
      return await parseXlsx(await file.arrayBuffer());
    } catch {
      throw new Error("Excelファイルを読み込めませんでした。ファイルが壊れていないか、パスワードが付いていないかをご確認ください");
    }
  }
  return parseDelimited(await decodeFile(file));
}

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
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/^\uFEFF/, "");
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
