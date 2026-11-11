// =============================================================
// 書式つきの説明の表示（読むだけ）
//   保存してある内容（JSON）を、そのまま画面に並べる。HTML は使わないので、安全に表示できる。
//   画像は、ログイン中の人だけが見られるので、アプリ経由で読み込む。タップで大きく表示する。
// =============================================================
import { useState, type CSSProperties, type ReactNode } from "react";
import { AttachmentImage, Lightbox } from "@/components/attachment-gallery";
import type { RichDoc, RichMark, RichNode } from "@/lib/rich-doc";

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const SAFE_COLOR = /^#[0-9a-fA-F]{6}$/;
const SAFE_SIZE = new Set(["0.85em", "1.25em", "1.6em"]);

function renderMarks(text: string, marks: RichMark[] | undefined, key: string): ReactNode {
  let node: ReactNode = text;
  for (const m of marks ?? []) {
    switch (m.type) {
      case "bold": node = <strong>{node}</strong>; break;
      case "italic": node = <em>{node}</em>; break;
      case "underline": node = <u>{node}</u>; break;
      case "strike": node = <s>{node}</s>; break;
      case "link": {
        const href = m.attrs?.href;
        if (typeof href === "string" && SAFE_HREF.test(href)) node = <a href={href} target="_blank" rel="noopener noreferrer nofollow">{node}</a>;
        break;
      }
      case "textStyle": {
        const style: CSSProperties = {};
        const color = m.attrs?.color;
        const size = m.attrs?.fontSize;
        if (typeof color === "string" && SAFE_COLOR.test(color)) style.color = color;
        if (typeof size === "string" && SAFE_SIZE.has(size)) style.fontSize = size;
        if (style.color || style.fontSize) node = <span style={style}>{node}</span>;
        break;
      }
    }
  }
  return <span key={key}>{node}</span>;
}

function Inline({ nodes, k }: { nodes: RichNode[] | undefined; k: string }) {
  return <>{(nodes ?? []).map((n, i) =>
    n.type === "hardBreak" ? <br key={`${k}${i}`} /> : n.type === "text" ? renderMarks(n.text ?? "", n.marks, `${k}${i}`) : null
  )}</>;
}

/** 字下げ（段落・見出し）。サーバー側と同じく、1段 = 1.5em、最大5段 */
function indentStyle(node: RichNode): CSSProperties | undefined {
  const n = Math.min(5, Math.max(0, Math.round(Number(node.attrs?.indent) || 0)));
  return n > 0 ? { paddingLeft: `${n * 1.5}em` } : undefined;
}

function Block({ node, k, onImage }: { node: RichNode; k: string; onImage: (id: string) => void }) {
  switch (node.type) {
    case "paragraph": return <p style={indentStyle(node)}><Inline nodes={node.content} k={k} /></p>;
    case "heading": return node.attrs?.level === 3 ? <h3 style={indentStyle(node)}><Inline nodes={node.content} k={k} /></h3> : <h2 style={indentStyle(node)}><Inline nodes={node.content} k={k} /></h2>;
    case "bulletList": return <ul>{(node.content ?? []).map((li, i) => <Block key={i} node={li} k={`${k}${i}`} onImage={onImage} />)}</ul>;
    case "orderedList": return <ol>{(node.content ?? []).map((li, i) => <Block key={i} node={li} k={`${k}${i}`} onImage={onImage} />)}</ol>;
    case "listItem": return <li>{(node.content ?? []).map((c, i) => <Block key={i} node={c} k={`${k}${i}`} onImage={onImage} />)}</li>;
    case "image": {
      const id = node.attrs?.attachmentId;
      if (typeof id !== "string") return null;
      const width = Math.min(100, Math.max(5, Number(node.attrs?.width) || 60));
      const align = node.attrs?.align;
      return (
        <div className="my-2 flex" style={{ justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start" }}>
          <button type="button" onClick={() => onImage(id)} aria-label="画像を大きく表示" className="block max-w-full" style={{ width: `${width}%` }}>
            <AttachmentImage id={id} alt="" className="w-full h-auto rounded-xl cursor-zoom-in" style={{ border: "1px solid var(--color-paper-300)" }} />
          </button>
        </div>
      );
    }
    default: return null;
  }
}

export function RichTextView({ doc, className }: { doc: RichDoc; className?: string }) {
  const [openImage, setOpenImage] = useState<string | null>(null);
  return (
    <div className={`rich-body ${className ?? ""}`}>
      {doc.content.map((n, i) => <Block key={i} node={n} k={`b${i}-`} onImage={setOpenImage} />)}
      {openImage && (
        <Lightbox
          attachment={{ id: openImage, name: "説明の画像", contentType: "image/*", sizeBytes: 0, isImage: true }}
          onClose={() => setOpenImage(null)}
        />
      )}
    </div>
  );
}
