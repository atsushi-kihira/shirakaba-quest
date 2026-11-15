// =============================================================
// Excel（.xlsx）の読み込み（最初のシートだけ。値を、行×列の文字列の表にして返す）
//   追加のライブラリは使わず、ブラウザの機能（ZIPの展開は DecompressionStream、XMLは DOMParser）で読む
//   日付のセルは「YYYY-MM-DD」にそろえる。数式は、Excelが保存している計算結果を使う
// =============================================================

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

type ZipEntry = { name: string; method: number; compSize: number; localOffset: number };

function listZipEntries(view: DataView, bytes: Uint8Array): ZipEntry[] {
  // ファイルの終わりから、「終端レコード」を探す
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not_zip");
  const total = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < total; n++) {
    if (view.getUint32(p, true) !== SIG_CENTRAL) throw new Error("bad_zip");
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder("utf-8").decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(view: DataView, bytes: Uint8Array, e: ZipEntry): Promise<string> {
  if (view.getUint32(e.localOffset, true) !== SIG_LOCAL) throw new Error("bad_zip");
  const nameLen = view.getUint16(e.localOffset + 26, true);
  const extraLen = view.getUint16(e.localOffset + 28, true);
  const start = e.localOffset + 30 + nameLen + extraLen;
  const data = bytes.subarray(start, start + e.compSize);
  if (e.method === 0) return new TextDecoder("utf-8").decode(data);
  if (e.method !== 8) throw new Error("unsupported_zip");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new TextDecoder("utf-8").decode(await new Response(stream).arrayBuffer());
}

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, "application/xml");
}

/** "AB12" の "AB" を、0始まりの列番号にする */
function colIndexOf(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** 表示形式が日付か（組み込みの日付の番号、または、y・m・d を含む独自の形式） */
function isDateFormat(id: number, formats: Map<number, string>): boolean {
  if ((id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58)) return true;
  const code = formats.get(id);
  if (!code) return false;
  const stripped = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /[ymd]/i.test(stripped);
}

function serialToDate(serial: number): string {
  const ms = Math.round(serial * 86400000) + Date.UTC(1899, 11, 30);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function parseXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  const entries = listZipEntries(view, bytes);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const read = async (name: string): Promise<string | null> => {
    const e = byName.get(name);
    return e ? readEntry(view, bytes, e) : null;
  };

  // 最初のシート
  let sheetPath = "xl/worksheets/sheet1.xml";
  if (!byName.has(sheetPath)) {
    const first = entries.map((e) => e.name).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
    if (!first) throw new Error("no_sheet");
    sheetPath = first;
  }
  const sheetXml = await read(sheetPath);
  if (!sheetXml) throw new Error("no_sheet");

  // 文字列の一覧
  const shared: string[] = [];
  const sharedXml = await read("xl/sharedStrings.xml");
  if (sharedXml) {
    const doc = parseXml(sharedXml);
    for (const si of Array.from(doc.getElementsByTagName("si"))) {
      let text = "";
      for (const t of Array.from(si.getElementsByTagName("t"))) {
        if (t.parentElement?.tagName === "rPh") continue; // ふりがなの注記は除く
        text += t.textContent ?? "";
      }
      shared.push(text);
    }
  }

  // 日付のセルを見分けるための、表示形式
  const formats = new Map<number, string>();
  const xfIsDate: boolean[] = [];
  const stylesXml = await read("xl/styles.xml");
  if (stylesXml) {
    const doc = parseXml(stylesXml);
    for (const nf of Array.from(doc.getElementsByTagName("numFmt"))) {
      formats.set(Number(nf.getAttribute("numFmtId")), nf.getAttribute("formatCode") ?? "");
    }
    const cellXfs = doc.getElementsByTagName("cellXfs")[0];
    if (cellXfs) {
      for (const xf of Array.from(cellXfs.getElementsByTagName("xf"))) {
        xfIsDate.push(isDateFormat(Number(xf.getAttribute("numFmtId") ?? 0), formats));
      }
    }
  }

  const doc = parseXml(sheetXml);
  const table: string[][] = [];
  for (const rowEl of Array.from(doc.getElementsByTagName("row"))) {
    const rIdx = Number(rowEl.getAttribute("r")) - 1;
    const cells: string[] = [];
    for (const c of Array.from(rowEl.getElementsByTagName("c"))) {
      const ref = c.getAttribute("r") ?? "";
      const col = colIndexOf(ref);
      if (col < 0) continue;
      const type = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      let value = "";
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = Array.from(c.getElementsByTagName("t")).map((t) => t.textContent ?? "").join("");
      else if (type === "str") value = v;
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (type === "e") value = "";
      else if (v !== "") {
        const style = Number(c.getAttribute("s") ?? -1);
        const num = Number(v);
        value = style >= 0 && xfIsDate[style] && Number.isFinite(num) && num > 0 ? serialToDate(num) : v;
      }
      while (cells.length < col) cells.push("");
      cells[col] = value;
    }
    const at = Number.isFinite(rIdx) && rIdx >= 0 ? rIdx : table.length;
    while (table.length < at) table.push([]);
    table[at] = cells;
  }
  return table.filter((r) => r.some((c) => c.trim() !== ""));
}
