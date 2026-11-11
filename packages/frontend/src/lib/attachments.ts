// =============================================================
// ミーティング・定例会の説明に添付する画像・ファイル：共通の処理
//   ・大きな写真は、アップロードの前に、見やすさを保ったまま小さくする
//   ・ファイルの大きさ・種類は、ここでも確かめて、やさしい日本語で伝える（サーバー側でも確かめている）
// =============================================================
import { api } from "@/lib/api";
import { memberAttachmentPath, type AttachmentPathFn } from "@/lib/attachment-source";

export type Attachment = {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  isImage: boolean;
};

export type AttachmentOwner = { type: "meeting" | "series"; id: string };

export const MAX_ATTACHMENT_MB = 10;
export const MAX_ATTACHMENTS = 10;
const MAX_IMAGE_EDGE = 1600; // 写真の長いほうの辺（px）。これより大きい写真は、縮小して送る

export const ATTACHMENT_ACCEPT =
  ".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.mp3,.m4a,.mp4,.mov";

/** 説明の下に添付するファイル（画像は、説明の中に差し込むので、ここには含めない） */
export const FILE_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.mp3,.m4a,.mp4,.mov";

const ALLOWED_EXT = new Set(ATTACHMENT_ACCEPT.split(",").map((e) => e.slice(1)));

export function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function fileIcon(a: Pick<Attachment, "contentType" | "name">): string {
  const t = a.contentType;
  if (t.startsWith("image/")) return "🖼️";
  if (t === "application/pdf") return "📕";
  if (t.includes("word")) return "📘";
  if (t.includes("excel") || t.includes("spreadsheet") || t === "text/csv") return "📗";
  if (t.includes("powerpoint") || t.includes("presentation")) return "📙";
  if (t.startsWith("audio/")) return "🎵";
  if (t.startsWith("video/")) return "🎬";
  if (t === "application/zip") return "🗜️";
  return "📄";
}

/** 画像を、長いほうの辺が MAX_IMAGE_EDGE 以下になるよう縮小する（できなければ、そのまま返す） */
async function shrinkImage(file: File): Promise<File> {
  const type = file.type;
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_IMAGE_EDGE && file.size <= 2 * 1024 * 1024) { bitmap.close(); return file; }
    const scale = Math.min(1, MAX_IMAGE_EDGE / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) { bitmap.close(); return file; }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
    if (!blob || blob.size >= file.size) return file; // 小さくならなければ、元のまま
    return new File([blob], file.name, { type });
  } catch {
    return file;
  }
}

/** 添付できるファイルか確かめる。問題があれば、やさしい日本語のメッセージを返す */
export function checkAttachFile(file: File): string {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (!ALLOWED_EXT.has(ext)) {
    return `「${file.name}」は、添付できない種類のファイルです（画像、PDF、Word・Excel・PowerPoint、テキスト・CSV、ZIP、音声・動画が使えます）`;
  }
  return "";
}

/** ファイルをアップロードする。owner を渡すと、主催している会に、その場で結びつける */
/** inline: 説明の文章の中に差し込む画像として保存する（説明の下の添付一覧には出さない） */
export async function uploadAttachment(rawFile: File, owner?: AttachmentOwner, opts?: { inline?: boolean }): Promise<Attachment> {
  const problem = checkAttachFile(rawFile);
  if (problem) throw new Error(problem);
  const file = await shrinkImage(rawFile);
  if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
    throw new Error(`「${rawFile.name}」は大きすぎます（${fmtFileSize(file.size)}）。1つあたり${MAX_ATTACHMENT_MB}MBまでです`);
  }
  const form = new FormData();
  form.append("file", file, file.name);
  if (opts?.inline) form.append("inline", "1");
  if (owner) {
    form.append("ownerType", owner.type);
    form.append("ownerId", owner.id);
  }
  const res = await api.upload<{ data: Attachment }>("/meeting-attachments", form);
  return res.data;
}

export function removeAttachment(id: string): Promise<unknown> {
  return api.delete(`/meeting-attachments/${id}`);
}

/** ファイルを、端末に保存する */
export async function downloadAttachment(a: Pick<Attachment, "id" | "name">, pathOf: AttachmentPathFn = memberAttachmentPath): Promise<void> {
  const blob = await api.getBlob(pathOf(a.id, true));
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = a.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
