// =============================================================
// 詳細ページの「追加項目」：表示と、主催者による編集（保存すると、その場で反映。お知らせは送らない）
// =============================================================
import { useState } from "react";
import { Check, Edit2, Loader2 } from "lucide-react";
import { CustomFieldsEditor } from "@/components/custom-fields-editor";
import { CustomFieldsView } from "@/components/custom-fields-view";
import { customFieldsToPayload, validateCustomFields, visibleCustomFields, type CustomField } from "@/lib/custom-fields";

export function CustomFieldsSection({ fields, canEdit, saving, saveError, onSave, hint, className }: {
  fields: CustomField[];
  canEdit: boolean;
  saving: boolean;
  saveError?: string;
  /** 保存する（成功したら true を返す） */
  onSave: (fields: CustomField[] | undefined) => Promise<boolean>;
  /** 編集中に添える説明（定例会は、各回への反映についてなど） */
  hint?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CustomField[]>([]);
  const [error, setError] = useState("");
  const hasAny = visibleCustomFields(fields).length > 0;
  if (!hasAny && !canEdit && !editing) return null;

  if (editing) {
    return (
      <div className={`card-paper rounded-2xl p-3 space-y-2 ${className ?? ""}`}>
        <CustomFieldsEditor value={draft} onChange={setDraft} disabled={saving} />
        {hint && <p className="px-1 text-[11px]" style={{ color: "var(--color-ink-400)" }}>{hint}</p>}
        {(error || saveError) && <p className="text-xs px-1" style={{ color: "var(--color-brand)" }}>{error || saveError}</p>}
        <div className="flex gap-2">
          <button
            disabled={saving}
            onClick={async () => {
              const problem = validateCustomFields(draft);
              if (problem) { setError(problem); return; }
              setError("");
              if (await onSave(customFieldsToPayload(draft))) setEditing(false);
            }}
            className="flex-1 py-2 rounded-xl text-sm font-medium text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            保存する
          </button>
          <button onClick={() => { setEditing(false); setError(""); }} className="px-4 py-2 rounded-xl text-sm"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>キャンセル</button>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0"><CustomFieldsView fields={fields} /></div>
        {canEdit && (
          <button
            onClick={() => { setDraft(fields.map((f) => ({ ...f }))); setError(""); setEditing(true); }}
            className="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}
          >
            <Edit2 size={12} />
            {hasAny ? "追加項目を更新" : "追加項目を追加"}
          </button>
        )}
      </div>
    </div>
  );
}
