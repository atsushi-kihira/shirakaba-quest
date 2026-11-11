// =============================================================
// 書式つきの説明（見たまま編集）の、共通の型と部品
//   ・保存するのは、エディタ（Tiptap）の内容を表す JSON（HTML ではない）。サーバーが、許可した書式だけに整えて保存する
//   ・使える書式は、backend/src/services/rich-doc.ts と同じ（ここを増やすときは、サーバー側も合わせる）
// =============================================================

export type RichMark = { type: string; attrs?: Record<string, string | null> };
export type RichNode = {
  type: string;
  attrs?: Record<string, string | number | null>;
  content?: RichNode[];
  text?: string;
  marks?: RichMark[];
};
export type RichDoc = { type: "doc"; content: RichNode[] };

/** 文字の大きさ（「中」は、ふつうの大きさ） */
export const FONT_SIZES = [
  { key: "small", label: "小", value: "0.85em" },
  { key: "normal", label: "中", value: null },
  { key: "large", label: "大", value: "1.25em" },
  { key: "xlarge", label: "特大", value: "1.6em" },
] as const;

/** 文字の色（サーバー側は「#rrggbb」なら受け付ける。ここは選びやすい色だけ並べる） */
export const TEXT_COLORS = [
  { label: "ふつう", value: null },
  { label: "ローズ", value: "#b5384b" },
  { label: "オレンジ", value: "#d9822b" },
  { label: "ゴールド", value: "#b8860b" },
  { label: "グリーン", value: "#3f7d4a" },
  { label: "ブルー", value: "#3f6fa6" },
  { label: "パープル", value: "#7a4f9e" },
  { label: "グレー", value: "#7a7268" },
] as const;

/** 画像の大きさ（説明の幅に対する%）。ドラッグでも、自由に変えられる */
export const IMAGE_WIDTH_PRESETS = [
  { label: "小", value: 25 },
  { label: "中", value: 50 },
  { label: "大", value: 75 },
  { label: "最大", value: 100 },
] as const;

export type ImageAlign = "left" | "center" | "right";

const URL_RE = /(https?:\/\/[^\s<>"'、。）)]+)/g;

/** 1行の文章を、URLをリンクにした文字の並びにする */
function lineToText(line: string): RichNode[] {
  return line.split(URL_RE).filter(Boolean).map((part) =>
    /^https?:\/\//.test(part)
      ? { type: "text", text: part, marks: [{ type: "link", attrs: { href: part } }] }
      : { type: "text", text: part }
  );
}

/** これまでの文章だけの説明を、編集・表示できる形（改行ごとの段落。URLはリンク）にする */
export function plainToDoc(text: string | null | undefined): RichDoc {
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  const content: RichNode[] = lines.map((line) => (line ? { type: "paragraph", content: lineToText(line) } : { type: "paragraph" }));
  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}

/** 説明に差し込まれている画像（添付ID）の一覧 */
export function docImageIds(doc: RichDoc | null | undefined): string[] {
  const ids: string[] = [];
  const walk = (nodes: RichNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === "image" && typeof n.attrs?.attachmentId === "string") ids.push(n.attrs.attachmentId);
      walk(n.content);
    }
  };
  walk(doc?.content);
  return ids;
}

/** 文字も画像もない、空の説明か */
export function docIsEmpty(doc: RichDoc | null | undefined): boolean {
  if (!doc) return true;
  let found = false;
  const walk = (nodes: RichNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === "image" || (n.type === "text" && (n.text ?? "").trim() !== "")) found = true;
      walk(n.content);
    }
  };
  walk(doc.content);
  return !found;
}

/** 表示・編集に使う説明：書式つきがあればそれ、なければ文章だけの説明から作る（どちらも無ければ null） */
export function effectiveDoc(doc: RichDoc | null | undefined, plain: string | null | undefined): RichDoc | null {
  if (doc && !docIsEmpty(doc)) return doc;
  return plain && plain.trim() ? plainToDoc(plain) : null;
}

/** 説明（書式つき・文章だけ）か、添付が、なにかあるか */
export function hasDescription(doc: RichDoc | null | undefined, plain: string | null | undefined, attachments: unknown[]): boolean {
  return effectiveDoc(doc, plain) !== null || attachments.length > 0;
}
