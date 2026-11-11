// =============================================================
// ミーティング・定例会の「追加項目」の入力欄
//   主催者が、項目（ラベル・種類・値）を、10個まで自由に追加できる。種類は、テキスト・数値・日付。
//   例：セミナーの「講師」（テキスト）、「定員」（数値）、「申込締切」（日付）
// =============================================================
import { Plus, Trash2 } from "lucide-react";
import { FIELD_TYPE_LABEL, MAX_CUSTOM_FIELDS, MAX_LABEL_LENGTH, newCustomField, type CustomField, type CustomFieldType } from "@/lib/custom-fields";

export function CustomFieldsEditor({ value, onChange, disabled }: {
  value: CustomField[];
  onChange: (v: CustomField[]) => void;
  disabled?: boolean;
}) {
  const update = (id: string, patch: Partial<CustomField>) => onChange(value.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const inputStyle = { background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" } as const;

  return (
    <div>
      <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
        📝 追加項目（任意・{MAX_CUSTOM_FIELDS}個まで）
      </label>
      <p className="text-xs mb-2" style={{ color: "var(--color-ink-400)" }}>
        講師・定員・申込締切など、この会の案内に載せたい項目を、自由に追加できます。種類は、テキスト・数値・日付から選びます
      </p>

      <div className="space-y-2">
        {value.map((f, i) => (
          <div key={f.id} className="rounded-2xl p-3 space-y-2" style={{ background: "var(--color-paper-200)" }}>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-xs w-5 text-center" style={{ color: "var(--color-ink-400)" }}>{i + 1}</span>
              <input
                value={f.label}
                maxLength={MAX_LABEL_LENGTH}
                disabled={disabled}
                onChange={(e) => update(f.id, { label: e.target.value })}
                placeholder="ラベル（例：講師）"
                aria-label={`${i + 1}つ目の項目のラベル`}
                className="flex-1 min-w-0 px-3 py-2 rounded-xl text-sm outline-none border"
                style={inputStyle}
              />
              <select
                value={f.type}
                disabled={disabled}
                onChange={(e) => update(f.id, { type: e.target.value as CustomFieldType, value: "" })}
                aria-label={`${i + 1}つ目の項目の種類`}
                className="shrink-0 px-2 py-2 rounded-xl text-sm outline-none border"
                style={inputStyle}
              >
                {(Object.keys(FIELD_TYPE_LABEL) as CustomFieldType[]).map((t) => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}
              </select>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((x) => x.id !== f.id))}
                aria-label={`${i + 1}つ目の項目を削除`}
                className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                style={{ color: "var(--color-ink-500)" }}
              >
                <Trash2 size={15} />
              </button>
            </div>
            <div className="pl-7">
              {f.type === "date" ? (
                <input type="date" value={f.value} disabled={disabled} onChange={(e) => update(f.id, { value: e.target.value })}
                  aria-label={`${i + 1}つ目の項目の日付`} className="w-full px-3 py-2 rounded-xl text-sm outline-none border" style={inputStyle} />
              ) : f.type === "number" ? (
                <input type="text" inputMode="decimal" value={f.value} disabled={disabled} onChange={(e) => update(f.id, { value: e.target.value })}
                  placeholder="数値（例：30）" aria-label={`${i + 1}つ目の項目の数値`} className="w-full px-3 py-2 rounded-xl text-sm outline-none border" style={inputStyle} />
              ) : (
                <input type="text" value={f.value} maxLength={500} disabled={disabled} onChange={(e) => update(f.id, { value: e.target.value })}
                  placeholder="内容（例：山田 太郎）" aria-label={`${i + 1}つ目の項目の内容`} className="w-full px-3 py-2 rounded-xl text-sm outline-none border" style={inputStyle} />
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        disabled={disabled || value.length >= MAX_CUSTOM_FIELDS}
        onClick={() => onChange([...value, newCustomField()])}
        className="mt-2 flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-2xl font-medium disabled:opacity-50"
        style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}
      >
        <Plus size={15} />
        項目を追加する{value.length > 0 ? `（${value.length}/${MAX_CUSTOM_FIELDS}）` : ""}
      </button>
    </div>
  );
}
