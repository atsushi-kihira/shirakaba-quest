// =============================================================
// ミーティング・定例会に、主催者が追加する入力項目（最大10個。テキスト・数値・日付）
//   サーバー側（backend/src/services/custom-fields.ts）と同じ決まり。
// =============================================================
export type CustomFieldType = "text" | "number" | "date";
export type CustomField = { id: string; label: string; type: CustomFieldType; value: string };

export const MAX_CUSTOM_FIELDS = 10;
export const MAX_LABEL_LENGTH = 30;

export const FIELD_TYPE_LABEL: Record<CustomFieldType, string> = { text: "テキスト", number: "数値", date: "日付" };

let seq = 0;
export function newCustomField(type: CustomFieldType = "text"): CustomField {
  seq += 1;
  return { id: `f${Date.now().toString(36)}${seq}`, label: "", type, value: "" };
}

/** 全角の数字・記号を半角にそろえる（数値の入力用） */
export function normalizeNumberInput(v: string): string {
  return v.replace(/[０-９．－，]/g, (c) => ({ "．": ".", "－": "-", "，": "," }[c] ?? String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
}

/** 入力のチェック。問題があれば、やさしい日本語のメッセージを返す */
export function validateCustomFields(fields: CustomField[]): string {
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const label = f.label.trim();
    const value = f.value.trim();
    if (!label && !value) continue; // 空の行は、送るときに取り除く
    if (!label) return `${i + 1}つ目の追加項目に、ラベル（項目名）を入力してください`;
    if (f.type === "number" && value) {
      const n = normalizeNumberInput(value).replace(/,/g, "");
      if (!/^-?\d+(\.\d+)?$/.test(n)) return `「${label}」は、数値で入力してください`;
    }
  }
  return "";
}

/** APIに送る形（空の行は取り除く。項目がなければ undefined） */
export function customFieldsToPayload(fields: CustomField[]): CustomField[] | undefined {
  const list = fields
    .filter((f) => f.label.trim() || f.value.trim())
    .map((f) => ({ ...f, label: f.label.trim(), value: f.type === "number" ? normalizeNumberInput(f.value.trim()).replace(/,/g, "") : f.value.trim() }));
  return list.length > 0 ? list : undefined;
}

/** 日付（YYYY-MM-DD）を「2026年11月20日（金）」にする */
export function formatFieldDate(value: string): string {
  const d = new Date(`${value}T12:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return value;
  const w = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", weekday: "short" }).format(d);
  const [y, m, day] = value.split("-").map(Number);
  return `${y}年${m}月${day}日（${w}）`;
}

export function formatFieldValue(f: CustomField): string {
  if (f.type === "date") return formatFieldDate(f.value);
  if (f.type === "number") {
    const n = Number(f.value);
    return Number.isFinite(n) && Math.abs(n) < 1e15 && !f.value.includes(".") ? n.toLocaleString("ja-JP") : f.value;
  }
  return f.value;
}

/** 表示する項目（値のあるものだけ） */
export function visibleCustomFields(fields: CustomField[] | null | undefined): CustomField[] {
  return (fields ?? []).filter((f) => f.value);
}
