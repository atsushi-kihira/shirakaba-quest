// =============================================================
// 書式つきの説明（見たまま編集）の、安全な保存形式
//   ・エディタ（Tiptap / ProseMirror）の JSON を、そのまま信用せず、許可した種類だけで作り直して保存する
//     （HTML は保存しない。未知の種類・属性・不正な色やリンクは、取り除く）
//   ・メール・通知・Googleカレンダー用に、文章だけの版（plain）も、ここで作る
//   ・文章の中に差し込んだ画像（添付IDで参照）の一覧も返す
// 使える書式：太字・斜体・下線・取り消し線・文字の大きさ（小/大/特大）・文字の色・リンク・見出し・箇条書き・番号付き（入れ子可）・インデント・画像（大きさ・位置）
// =============================================================

export type RichDoc = { type: "doc"; content: RichNode[] };
type RichMark = { type: string; attrs?: Record<string, string> };
export type RichNode = {
  type: string;
  attrs?: Record<string, string | number>;
  content?: RichNode[];
  text?: string;
  marks?: RichMark[];
};

export type SanitizedDoc = { doc: RichDoc; plain: string; imageIds: string[] };

const MAX_JSON_BYTES = 120_000;
const MAX_NODES = 5000;
const MAX_DEPTH = 14;
const MAX_INDENT = 5;
const MAX_PLAIN = 8000;
const MAX_IMAGES = 20;

const FONT_SIZES = new Set(["0.85em", "1.25em", "1.6em"]);
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const HREF_RE = /^(https?:\/\/|mailto:)[^\s<>"']+$/i;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const ALIGNS = new Set(["left", "center", "right"]);

type Ctx = { nodes: number; imageIds: string[]; error: string };

function cleanMarks(raw: unknown): RichMark[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: RichMark[] = [];
  for (const m of raw as Array<{ type?: unknown; attrs?: Record<string, unknown> }>) {
    if (!m || typeof m.type !== "string") continue;
    switch (m.type) {
      case "bold": case "italic": case "underline": case "strike":
        out.push({ type: m.type });
        break;
      case "link": {
        const href = typeof m.attrs?.href === "string" ? m.attrs.href.trim() : "";
        if (HREF_RE.test(href) && href.length <= 2000) out.push({ type: "link", attrs: { href } });
        break;
      }
      case "textStyle": {
        const attrs: Record<string, string> = {};
        const color = m.attrs?.color;
        if (typeof color === "string" && COLOR_RE.test(color)) attrs.color = color.toLowerCase();
        const size = m.attrs?.fontSize;
        if (typeof size === "string" && FONT_SIZES.has(size)) attrs.fontSize = size;
        if (Object.keys(attrs).length > 0) out.push({ type: "textStyle", attrs });
        break;
      }
      // ほかの種類は、取り除く
    }
  }
  return out.length > 0 ? out : undefined;
}

/** インデント（字下げ）の段数。0〜MAX_INDENT の整数 */
function cleanIndent(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(MAX_INDENT, Math.max(0, n)) : 0;
}

function cleanNode(raw: unknown, depth: number, ctx: Ctx): RichNode | null {
  if (ctx.error) return null;
  if (!raw || typeof raw !== "object") return null;
  const n = raw as { type?: unknown; attrs?: Record<string, unknown>; content?: unknown; text?: unknown; marks?: unknown };
  if (typeof n.type !== "string") return null;
  if (depth > MAX_DEPTH) { ctx.error = "説明の入れ子が深すぎます"; return null; }
  if (++ctx.nodes > MAX_NODES) { ctx.error = "説明が長すぎます"; return null; }

  const children = (): RichNode[] => {
    if (!Array.isArray(n.content)) return [];
    const out: RichNode[] = [];
    for (const c of n.content) {
      const cn = cleanNode(c, depth + 1, ctx);
      if (cn) out.push(cn);
    }
    return out;
  };

  switch (n.type) {
    case "text": {
      if (typeof n.text !== "string" || n.text === "") return null;
      const marks = cleanMarks(n.marks);
      return { type: "text", text: n.text, ...(marks && { marks }) };
    }
    case "hardBreak":
      return { type: "hardBreak" };
    case "paragraph": {
      const c = children();
      const indent = cleanIndent(n.attrs?.indent);
      return { type: "paragraph", ...(indent > 0 && { attrs: { indent } }), ...(c.length > 0 && { content: c }) };
    }
    case "heading": {
      const level = n.attrs?.level === 3 ? 3 : 2;
      const c = children();
      const indent = cleanIndent(n.attrs?.indent);
      return { type: "heading", attrs: { level, ...(indent > 0 && { indent }) }, ...(c.length > 0 && { content: c }) };
    }
    case "bulletList": case "orderedList": case "listItem": {
      const c = children();
      if (c.length === 0) return null;
      return { type: n.type, content: c };
    }
    case "image": {
      const id = n.attrs?.attachmentId;
      if (typeof id !== "string" || !ID_RE.test(id)) return null;
      if (ctx.imageIds.length >= MAX_IMAGES) { ctx.error = `説明に入れられる画像は${MAX_IMAGES}枚までです`; return null; }
      ctx.imageIds.push(id);
      const w = Number(n.attrs?.width);
      const width = Number.isFinite(w) ? Math.min(100, Math.max(5, Math.round(w))) : 60;
      const align = typeof n.attrs?.align === "string" && ALIGNS.has(n.attrs.align) ? n.attrs.align : "left";
      return { type: "image", attrs: { attachmentId: id, width, align } };
    }
    default:
      return null; // 未知の種類は、取り除く
  }
}

function inlinePlain(nodes: RichNode[] | undefined): string {
  let s = "";
  for (const n of nodes ?? []) {
    if (n.type === "hardBreak") { s += "\n"; continue; }
    if (n.type !== "text" || !n.text) continue;
    const href = n.marks?.find((m) => m.type === "link")?.attrs?.href;
    s += href && !n.text.includes(href) ? `${n.text}（${href}）` : n.text;
  }
  return s;
}

/** 段落・見出し・一覧を、文章だけの版にする。字下げ・入れ子の一覧は、全角スペースで表す */
function blockPlain(node: RichNode, out: string[], depth = 0, lead = ""): void {
  const pad = "　".repeat(depth);
  switch (node.type) {
    case "paragraph": case "heading": {
      const indent = Number(node.attrs?.indent) || 0;
      out.push(pad + "　".repeat(indent) + lead + inlinePlain(node.content));
      break;
    }
    case "bulletList": case "orderedList": {
      let i = 0;
      for (const li of node.content ?? []) {
        i++;
        const prefix = node.type === "bulletList" ? "・" : `${i}. `;
        let first = true;
        for (const child of li.content ?? []) {
          if (child.type === "bulletList" || child.type === "orderedList") { blockPlain(child, out, depth + 1); continue; }
          blockPlain(child, out, depth, first ? prefix : "　");
          first = false;
        }
      }
      break;
    }
    default:
      break; // 画像は、文章だけの版には入れない
  }
}

/**
 * エディタから届いた JSON を検証して、安全な形に作り直す。
 * 中身が空（文字も画像もない）なら、value は null。
 */
export function sanitizeRichDoc(input: unknown): { ok: true; value: SanitizedDoc | null } | { ok: false; message: string } {
  if (input == null) return { ok: true, value: null };
  let bytes = 0;
  try { bytes = JSON.stringify(input).length; } catch { return { ok: false, message: "説明の形式が正しくありません" }; }
  if (bytes > MAX_JSON_BYTES) return { ok: false, message: "説明が長すぎます。画像の数や文章を減らしてください" };
  const root = input as { type?: unknown; content?: unknown };
  if (root.type !== "doc" || !Array.isArray(root.content)) return { ok: false, message: "説明の形式が正しくありません" };

  const ctx: Ctx = { nodes: 0, imageIds: [], error: "" };
  const content: RichNode[] = [];
  for (const c of root.content) {
    const cn = cleanNode(c, 1, ctx);
    if (cn) content.push(cn);
  }
  if (ctx.error) return { ok: false, message: ctx.error };

  const lines: string[] = [];
  for (const b of content) blockPlain(b, lines);
  const plain = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_PLAIN);
  if (!plain && ctx.imageIds.length === 0) return { ok: true, value: null };
  return { ok: true, value: { doc: { type: "doc", content }, plain, imageIds: ctx.imageIds } };
}

/** 保存してある JSON 文字列を、返す形にする（壊れていれば null） */
export function parseStoredDoc(json: string | null | undefined): RichDoc | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as RichDoc;
    return v && v.type === "doc" && Array.isArray(v.content) ? v : null;
  } catch {
    return null;
  }
}

export type DescriptionInput = { description?: string; descriptionDoc?: unknown };

/**
 * 画面から届いた説明を、保存する形にする。
 *  ・descriptionDoc（書式つき）があれば、それを検証して、文章だけの版（plain）も作る
 *  ・なければ、従来どおりの文章（description）だけ
 */
export function resolveDescriptionInput(body: DescriptionInput):
  | { ok: true; plain: string | null; docJson: string | null; imageIds: string[] }
  | { ok: false; message: string } {
  if (body.descriptionDoc !== undefined) {
    const r = sanitizeRichDoc(body.descriptionDoc);
    if (!r.ok) return r;
    if (!r.value) return { ok: true, plain: null, docJson: null, imageIds: [] };
    return { ok: true, plain: r.value.plain || null, docJson: JSON.stringify(r.value.doc), imageIds: r.value.imageIds };
  }
  const plain = typeof body.description === "string" ? body.description.trim() : "";
  return { ok: true, plain: plain || null, docJson: null, imageIds: [] };
}
