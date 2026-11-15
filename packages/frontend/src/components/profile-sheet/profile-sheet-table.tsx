// =============================================================
// 紹介シートの表（「項目」と「内容」の2列で、添付の表のように見せる）
//   ・会社・屋号は、ホームページが分かっていればリンクにする。その下に「事業内容」の行を出す
//   ・「紹介してほしい相手」の下などに、画面ごとの行（紹介できそうな人など）を差し込める
// =============================================================
import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type { ProfileSheet, ProfileSheetFields } from "@shared/types";
import { LinkifiedText } from "@/components/linkified-text";
import { SHEET_FIELDS } from "./profile-sheet-shared";

type FieldKey = (typeof SHEET_FIELDS)[number]["key"];
export type SheetExtraRow = { after: FieldKey; label: string; node: ReactNode };

type Props = {
  sheet: ProfileSheet | ProfileSheetFields;
  /** 事業内容の行の中身を差し替える（自動取得の状況の表示など）。省略時は保存された事業内容を出す */
  companyDescriptionNode?: ReactNode;
  /** 項目の下に差し込む行 */
  extraRows?: SheetExtraRow[];
  /** 「タグ」の行の中身を差し替える（同じタグの人へのリンクなど）。省略時は、タグを並べるだけ */
  tagsNode?: ReactNode;
};

const NONE = <span style={{ color: "var(--color-ink-300)" }}>記載なし</span>;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr style={{ borderTop: "1px solid var(--color-paper-300)" }}>
      <th className="text-left font-semibold text-xs px-3 py-2.5 align-top" style={{ color: "var(--color-ink-700)" }}>{label}</th>
      <td className="px-3 py-2.5 align-top whitespace-pre-wrap break-words" style={{ color: "var(--color-ink-800)" }}>{children}</td>
    </tr>
  );
}

export function ProfileSheetTable({ sheet, companyDescriptionNode, extraRows = [], tagsNode }: Props) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--color-paper-300)" }}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ background: "var(--color-paper-200)" }}>
            <th className="text-left font-semibold text-xs px-3 py-2 w-28 sm:w-44 align-top" style={{ color: "var(--color-ink-600)" }}>項目</th>
            <th className="text-left font-semibold text-xs px-3 py-2" style={{ color: "var(--color-ink-600)" }}>内容</th>
          </tr>
        </thead>
        <tbody>
          {SHEET_FIELDS.flatMap((f) => {
            const value = sheet[f.key];
            const out: ReactNode[] = [];
            if (f.key === "company") {
              out.push(
                <Row key="company" label={f.label}>
                  {value ? (
                    sheet.companyUrl ? (
                      <a href={sheet.companyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2" style={{ color: "var(--color-brand)" }}>
                        {value}<ExternalLink size={12} aria-label="会社のホームページを開く" />
                      </a>
                    ) : value
                  ) : NONE}
                </Row>,
              );
              out.push(
                <Row key="companyDescription" label="事業内容">
                  {companyDescriptionNode ?? (sheet.companyDescription ? sheet.companyDescription : NONE)}
                </Row>,
              );
            } else {
              out.push(<Row key={f.key} label={f.label}>{value ? <LinkifiedText text={value} /> : NONE}</Row>);
            }
            for (const ex of extraRows.filter((e) => e.after === f.key)) out.push(<Row key={`extra-${ex.label}`} label={ex.label}>{ex.node}</Row>);
            return out;
          })}
          <tr style={{ borderTop: "1px solid var(--color-paper-300)" }}>
            <th className="text-left font-semibold text-xs px-3 py-2.5 align-top" style={{ color: "var(--color-ink-700)" }}>タグ</th>
            <td className="px-3 py-2.5 align-top">
              {tagsNode ?? (sheet.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {sheet.tags.map((t) => (
                    <span key={t} className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: "rgba(212,160,59,0.18)", color: "var(--color-ink-700)" }}>#{t}</span>
                  ))}
                </div>
              ) : NONE)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
