// =============================================================
// 貢献のご縁：結果リストのPDF出力
// なかまに見せて「どれが求めるリファーラルか」確認してもらいやすいよう、
// 一覧を整形した画像をPDF化してダウンロードする（html2canvas + jsPDF）。
// =============================================================
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import type { SearchResult, Hop } from "@/screens/enishi/enishi-search-screen";

const HOP_BADGE: Record<Hop, string> = { direct: "1次（直接）", "2hop": "2次", "3hop": "3次" };

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function exportGiverResultsToPdf(result: SearchResult, appTitle: string): Promise<void> {
  const flat = result.groups.flatMap((g) => g.results.map((r) => ({ card: r, hop: g.hop })));
  if (flat.length === 0) return;

  const targetNames = [...new Set(flat.map((f) => f.card.counterpart.name))];
  const dateStr = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric" }).format(new Date());

  const rowsHtml = flat.map(({ card, hop }) => {
    const personName = card.path[0]?.replace(/^あなたの人脈：/, "") ?? "人脈";
    const typeLabel = card.type === "egg" ? "🥚 卵型（直接のお客様候補）" : "🪙 ガチョウ型（紹介元候補）";
    return `
      <div style="border:1px solid #E9DFC8;border-radius:16px;padding:16px 20px;margin-bottom:14px;background:#FFFDF6;break-inside:avoid;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
          <span style="font-weight:700;font-size:16px;color:#3A2E1E;">${escapeHtml(personName)}さん</span>
          <span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:6px;background:#F1E3C4;color:#8a6d1f;">${HOP_BADGE[hop]}</span>
          <span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:6px;background:#E9DFC8;color:#5B4C38;">${typeLabel}</span>
        </div>
        <p style="font-size:13.5px;line-height:1.8;margin:0;color:#3A2E1E;">${escapeHtml(card.dealDescription)}</p>
      </div>
    `;
  }).join("");

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-99999px";
  container.style.top = "0";
  container.style.width = "800px";
  container.style.background = "#FAF5E8";
  container.style.padding = "36px";
  container.style.fontFamily = "'Zen Maru Gothic','Hiragino Maru Gothic ProN','Hiragino Sans',sans-serif";
  container.innerHTML = `
    <div style="border-bottom:3px solid #B5384B;padding-bottom:18px;margin-bottom:22px;">
      <p style="font-size:12px;color:#B5384B;font-weight:700;margin:0 0 6px;">${escapeHtml(appTitle)}｜貢献のご縁</p>
      <h1 style="font-size:23px;margin:0 0 8px;color:#3A2E1E;font-family:'Klee One','Hiragino Maru Gothic ProN',sans-serif;">
        ${escapeHtml(targetNames.join("・"))}さんへのご紹介候補
      </h1>
      <p style="font-size:12px;color:#8A7A62;margin:0;">作成日: ${dateStr}　全${flat.length}件</p>
    </div>
    ${rowsHtml}
  `;

  document.body.appendChild(container);
  try {
    await document.fonts.ready;
    const canvas = await html2canvas(container, { scale: 2, backgroundColor: "#FAF5E8", useCORS: true });
    const imgData = canvas.toDataURL("image/jpeg", 0.92);

    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    pdf.save(`${targetNames.join("_")}さんへのご紹介候補_${dateStr}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}
