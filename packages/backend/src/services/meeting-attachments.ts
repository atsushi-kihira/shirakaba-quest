// =============================================================
// ミーティング・定例会の「説明」に添付する画像・ファイル
//   ・ファイル本体は R2、情報は meeting_attachments に保存する
//   ・アップロード直後は、まだ会に結びついていない（owner が空）。会を作るとき（または追加するとき）に結びつける
//   ・定例会の各回には、定例会に添付したものが表示される
// =============================================================
import { and, asc, eq, inArray, isNull, lt, notInArray } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";

type Db = ReturnType<typeof createDb>;

export type AttachmentOwnerType = "meeting" | "series";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 1ファイル 10MB まで
export const MAX_ATTACHMENTS_PER_OWNER = 10;           // 1つの会に、添付のファイル（説明の下に並ぶもの）は 10個まで
export const MAX_INLINE_IMAGES_PER_OWNER = 20;         // 説明の文章の中に差し込む画像は 20枚まで
const MAX_PENDING_PER_UPLOADER = 30;                   // 会に結びつけていないアップロードの上限（本人ぶん）
const PENDING_TTL_SEC = 24 * 60 * 60;                  // 会に結びつかないまま1日たったものは片づける

/** API で返す添付の情報 */
export type AttachmentDto = {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  isImage: boolean;
};

// 拡張子 → 種類。ブラウザが申告する種類は信用せず、拡張子で決める（スクリプトやHTMLなど、危険なものは受け付けない）
const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
};
const FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
  zip: "application/zip",
  mp3: "audio/mpeg", m4a: "audio/mp4",
  mp4: "video/mp4", mov: "video/quicktime",
};

export function classifyFile(fileName: string): { contentType: string; isImage: boolean } | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (IMAGE_TYPES[ext]) return { contentType: IMAGE_TYPES[ext], isImage: true };
  if (FILE_TYPES[ext]) return { contentType: FILE_TYPES[ext], isImage: false };
  return null;
}

/** 画像は、中身の先頭バイトも見て、拡張子どおりの画像かを確かめる */
export function looksLikeImage(contentType: string, head: Uint8Array): boolean {
  const is = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  switch (contentType) {
    case "image/jpeg": return is(0xff, 0xd8, 0xff);
    case "image/png": return is(0x89, 0x50, 0x4e, 0x47);
    case "image/gif": return is(0x47, 0x49, 0x46, 0x38);
    case "image/webp": return is(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
    default: return true;
  }
}

/** ファイル名を、保存・表示しやすい形に整える（パスや制御文字を除く） */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (cleaned || "file").slice(0, 120);
}

function toDto(r: typeof schema.meetingAttachments.$inferSelect): AttachmentDto {
  return {
    id: r.id, name: r.fileName, contentType: r.contentType, sizeBytes: r.sizeBytes,
    isImage: r.contentType.startsWith("image/"),
  };
}

/** 会に結びついている添付の一覧（並び順どおり）。説明の文章の中に差し込んだ画像は、ここには含めない */
export async function listAttachments(db: Db, ownerType: AttachmentOwnerType, ownerId: string): Promise<AttachmentDto[]> {
  const rows = await db.select().from(schema.meetingAttachments)
    .where(and(eq(schema.meetingAttachments.ownerType, ownerType), eq(schema.meetingAttachments.ownerId, ownerId), eq(schema.meetingAttachments.inline, 0)))
    .orderBy(asc(schema.meetingAttachments.sortOrder), asc(schema.meetingAttachments.createdAt)).all();
  return rows.map(toDto);
}

/** 会にすでに結びついている添付の数（inline=true は、説明の文章の中の画像） */
export async function countOwnerAttachments(db: Db, ownerType: AttachmentOwnerType, ownerId: string, inline = false): Promise<number> {
  const rows = await db.select({ id: schema.meetingAttachments.id }).from(schema.meetingAttachments)
    .where(and(
      eq(schema.meetingAttachments.ownerType, ownerType), eq(schema.meetingAttachments.ownerId, ownerId),
      eq(schema.meetingAttachments.inline, inline ? 1 : 0),
    )).all();
  return rows.length;
}

/** 本人が、会に結びつけていないアップロードの数（上限のチェックに使う）。ついでに、古いものは片づける */
export async function pendingCountAndSweep(db: Db, r2: R2Bucket, uploaderId: string, now: number): Promise<number> {
  const stale = await db.select().from(schema.meetingAttachments)
    .where(and(
      eq(schema.meetingAttachments.uploaderId, uploaderId),
      isNull(schema.meetingAttachments.ownerId),
      lt(schema.meetingAttachments.createdAt, now - PENDING_TTL_SEC),
    )).all();
  for (const s of stale) {
    await r2.delete(s.r2Key).catch(() => {});
    await db.delete(schema.meetingAttachments).where(eq(schema.meetingAttachments.id, s.id));
  }
  const pending = await db.select({ id: schema.meetingAttachments.id }).from(schema.meetingAttachments)
    .where(and(eq(schema.meetingAttachments.uploaderId, uploaderId), isNull(schema.meetingAttachments.ownerId))).all();
  return pending.length;
}

export { MAX_PENDING_PER_UPLOADER };

/**
 * アップロード済みの添付（本人がアップロードして、まだ会に結びついていないもの）を、会に結びつける。
 * 渡された順に並べる。結びつけた数を返す。
 */
export async function linkAttachments(
  db: Db, ownerType: AttachmentOwnerType, ownerId: string, uploaderId: string, ids: unknown,
): Promise<number> {
  if (!Array.isArray(ids)) return 0;
  const wanted = [...new Set(ids.filter((x): x is string => typeof x === "string"))].slice(0, MAX_ATTACHMENTS_PER_OWNER + MAX_INLINE_IMAGES_PER_OWNER);
  if (wanted.length === 0) return 0;
  const rows = await db.select().from(schema.meetingAttachments)
    .where(and(
      inArray(schema.meetingAttachments.id, wanted),
      eq(schema.meetingAttachments.uploaderId, uploaderId),
      isNull(schema.meetingAttachments.ownerId),
    )).all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const fileCount = { value: await countOwnerAttachments(db, ownerType, ownerId, false) };
  const inlineCount = { value: await countOwnerAttachments(db, ownerType, ownerId, true) };
  let order = fileCount.value;
  let linked = 0;
  for (const id of wanted) {
    const row = byId.get(id);
    if (!row) continue;
    const counter = row.inline === 1 ? inlineCount : fileCount;
    const cap = row.inline === 1 ? MAX_INLINE_IMAGES_PER_OWNER : MAX_ATTACHMENTS_PER_OWNER;
    if (counter.value >= cap) continue;
    await db.update(schema.meetingAttachments)
      .set({ ownerType, ownerId, sortOrder: order++ })
      .where(eq(schema.meetingAttachments.id, id));
    counter.value++;
    linked++;
  }
  return linked;
}

/**
 * 説明の文章の中に差し込んだ画像のうち、いまの説明に入っていないもの（消した画像）を、削除する。
 * 説明を保存するたびに呼ぶ。keepIds は、いまの説明が参照している添付ID。
 */
export async function pruneInlineAttachments(
  db: Db, r2: R2Bucket, ownerType: AttachmentOwnerType, ownerId: string, keepIds: string[],
): Promise<void> {
  const where = and(
    eq(schema.meetingAttachments.ownerType, ownerType),
    eq(schema.meetingAttachments.ownerId, ownerId),
    eq(schema.meetingAttachments.inline, 1),
    ...(keepIds.length > 0 ? [notInArray(schema.meetingAttachments.id, keepIds)] : []),
  );
  const stale = await db.select().from(schema.meetingAttachments).where(where).all();
  for (const r of stale) {
    await r2.delete(r.r2Key).catch(() => {});
    await db.delete(schema.meetingAttachments).where(eq(schema.meetingAttachments.id, r.id));
  }
}

/**
 * 説明を保存したあとに呼ぶ：アップロード済みの添付を会に結びつけ、説明から消された画像を片づける。
 * attachmentIds：画面から届いた添付ID（ファイル・画像）／ imageIds：いまの説明に差し込まれている画像
 */
export async function syncOwnerAttachments(
  db: Db, r2: R2Bucket, ownerType: AttachmentOwnerType, ownerId: string, uploaderId: string,
  attachmentIds: unknown, imageIds: string[],
): Promise<void> {
  const ids = [...(Array.isArray(attachmentIds) ? attachmentIds : []), ...imageIds];
  await linkAttachments(db, ownerType, ownerId, uploaderId, ids);
  await pruneInlineAttachments(db, r2, ownerType, ownerId, imageIds);
}

/** 会を完全に削除するときに、添付（ファイル本体も）を片づける */
export async function deleteOwnerAttachments(db: Db, r2: R2Bucket, ownerType: AttachmentOwnerType, ownerId: string): Promise<void> {
  const rows = await db.select().from(schema.meetingAttachments)
    .where(and(eq(schema.meetingAttachments.ownerType, ownerType), eq(schema.meetingAttachments.ownerId, ownerId))).all();
  for (const r of rows) await r2.delete(r.r2Key).catch(() => {});
  if (rows.length > 0) {
    await db.delete(schema.meetingAttachments)
      .where(and(eq(schema.meetingAttachments.ownerType, ownerType), eq(schema.meetingAttachments.ownerId, ownerId)));
  }
}

/** 会（複数）の添付を、まとめて片づける（定例会の開催回をまとめて削除するとき） */
export async function deleteOwnersAttachments(db: Db, r2: R2Bucket, ownerType: AttachmentOwnerType, ownerIds: string[]): Promise<void> {
  for (let i = 0; i < ownerIds.length; i += 50) {
    const chunk = ownerIds.slice(i, i + 50);
    const rows = await db.select().from(schema.meetingAttachments)
      .where(and(eq(schema.meetingAttachments.ownerType, ownerType), inArray(schema.meetingAttachments.ownerId, chunk))).all();
    for (const r of rows) await r2.delete(r.r2Key).catch(() => {});
    if (rows.length > 0) {
      await db.delete(schema.meetingAttachments)
        .where(and(eq(schema.meetingAttachments.ownerType, ownerType), inArray(schema.meetingAttachments.ownerId, chunk)));
    }
  }
}
