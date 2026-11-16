// =============================================================
// MTLR（メンバー・トラフィック・ライト・レポート）のPDFから、文字を1行ずつ取り出す
// PDFの読み取り部品（pdf.js）は大きいので、使うときだけ読み込む
// =============================================================

type TextPiece = { s: string; x: number; y: number };

/** 同じ高さにある文字を1行にまとめる（上から下、左から右の順） */
function toLines(pieces: TextPiece[]): string[] {
  const sorted = [...pieces].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: { y: number; items: TextPiece[] }[] = [];
  for (const p of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - p.y) <= 4) last.items.push(p);
    else rows.push({ y: p.y, items: [p] });
  }
  return rows.map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.s.trim()).filter(Boolean).join(" "));
}

/** PDFファイルから、1行ごとの文字を取り出す。文字が取り出せない（画像だけの）PDFのときは空の配列 */
export async function extractPdfLines(file: File): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerUrl = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const lines: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const pieces: TextPiece[] = [];
      for (const item of content.items) {
        if ("str" in item && item.str.trim() !== "") pieces.push({ s: item.str, x: item.transform[4], y: item.transform[5] });
      }
      lines.push(...toLines(pieces));
    }
  } finally {
    await task.destroy();
  }
  return lines;
}
