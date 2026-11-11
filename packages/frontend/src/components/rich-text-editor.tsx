// =============================================================
// 説明の「見たまま編集」エディタ（Tiptap）
//   ・できる書式：太字・斜体・下線・文字の大きさ（小/中/大/特大）・文字の色・見出し・箇条書き・番号付き・リンク
//   ・画像：好きな場所に差し込める。クリックすると、大きさ（ドラッグ／小・中・大・最大）と位置（左・中央・右）を変えられる
//     画像は「写真を入れる」ボタン、ドラッグ＆ドロップ、コピーした画像の貼り付けで入れられる
//   ・編集欄は、右下をドラッグして、自由に広げられる
// 保存する形は、書式を表す JSON（サーバーで、許可した書式だけに整えて保存）。
// =============================================================
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { EditorContent, Extension, NodeViewWrapper, ReactNodeViewRenderer, mergeAttributes, useEditor, useEditorState, Node, type Editor, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { AlignCenter, AlignLeft, AlignRight, Bold, Heading2, ImagePlus, IndentDecrease, IndentIncrease, Italic, Link2, List, ListOrdered, Loader2, Redo2, Trash2, Underline as UnderlineIcon, Undo2 } from "lucide-react";
import { AttachmentImage } from "@/components/attachment-gallery";
import { uploadAttachment, type AttachmentOwner } from "@/lib/attachments";
import { FONT_SIZES, IMAGE_WIDTH_PRESETS, TEXT_COLORS, docImageIds, type ImageAlign, type RichDoc } from "@/lib/rich-doc";

const MAX_INLINE_IMAGES = 20;
const MAX_INDENT = 5; // 字下げの段数（1段 = 全角1.5文字ぶん）。サーバー側（rich-doc.ts）と同じ
const IMAGE_ACCEPT = ".jpg,.jpeg,.png,.gif,.webp";
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ---------------------------------------------------------------
// インデント（字下げ）
//   ・段落・見出し：字下げの段数（0〜5）を持たせる
//   ・箇条書き・番号付きの中：一覧の入れ子（1段深く／浅く）にする
// ---------------------------------------------------------------
function changeIndent(editor: Editor, delta: 1 | -1): boolean {
  if (editor.isActive("listItem")) {
    return delta > 0 ? editor.chain().focus().sinkListItem("listItem").run() : editor.chain().focus().liftListItem("listItem").run();
  }
  const type = editor.isActive("heading") ? "heading" : "paragraph";
  const current = Number(editor.getAttributes(type).indent) || 0;
  const next = Math.min(MAX_INDENT, Math.max(0, current + delta));
  if (next === current) return false;
  return editor.chain().focus().updateAttributes(type, { indent: next }).run();
}

const Indent = Extension.create({
  name: "indent",
  addGlobalAttributes() {
    return [{
      types: ["paragraph", "heading"],
      attributes: {
        indent: {
          default: 0,
          parseHTML: (el) => Math.min(MAX_INDENT, Number(el.getAttribute("data-indent")) || 0),
          renderHTML: (a) => (a.indent ? { "data-indent": a.indent, style: `padding-left: ${Number(a.indent) * 1.5}em` } : {}),
        },
      },
    }];
  },
  addKeyboardShortcuts() {
    return {
      "Mod-]": () => changeIndent(this.editor, 1),
      "Mod-[": () => changeIndent(this.editor, -1),
    };
  },
});

// ---------------------------------------------------------------
// 画像（添付IDで参照する）。大きさ（説明の幅に対する%）と位置を持つ
// ---------------------------------------------------------------
function ImageNodeView({ node, selected, updateAttributes, deleteNode, editor }: NodeViewProps) {
  const id = String(node.attrs.attachmentId ?? "");
  const width = clamp(Number(node.attrs.width) || 60, 5, 100);
  const align = (node.attrs.align as ImageAlign) || "left";
  const editable = editor.isEditable;
  const boxRef = useRef<HTMLDivElement>(null);

  // 角のつまみをドラッグして、大きさを変える（位置が「中央」のときは、左右に同じだけ広がるので、動かした距離の2倍）
  function startResize(e: ReactPointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const container = boxRef.current?.parentElement;
    if (!container) return;
    const containerWidth = container.clientWidth || 1;
    const startX = e.clientX;
    const startWidth = width;
    const factor = (align === "center" ? 2 : 1) * (align === "right" ? -1 : 1);
    const move = (ev: PointerEvent) => {
      updateAttributes({ width: clamp(Math.round(startWidth + ((ev.clientX - startX) / containerWidth) * 100 * factor), 5, 100) });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const barBtn = (active: boolean): React.CSSProperties => ({
    background: active ? "var(--color-brand)" : "var(--color-paper-50)",
    color: active ? "white" : "var(--color-ink-700)",
    border: "1px solid var(--color-paper-300)",
  });

  return (
    <NodeViewWrapper className="my-2" data-drag-handle="">
      <div className="flex" style={{ justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start" }}>
        <div ref={boxRef} className="rte-image-box relative max-w-full" style={{ width: `${width}%` }}>
          <AttachmentImage id={id} alt="" className="w-full h-auto rounded-xl block" style={{ border: "1px solid var(--color-paper-300)" }} />
          {editable && selected && (
            <>
              <div
                className="absolute left-1 top-1 z-10 flex flex-wrap items-center gap-1 p-1 rounded-xl shadow"
                style={{ background: "var(--color-paper-100)", border: "1px solid var(--color-paper-300)" }}
                onMouseDown={(e) => e.preventDefault()}
              >
                {IMAGE_WIDTH_PRESETS.map((p) => (
                  <button key={p.value} type="button" onClick={() => updateAttributes({ width: p.value })}
                    className="px-2 py-1 rounded-lg text-[11px] font-medium" style={barBtn(width === p.value)}>{p.label}</button>
                ))}
                <span className="w-px h-4 mx-0.5" style={{ background: "var(--color-paper-300)" }} />
                {([["left", AlignLeft, "左"], ["center", AlignCenter, "中央"], ["right", AlignRight, "右"]] as const).map(([a, Icon, label]) => (
                  <button key={a} type="button" aria-label={`画像を${label}にそろえる`} onClick={() => updateAttributes({ align: a })}
                    className="p-1 rounded-lg" style={barBtn(align === a)}><Icon size={14} /></button>
                ))}
                <span className="w-px h-4 mx-0.5" style={{ background: "var(--color-paper-300)" }} />
                <button type="button" aria-label="この画像を消す" onClick={() => deleteNode()}
                  className="p-1 rounded-lg" style={{ ...barBtn(false), color: "var(--color-brand)" }}><Trash2 size={14} /></button>
              </div>
              <div
                role="presentation"
                onPointerDown={startResize}
                title="ドラッグして大きさを変える"
                className="absolute w-5 h-5 rounded-full z-10"
                style={{
                  bottom: -8, ...(align === "right" ? { left: -8 } : { right: -8 }),
                  background: "var(--color-brand)", border: "2px solid white", cursor: align === "right" ? "nesw-resize" : "nwse-resize", touchAction: "none",
                }}
              />
              <p className="absolute left-0 -bottom-5 text-[10px]" style={{ color: "var(--color-ink-400)" }}>{width}%</p>
            </>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

const RichImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      attachmentId: { default: null, parseHTML: (el) => el.getAttribute("data-attachment-id"), renderHTML: (a) => ({ "data-attachment-id": a.attachmentId }) },
      width: { default: 60, parseHTML: (el) => Number(el.getAttribute("data-width")) || 60, renderHTML: (a) => ({ "data-width": a.width }) },
      align: { default: "left", parseHTML: (el) => el.getAttribute("data-align") || "left", renderHTML: (a) => ({ "data-align": a.align }) },
    };
  },
  parseHTML() { return [{ tag: "img[data-attachment-id]" }]; },
  renderHTML({ HTMLAttributes }) { return ["img", mergeAttributes(HTMLAttributes)]; },
  addNodeView() { return ReactNodeViewRenderer(ImageNodeView); },
});

// ---------------------------------------------------------------
// エディタ本体
// ---------------------------------------------------------------
type Props = {
  doc: RichDoc;
  onChange: (doc: RichDoc) => void;
  placeholder?: string;
  /** 画像の保存先の会（すでにある会を編集するとき）。なければ、アップロードだけしておき、会を作るときに結びつける */
  owner?: AttachmentOwner;
  onBusyChange?: (busy: boolean) => void;
  expanded?: boolean;
};

function ToolBtn({ label, active, disabled, onClick, children, wide }: {
  label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode; wide?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // 文字の選択を外さない
      onClick={onClick}
      className={`h-8 ${wide ? "px-2.5" : "w-8"} rounded-lg flex items-center justify-center text-xs font-medium transition disabled:opacity-40`}
      style={{
        background: active ? "var(--color-brand)" : "transparent",
        color: active ? "white" : "var(--color-ink-700)",
      }}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="w-px h-5 mx-0.5 shrink-0" style={{ background: "var(--color-paper-300)" }} />;

export function RichTextEditor({ doc, onChange, placeholder, owner, onBusyChange, expanded }: Props) {
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<"color" | "link" | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const imageInput = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<(files: File[]) => void>(() => {});

  useEffect(() => { onBusyChange?.(uploading > 0); }, [uploading, onBusyChange]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false, codeBlock: false, blockquote: false, horizontalRule: false,
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer nofollow" } },
      }),
      TextStyle, Color, FontSize, Indent,
      RichImage,
    ],
    content: doc,
    onUpdate: ({ editor: ed }) => onChange(ed.getJSON() as RichDoc),
    editorProps: {
      attributes: { class: "rich-body" },
      // コピーした画像・ドラッグした画像は、説明の中に差し込む
      handlePaste: (_view, event) => {
        const imgs = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (imgs.length === 0) return false;
        event.preventDefault();
        uploadRef.current(imgs);
        return true;
      },
      handleDrop: (_view, event) => {
        const imgs = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (imgs.length === 0) return false;
        event.preventDefault();
        uploadRef.current(imgs);
        return true;
      },
    },
  });

  const uploadImages = useCallback(async (files: File[]) => {
    if (!editor) return;
    setError("");
    for (const f of files) {
      if (docImageIds(editor.getJSON() as RichDoc).length >= MAX_INLINE_IMAGES) { setError(`説明に入れられる画像は${MAX_INLINE_IMAGES}枚までです`); break; }
      setUploading((n) => n + 1);
      try {
        const a = await uploadAttachment(f, owner, { inline: true });
        // 選んでいる文字があっても上書きせず、その後ろに差し込む
        const at = editor.state.selection.to;
        editor.chain().focus().insertContentAt(at, { type: "image", attrs: { attachmentId: a.id, width: 60, align: "left" } }).run();
      } catch (e) {
        setError(e instanceof Error ? e.message : "画像を入れられませんでした。もう一度お試しください");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }, [editor, owner]);
  useEffect(() => { uploadRef.current = (files) => { void uploadImages(files); }; }, [uploadImages]);

  const st = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      bold: ed?.isActive("bold") ?? false,
      italic: ed?.isActive("italic") ?? false,
      underline: ed?.isActive("underline") ?? false,
      h2: ed?.isActive("heading", { level: 2 }) ?? false,
      ul: ed?.isActive("bulletList") ?? false,
      ol: ed?.isActive("orderedList") ?? false,
      link: ed?.isActive("link") ?? false,
      fontSize: (ed?.getAttributes("textStyle").fontSize as string | null | undefined) ?? null,
      color: (ed?.getAttributes("textStyle").color as string | null | undefined) ?? null,
      empty: ed?.isEmpty ?? true,
      indent: Number(ed?.getAttributes(ed.isActive("heading") ? "heading" : "paragraph").indent) || 0,
      inList: ed?.isActive("listItem") ?? false,
      canUndo: ed?.can().undo() ?? false,
      canRedo: ed?.can().redo() ?? false,
    }),
  });

  if (!editor) return null;
  // 操作は、ボタンを押した瞬間に作る（描画のたびに作ると、focus() がエディタにフォーカスを移してしまう。選択範囲も古くなる）
  const run = () => editor.chain().focus();

  function applyLink() {
    const url = linkUrl.trim();
    if (!url) { editor?.chain().focus().extendMarkRange("link").unsetLink().run(); setMenu(null); return; }
    const href = /^(https?:\/\/|mailto:)/i.test(url) ? url : `https://${url}`;
    if (editor?.state.selection.empty && !editor.isActive("link")) {
      editor.chain().focus().insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    } else {
      editor?.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    setMenu(null);
    setLinkUrl("");
  }

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}>
      {/* ツールバー */}
      <div className="flex flex-wrap items-center gap-0.5 px-1.5 py-1 border-b" style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-100)" }}>
        <ToolBtn label="太字" active={st.bold} onClick={() => run().toggleBold().run()}><Bold size={15} /></ToolBtn>
        <ToolBtn label="斜体" active={st.italic} onClick={() => run().toggleItalic().run()}><Italic size={15} /></ToolBtn>
        <ToolBtn label="下線" active={st.underline} onClick={() => run().toggleUnderline().run()}><UnderlineIcon size={15} /></ToolBtn>
        <Divider />
        {FONT_SIZES.map((f) => (
          <ToolBtn key={f.key} wide label={`文字の大きさ：${f.label}`} active={(st.fontSize ?? null) === f.value}
            onClick={() => (f.value ? run().setFontSize(f.value).run() : run().unsetFontSize().run())}>{f.label}</ToolBtn>
        ))}
        <Divider />
        <div className="relative">
          <ToolBtn label="文字の色" active={menu === "color"} onClick={() => setMenu(menu === "color" ? null : "color")}>
            <span className="flex flex-col items-center leading-none">
              <span className="text-sm font-bold">A</span>
              <span className="w-4 h-1 rounded-sm mt-0.5" style={{ background: st.color ?? "var(--color-ink-700)" }} />
            </span>
          </ToolBtn>
          {menu === "color" && (
            <div className="absolute left-0 top-9 z-20 p-2 rounded-xl shadow-lg grid grid-cols-4 gap-1.5 w-44"
              style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}>
              {TEXT_COLORS.map((c) => (
                <button key={c.label} type="button" title={c.label} aria-label={`文字の色：${c.label}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { if (c.value) run().setColor(c.value).run(); else run().unsetColor().run(); setMenu(null); }}
                  className="h-9 rounded-lg flex items-center justify-center text-sm font-bold"
                  style={{ background: "var(--color-paper-100)", color: c.value ?? "var(--color-ink-700)", border: st.color === c.value ? "2px solid var(--color-brand)" : "1px solid var(--color-paper-300)" }}>
                  A
                </button>
              ))}
              <p className="col-span-4 text-[10px] text-center" style={{ color: "var(--color-ink-400)" }}>左上は、ふつうの色にもどします</p>
            </div>
          )}
        </div>
        <Divider />
        <ToolBtn label="見出し" active={st.h2} onClick={() => run().toggleHeading({ level: 2 }).run()}><Heading2 size={16} /></ToolBtn>
        <ToolBtn label="字下げを増やす（インデント）" disabled={!st.inList && st.indent >= MAX_INDENT} onClick={() => changeIndent(editor, 1)}><IndentIncrease size={16} /></ToolBtn>
        <ToolBtn label="字下げを減らす" disabled={!st.inList && st.indent <= 0} onClick={() => changeIndent(editor, -1)}><IndentDecrease size={16} /></ToolBtn>
        <ToolBtn label="箇条書き" active={st.ul} onClick={() => run().toggleBulletList().run()}><List size={16} /></ToolBtn>
        <ToolBtn label="番号付きの箇条書き" active={st.ol} onClick={() => run().toggleOrderedList().run()}><ListOrdered size={16} /></ToolBtn>
        <div className="relative">
          <ToolBtn label="リンク" active={st.link || menu === "link"}
            onClick={() => { setLinkUrl((editor.getAttributes("link").href as string | undefined) ?? ""); setMenu(menu === "link" ? null : "link"); }}>
            <Link2 size={15} />
          </ToolBtn>
          {menu === "link" && (
            <div className="absolute left-0 top-9 z-20 p-2 rounded-xl shadow-lg w-64 space-y-1.5"
              style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}>
              <p className="text-[11px]" style={{ color: "var(--color-ink-500)" }}>リンク先のURL（文字を選んでから押すと、その文字がリンクになります）</p>
              <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://example.com" autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } }}
                className="w-full px-2.5 py-2 rounded-lg text-sm outline-none border"
                style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
              <div className="flex gap-1.5">
                <button type="button" onClick={applyLink} className="flex-1 py-1.5 rounded-lg text-xs font-medium text-white" style={{ background: "var(--color-brand)" }}>
                  {st.link ? "変更する" : "つける"}
                </button>
                {st.link && (
                  <button type="button" onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); setMenu(null); }}
                    className="px-3 py-1.5 rounded-lg text-xs" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>はずす</button>
                )}
              </div>
            </div>
          )}
        </div>
        <Divider />
        <ToolBtn label="写真を入れる" wide disabled={uploading > 0} onClick={() => imageInput.current?.click()}>
          {uploading > 0 ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
          <span className="ml-1">写真</span>
        </ToolBtn>
        <input ref={imageInput} type="file" accept={IMAGE_ACCEPT} multiple className="hidden"
          onChange={(e) => { const picked = Array.from(e.target.files ?? []); e.target.value = ""; void uploadImages(picked); }} />
        <span className="flex-1" />
        <ToolBtn label="元に戻す" disabled={!st.canUndo} onClick={() => run().undo().run()}><Undo2 size={15} /></ToolBtn>
        <ToolBtn label="やり直す" disabled={!st.canRedo} onClick={() => run().redo().run()}><Redo2 size={15} /></ToolBtn>
      </div>

      {/* 編集欄（右下をドラッグして、広げられる） */}
      <div
        className="rich-editor overflow-auto"
        style={{ resize: "vertical", height: expanded ? "32rem" : "16rem", minHeight: "9rem", maxHeight: "90vh" }}
        onClick={() => setMenu(null)}
      >
        <div className="relative">
          {st.empty && placeholder && (
            <p className="absolute left-4 top-3 text-sm pointer-events-none" style={{ color: "var(--color-ink-300)" }}>{placeholder}</p>
          )}
          <EditorContent editor={editor} />
        </div>
      </div>

      {error && <p className="px-3 py-1.5 text-xs border-t" style={{ color: "var(--color-brand)", borderColor: "var(--color-paper-300)" }}>{error}</p>}
    </div>
  );
}
