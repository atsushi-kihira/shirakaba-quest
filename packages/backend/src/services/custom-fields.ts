// =============================================================
// ミーティング・定例会に、主催者が追加する入力項目（最大10個）
//   項目の種類は、テキスト・数値・日付。ラベル（項目名）と値を持つ。
//   例：セミナーの「講師」（テキスト）、「定員」（数値）、「申込締切」（日付）
// =============================================================

export type CustomFieldType = "text" | "number" | "date";
export type CustomField = { id: string; label: string; type: CustomFieldType; value: string };

export const MAX_CUSTOM_FIELDS = 10;
const MAX_LABEL = 30;
const MAX_TEXT = 500;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * 画面から届いた項目を検証して、保存する形にする。
 * 値は空でもよい（空の項目は、表示しない）。項目が1つもなければ、value は null。
 */
export function parseCustomFields(input: unknown): { ok: true; value: CustomField[] | null; json: string | null } | { ok: false; message: string } {
  if (input == null) return { ok: true, value: null, json: null };
  if (!Array.isArray(input)) return { ok: false, message: "追加項目の形式が正しくありません" };
  if (input.length > MAX_CUSTOM_FIELDS) return { ok: false, message: `追加できる項目は${MAX_CUSTOM_FIELDS}個までです` };

  const out: CustomField[] = [];
  const usedIds = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const raw = input[i] as { id?: unknown; label?: unknown; type?: unknown; value?: unknown } | null;
    const n = i + 1;
    const label = typeof raw?.label === "string" ? raw.label.trim() : "";
    if (!label) return { ok: false, message: `${n}つ目の追加項目に、ラベル（項目名）を入力してください` };
    if (label.length > MAX_LABEL) return { ok: false, message: `${n}つ目の追加項目のラベルは、${MAX_LABEL}文字までです` };
    const type = raw?.type;
    if (type !== "text" && type !== "number" && type !== "date") return { ok: false, message: `${n}つ目の追加項目の種類（テキスト・数値・日付）を選んでください` };

    let value = typeof raw?.value === "string" ? raw.value.trim() : raw?.value == null ? "" : String(raw.value).trim();
    if (value) {
      if (type === "text" && value.length > MAX_TEXT) return { ok: false, message: `「${label}」は、${MAX_TEXT}文字までです` };
      if (type === "number") {
        // 全角の数字・記号は、半角にそろえる
        value = value.replace(/[０-９．－，]/g, (c) => ({ "．": ".", "－": "-", "，": "," }[c] ?? String.fromCharCode(c.charCodeAt(0) - 0xfee0))).replace(/,/g, "");
        if (!/^-?\d+(\.\d+)?$/.test(value) || value.length > 18) return { ok: false, message: `「${label}」は、数値で入力してください` };
      }
      if (type === "date" && !validDate(value)) return { ok: false, message: `「${label}」の日付が正しくありません` };
    }
    let id = typeof raw?.id === "string" && ID_RE.test(raw.id) ? raw.id : `f${n}`;
    while (usedIds.has(id)) id = `${id}_`;
    usedIds.add(id);
    out.push({ id, label, type, value });
  }
  return out.length === 0 ? { ok: true, value: null, json: null } : { ok: true, value: out, json: JSON.stringify(out) };
}

/** 保存してある JSON 文字列を、返す形にする（壊れていれば空） */
export function parseStoredCustomFields(json: string | null | undefined): CustomField[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as CustomField[];
    return Array.isArray(v) ? v.filter((f) => f && typeof f.label === "string" && (f.type === "text" || f.type === "number" || f.type === "date")) : [];
  } catch {
    return [];
  }
}

/** メール・通知の本文に添える行（値のある項目だけ）。例：「講師：山田太郎」 */
export function customFieldsLines(fields: CustomField[] | null | undefined): string {
  return (fields ?? []).filter((f) => f.value).map((f) => `${f.label}：${f.type === "date" ? f.value.replaceAll("-", "/") : f.value}`).join("\n");
}

/** メール用の説明に、追加項目の行を足す */
export function withCustomFieldLines(description: string | null | undefined, fields: CustomField[] | null | undefined): string {
  const lines = customFieldsLines(fields);
  const base = (description ?? "").trim();
  return lines ? (base ? `${base}\n\n${lines}` : lines) : base;
}
