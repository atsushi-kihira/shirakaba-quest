// =============================================================
// 資料メモの一覧表（CSV・Excel）の書式の説明
//   列の名前と書き方・取り込みのルール・ひな形のダウンロードを、ひとまとめに見せる
// =============================================================
import { Download } from "lucide-react";
import type { ProfileSheetSubjectType } from "@shared/types";
import { COLUMNS, downloadSheetTemplate } from "./profile-sheet-csv-columns";

export function SheetFormatGuide({ type }: { type: ProfileSheetSubjectType }) {
  const who = type === "member" ? "メンバー" : "外部人脈";
  return (
    <div className="text-xs mb-3 p-3 rounded-xl" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
      <p className="font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>📋 書式について</p>
      <p className="mb-1.5">
        1行目に見出し（列名）が入った、CSV・Excel（.xlsx）の表に対応しています。次の10項目の列を用意してください（順番は自由、見出し名が多少違っても自動で認識します。<span className="font-medium">名前の列だけ必須</span>で、ほかは空欄でもかまいません）。
      </p>
      <ul className="list-disc pl-4 mb-1.5 space-y-0.5">
        {COLUMNS.map((c) => (
          <li key={c.key}><span className="font-medium">{c.header}</span>：{c.hint}</li>
        ))}
      </ul>
      <ul className="list-disc pl-4 mb-2 space-y-0.5">
        <li>
          {type === "member"
            ? "名前（同じ名前が複数いるときは会社・屋号、ふりがなも使って）が、白樺クエストに登録されているメンバーと一致した行だけ取り込みます。一致しない行は、取り込めなかった行として、理由つきでお知らせします。"
            : "名前が登録済みの人脈と一致した行は、その人のメモを更新します。一致する人がいない行は、新しい外部人脈として登録します（公開範囲は取り込み前に選べます）。"}
        </li>
        <li>すでにメモがある{who}は、表の内容で置き換わります（自分から見た印象・補足情報・会社のホームページは、そのまま残ります）。</li>
        <li>一度に取り込めるのは500行までです。Excelは、最初のシートを読み取ります。文字コードは、UTF-8・Shift_JISを自動で判定します。</li>
        <li>取り込む前に、「誰のメモが更新され、誰が新しく登録され、どの行が取り込めないか」を確認する画面が出ます。</li>
      </ul>
      <button onClick={downloadSheetTemplate} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium"
        style={{ background: "var(--color-paper-300)", color: "var(--color-ink-700)" }}>
        <Download size={13} /> ひな形（CSV）をダウンロード
      </button>
    </div>
  );
}
