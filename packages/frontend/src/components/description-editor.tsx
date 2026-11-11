// =============================================================
// ミーティング・定例会の「説明」の入力欄（見たまま編集＋ファイルの添付）
//   ・説明は、文字の大きさ・色・太字などの書式をつけて、見たままの形で編集できる（rich-text-editor.tsx）
//   ・画像は、説明の好きな場所に、好きな大きさで差し込める
//   ・PDF・Word・Excelなどのファイルは、説明の下に添付する（「ファイルを添付」ボタン、またはドラッグ＆ドロップ）
// owner を渡すと（すでにある会の説明を編集するとき）、添付の追加・削除はその場で会に反映される。
// owner が無いとき（これから会を作るとき）は、アップロードだけしておき、会を作るときに結びつける。
// =============================================================
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Loader2, Maximize2, Minimize2, Paperclip, X } from "lucide-react";
import { AttachmentImage } from "@/components/attachment-gallery";
import {
  FILE_ACCEPT, MAX_ATTACHMENTS, MAX_ATTACHMENT_MB, fileIcon, fmtFileSize, removeAttachment, uploadAttachment,
  type Attachment, type AttachmentOwner,
} from "@/lib/attachments";
import type { RichDoc } from "@/lib/rich-doc";

// 編集の部品（Tiptap）は大きいので、編集画面を開いたときに読み込む（表示だけの人の読み込みを重くしない）
const RichTextEditor = lazy(() => import("@/components/rich-text-editor").then((m) => ({ default: m.RichTextEditor })));

type Props = {
  /** 説明の書式つき内容（最初の内容。編集中の内容は onDocChange で受け取る） */
  doc: RichDoc;
  onDocChange: (doc: RichDoc) => void;
  /** 説明の下に添付するファイル */
  attachments: Attachment[];
  onAttachmentsChange: (v: Attachment[]) => void;
  placeholder?: string;
  owner?: AttachmentOwner;
  disabled?: boolean;
  /** 添付ファイルの追加・削除はできない（定例会の回など。ファイルは表示だけ） */
  attachmentsLocked?: boolean;
  /** 文章の入力欄は出さず、添付ファイルだけを編集する（定例会のページなど） */
  hideText?: boolean;
  /** アップロード中かどうかを親に知らせる（作成ボタンを、アップロード中は押せなくするため） */
  onBusyChange?: (busy: boolean) => void;
};

export function DescriptionEditor({
  doc, onDocChange, attachments, onAttachmentsChange, placeholder, owner, disabled, attachmentsLocked, hideText, onBusyChange,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(0); // アップロード中のファイル数
  const [imageBusy, setImageBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  // アップロードが終わるたびに最新の一覧に足せるよう、いまの一覧を持っておく
  const latest = useRef(attachments);
  useEffect(() => { latest.current = attachments; }, [attachments]);
  useEffect(() => { onBusyChange?.(uploading > 0 || imageBusy); }, [uploading, imageBusy, onBusyChange]);

  async function addFiles(files: File[]) {
    if (files.length === 0 || disabled || attachmentsLocked) return;
    setError("");
    const room = MAX_ATTACHMENTS - latest.current.length;
    if (room <= 0) { setError(`添付できるファイルは${MAX_ATTACHMENTS}個までです`); return; }
    const targets = files.slice(0, room);
    if (files.length > room) setError(`添付できるファイルは${MAX_ATTACHMENTS}個までです。入りきらない分は追加していません`);
    for (const f of targets) {
      setUploading((n) => n + 1);
      try {
        const added = await uploadAttachment(f, owner);
        const next = [...latest.current, added];
        latest.current = next;
        onAttachmentsChange(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "アップロードに失敗しました。もう一度お試しください");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function remove(a: Attachment) {
    setError("");
    try {
      await removeAttachment(a.id);
      const next = latest.current.filter((x) => x.id !== a.id);
      latest.current = next;
      onAttachmentsChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除できませんでした。もう一度お試しください");
    }
  }

  const images = attachments.filter((a) => a.isImage); // 以前の方法で添付した画像
  const files = attachments.filter((a) => !a.isImage);

  return (
    <div
      onDragOver={(e) => { if (!attachmentsLocked && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(e) => {
        setDragging(false);
        // 画像は、エディタが説明の中に差し込む。ここでは、画像以外のファイルを添付にする
        const others = Array.from(e.dataTransfer.files).filter((f) => !f.type.startsWith("image/"));
        if (others.length === 0) return;
        e.preventDefault();
        void addFiles(others);
      }}
      className="rounded-2xl transition"
      style={{ outline: dragging ? "2px dashed var(--color-brand)" : "none", outlineOffset: "2px" }}
    >
      {!hideText && (
        <Suspense fallback={
          <div className="flex items-center justify-center gap-2 rounded-2xl border" style={{ height: "16rem", borderColor: "var(--color-paper-300)", color: "var(--color-ink-400)" }}>
            <Loader2 size={16} className="animate-spin" /><span className="text-sm">編集画面を読み込み中…</span>
          </div>
        }>
          <RichTextEditor doc={doc} onChange={onDocChange} placeholder={placeholder} owner={owner} onBusyChange={setImageBusy} expanded={expanded} />
        </Suspense>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-1.5">
        {!attachmentsLocked && (
          <>
            <button
              type="button"
              disabled={disabled || uploading > 0 || attachments.length >= MAX_ATTACHMENTS}
              onClick={() => fileInput.current?.click()}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl font-medium disabled:opacity-50"
              style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}
            >
              <Paperclip size={13} />
              ファイルを添付（PDF・Word・Excelなど）
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={FILE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = ""; // 同じファイルをもう一度選べるように
                void addFiles(picked);
              }}
            />
          </>
        )}
        {!hideText && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
          >
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            {expanded ? "小さくする" : "大きく書く"}
          </button>
        )}
        {uploading > 0 && (
          <span className="flex items-center gap-1 text-xs" style={{ color: "var(--color-ink-500)" }}>
            <Loader2 size={12} className="animate-spin" />アップロード中…
          </span>
        )}
        {!attachmentsLocked && (
          <span className="ml-auto text-[11px]" style={{ color: "var(--color-ink-400)" }}>
            {attachments.length > 0 ? `${attachments.length}/${MAX_ATTACHMENTS}個添付` : `1つ${MAX_ATTACHMENT_MB}MBまで`}
          </span>
        )}
      </div>

      {error && <p className="text-xs mt-1.5" style={{ color: "var(--color-brand)" }}>{error}</p>}

      {attachments.length > 0 && (
        <div className="mt-2 space-y-2">
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {images.map((a) => (
                <div key={a.id} className="relative">
                  <AttachmentImage id={a.id} alt={a.name} className="h-20 w-auto max-w-[10rem] object-cover rounded-xl"
                    style={{ border: "1px solid var(--color-paper-300)" }} />
                  {!attachmentsLocked && (
                    <button type="button" aria-label={`${a.name}を外す`} disabled={disabled} onClick={() => void remove(a)}
                      className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full flex items-center justify-center shadow"
                      style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)", color: "var(--color-ink-600)" }}>
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {files.map((a) => (
            <div key={a.id} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "var(--color-paper-200)" }}>
              <span className="text-base">{fileIcon(a)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm break-all" style={{ color: "var(--color-ink-800)" }}>{a.name}</p>
                <p className="text-[11px]" style={{ color: "var(--color-ink-400)" }}>{fmtFileSize(a.sizeBytes)}</p>
              </div>
              {!attachmentsLocked && (
                <button type="button" aria-label={`${a.name}を外す`} disabled={disabled} onClick={() => void remove(a)}
                  className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center" style={{ color: "var(--color-ink-500)" }}>
                  <X size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
