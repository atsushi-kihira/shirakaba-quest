// =============================================================
// 紹介シートの表（「項目」と「内容」の2列で、添付の表のように見せる）
// =============================================================
import type { ProfileSheet, ProfileSheetFields } from "@shared/types";
import { LinkifiedText } from "@/components/linkified-text";
import { SHEET_FIELDS } from "./profile-sheet-shared";

export function ProfileSheetTable({ sheet }: { sheet: ProfileSheet | ProfileSheetFields }) {
  const rows = SHEET_FIELDS.map((f) => ({ label: f.label, value: sheet[f.key] }));
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
          {rows.map((r) => (
            <tr key={r.label} style={{ borderTop: "1px solid var(--color-paper-300)" }}>
              <th className="text-left font-semibold text-xs px-3 py-2.5 align-top" style={{ color: "var(--color-ink-700)" }}>{r.label}</th>
              <td className="px-3 py-2.5 align-top whitespace-pre-wrap break-words" style={{ color: "var(--color-ink-800)" }}>
                {r.value ? <LinkifiedText text={r.value} /> : <span style={{ color: "var(--color-ink-300)" }}>記載なし</span>}
              </td>
            </tr>
          ))}
          <tr style={{ borderTop: "1px solid var(--color-paper-300)" }}>
            <th className="text-left font-semibold text-xs px-3 py-2.5 align-top" style={{ color: "var(--color-ink-700)" }}>タグ</th>
            <td className="px-3 py-2.5 align-top">
              {sheet.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {sheet.tags.map((t) => (
                    <span key={t} className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: "rgba(212,160,59,0.18)", color: "var(--color-ink-700)" }}>#{t}</span>
                  ))}
                </div>
              ) : <span style={{ color: "var(--color-ink-300)" }}>記載なし</span>}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
