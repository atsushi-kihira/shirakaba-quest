// =============================================================
// ミーティング・定例会の「追加項目」の表示（値のある項目だけ）
// =============================================================
import { formatFieldValue, visibleCustomFields, type CustomField } from "@/lib/custom-fields";

export function CustomFieldsView({ fields, className }: { fields: CustomField[] | null | undefined; className?: string }) {
  const shown = visibleCustomFields(fields);
  if (shown.length === 0) return null;
  return (
    <dl className={`rounded-2xl px-4 py-3 space-y-1.5 ${className ?? ""}`} style={{ background: "var(--color-paper-200)" }}>
      {shown.map((f) => (
        <div key={f.id} className="flex gap-3 text-sm">
          <dt className="shrink-0 w-24 break-all font-medium" style={{ color: "var(--color-ink-500)" }}>{f.label}</dt>
          <dd className="flex-1 min-w-0 break-words" style={{ color: "var(--color-ink-800)" }}>{formatFieldValue(f)}</dd>
        </div>
      ))}
    </dl>
  );
}
