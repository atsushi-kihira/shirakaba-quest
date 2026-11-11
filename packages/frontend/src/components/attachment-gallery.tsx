// =============================================================
// 説明に添付された画像・ファイルの表示
//   ・画像：サムネイルを並べる。タップすると大きく表示（保存もできる）
//   ・ファイル：名前と大きさの行。「保存」で端末に保存する
// 画像・ファイルはログインした人だけが見られるので、アプリ経由で取得して表示する。
// =============================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { downloadAttachment, fileIcon, fmtFileSize, type Attachment } from "@/lib/attachments";
import { DialogCloseButton } from "@/components/dialog-close-button";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** 添付画像を、ログイン情報つきで取得して表示する */
export function AttachmentImage({ id, alt, className, style, onClick }: {
  id: string; alt: string; className?: string; style?: React.CSSProperties; onClick?: () => void;
}) {
  // 画像は data URL にして持つ（一時アドレスの作成・解放を気にしなくてよく、キャッシュもそのまま使える）
  const { data: url, isError } = useQuery({
    queryKey: ["meeting-attachment-image", id],
    queryFn: async () => blobToDataUrl(await api.getBlob(`/meeting-attachments/${id}/file`)),
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  });

  if (isError) {
    return <div className={className} style={{ ...style, background: "var(--color-paper-200)", color: "var(--color-ink-400)" }}>
      <span className="text-[10px] p-2 block">画像を読み込めませんでした</span>
    </div>;
  }
  if (!url) {
    return <div className={`${className ?? ""} flex items-center justify-center`} style={{ ...style, background: "var(--color-paper-200)" }}>
      <Loader2 size={16} className="animate-spin" style={{ color: "var(--color-ink-400)" }} />
    </div>;
  }
  return <img src={url} alt={alt} className={className} style={style} onClick={onClick} draggable={false} />;
}

function Lightbox({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={onClose}
    >
      <div
        className="rounded-3xl p-4 max-w-3xl w-full max-h-[92vh] flex flex-col"
        style={{ background: "var(--color-paper-50)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2 mb-3">
          <p className="flex-1 min-w-0 text-sm font-medium break-all" style={{ color: "var(--color-ink-800)" }}>{attachment.name}</p>
          <DialogCloseButton onClick={onClose} />
        </div>
        <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center">
          <AttachmentImage id={attachment.id} alt={attachment.name} className="max-w-full max-h-[70vh] object-contain rounded-xl" />
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={async () => { setSaving(true); try { await downloadAttachment(attachment); } finally { setSaving(false); } }}
          className="mt-3 self-end flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
          style={{ background: "var(--color-brand)" }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          画像を保存する
        </button>
      </div>
    </div>
  );
}

export function FileRow({ attachment }: { attachment: Attachment }) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "var(--color-paper-200)" }}>
      <span className="text-base">{fileIcon(attachment)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm break-all" style={{ color: "var(--color-ink-800)" }}>{attachment.name}</p>
        <p className="text-[11px]" style={{ color: failed ? "var(--color-brand)" : "var(--color-ink-400)" }}>
          {failed ? "保存できませんでした。もう一度お試しください" : fmtFileSize(attachment.sizeBytes)}
        </p>
      </div>
      <button
        type="button"
        disabled={saving}
        onClick={async () => {
          setSaving(true); setFailed(false);
          try { await downloadAttachment(attachment); } catch { setFailed(true); } finally { setSaving(false); }
        }}
        className="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg disabled:opacity-50"
        style={{ background: "var(--color-paper-50)", color: "var(--color-ink-600)", border: "1px solid var(--color-paper-300)" }}
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
        保存
      </button>
    </div>
  );
}

export function AttachmentGallery({ attachments, className }: { attachments: Attachment[]; className?: string }) {
  const [open, setOpen] = useState<Attachment | null>(null);
  if (attachments.length === 0) return null;
  const images = attachments.filter((a) => a.isImage);
  const files = attachments.filter((a) => !a.isImage);
  return (
    <div className={className}>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {images.map((a) => (
            <button key={a.id} type="button" onClick={() => setOpen(a)} aria-label={`${a.name}を大きく表示`} className="rounded-xl overflow-hidden">
              <AttachmentImage
                id={a.id} alt={a.name}
                className="h-28 w-auto max-w-[14rem] object-cover rounded-xl cursor-zoom-in"
                style={{ border: "1px solid var(--color-paper-300)" }}
              />
            </button>
          ))}
        </div>
      )}
      {files.length > 0 && <div className="space-y-1.5">{files.map((a) => <FileRow key={a.id} attachment={a} />)}</div>}
      {open && <Lightbox attachment={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
