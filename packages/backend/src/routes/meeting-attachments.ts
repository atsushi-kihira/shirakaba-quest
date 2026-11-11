// =============================================================
// ミーティング・定例会の説明に添付する画像・ファイル（認証必要）
// POST   /api/meeting-attachments            — アップロード（multipart: file ／ 任意で ownerType・ownerId）
//                                              ownerType・ownerId を付けると、主催している会に、その場で結びつける
// GET    /api/meeting-attachments/:id/file   — ファイルを取得（?download=1 で、保存用に返す）
// DELETE /api/meeting-attachments/:id        — 削除（アップロードした本人、または会の主催者）
// =============================================================
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId } from "../services/auth.ts";
import { resolveEffectiveMemberId } from "../services/resolve-member.ts";
import {
  MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_OWNER, MAX_PENDING_PER_UPLOADER,
  classifyFile, cleanFileName, countOwnerAttachments, looksLikeImage, pendingCountAndSweep,
  type AttachmentOwnerType,
} from "../services/meeting-attachments.ts";
import type { Env, Variables } from "../types.ts";

export const meetingAttachmentRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
meetingAttachmentRoutes.use("*", authMiddleware);

const NO_MEMBER = { error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } } as const;
const NOT_FOUND = { error: { code: "not_found", message: "ファイルが見つかりません" } } as const;

/** 会の主催者か（ownerType の会が無ければ null） */
async function isOwnerHost(db: ReturnType<typeof createDb>, ownerType: AttachmentOwnerType, ownerId: string, memberId: string): Promise<boolean | null> {
  const row = ownerType === "series"
    ? await db.select({ host: schema.meetingSeries.hostMemberId }).from(schema.meetingSeries).where(eq(schema.meetingSeries.id, ownerId)).get()
    : await db.select({ host: schema.meetings.hostMemberId }).from(schema.meetings).where(eq(schema.meetings.id, ownerId)).get();
  return row ? row.host === memberId : null;
}

meetingAttachmentRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json(NO_MEMBER, 403);
  const now = Math.floor(Date.now() / 1000);

  const form = await c.req.parseBody().catch(() => null);
  const file = form?.["file"];
  if (!form || !(file instanceof File)) {
    return c.json({ error: { code: "bad_request", message: "ファイルを選んでください" } }, 400);
  }
  if (file.size === 0) {
    return c.json({ error: { code: "bad_request", message: "中身のないファイルは添付できません" } }, 400);
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return c.json({ error: { code: "too_large", message: `ファイルが大きすぎます。1つあたり${MAX_ATTACHMENT_BYTES / 1024 / 1024}MBまでです` } }, 400);
  }
  const fileName = cleanFileName(file.name);
  const kind = classifyFile(fileName);
  if (!kind) {
    return c.json({ error: { code: "bad_type", message: "このファイルの種類は添付できません。画像（JPG・PNG・GIF・WebP）、PDF、Word・Excel・PowerPoint、テキスト・CSV、ZIP、音声・動画（MP3・MP4など）が使えます" } }, 400);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (kind.isImage && !looksLikeImage(kind.contentType, bytes.subarray(0, 16))) {
    return c.json({ error: { code: "bad_type", message: "画像として読み込めないファイルです。別の画像をお試しください" } }, 400);
  }

  // 添付先を指定したとき（すでにある会に追加するとき）は、主催者だけが追加できる
  const ownerTypeRaw = typeof form["ownerType"] === "string" ? form["ownerType"] : "";
  const ownerId = typeof form["ownerId"] === "string" ? form["ownerId"] : "";
  let ownerType: AttachmentOwnerType | null = null;
  let sortOrder = 0;
  if (ownerTypeRaw || ownerId) {
    if ((ownerTypeRaw !== "meeting" && ownerTypeRaw !== "series") || !ownerId) {
      return c.json({ error: { code: "bad_request", message: "添付先が正しくありません" } }, 400);
    }
    ownerType = ownerTypeRaw;
    const host = await isOwnerHost(db, ownerType, ownerId, memberId);
    if (host === null) return c.json({ error: { code: "not_found", message: "ミーティングが見つかりません" } }, 404);
    if (!host) return c.json({ error: { code: "forbidden", message: "主催者のみ添付できます" } }, 403);
    sortOrder = await countOwnerAttachments(db, ownerType, ownerId);
    if (sortOrder >= MAX_ATTACHMENTS_PER_OWNER) {
      return c.json({ error: { code: "too_many", message: `添付できるのは${MAX_ATTACHMENTS_PER_OWNER}個までです` } }, 400);
    }
  } else {
    const pending = await pendingCountAndSweep(db, c.env.R2, memberId, now);
    if (pending >= MAX_PENDING_PER_UPLOADER) {
      return c.json({ error: { code: "too_many", message: "添付するファイルが多すぎます。いらないものを外してからお試しください" } }, 400);
    }
  }

  const id = newId();
  const r2Key = `meeting-attachments/${id}`;
  await c.env.R2.put(r2Key, bytes, { httpMetadata: { contentType: kind.contentType } });
  await db.insert(schema.meetingAttachments).values({
    id,
    ownerType, ownerId: ownerType ? ownerId : null,
    uploaderId: memberId,
    fileName, contentType: kind.contentType, sizeBytes: bytes.byteLength, r2Key,
    sortOrder, createdAt: now,
  });

  return c.json({ data: { id, name: fileName, contentType: kind.contentType, sizeBytes: bytes.byteLength, isImage: kind.isImage } });
});

meetingAttachmentRoutes.get("/:id/file", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json(NO_MEMBER, 403);
  const row = await db.select().from(schema.meetingAttachments).where(eq(schema.meetingAttachments.id, c.req.param("id"))).get();
  if (!row) return c.json(NOT_FOUND, 404);
  // 会に結びつくまでは、アップロードした本人だけが見られる
  if (!row.ownerId && row.uploaderId !== memberId) return c.json(NOT_FOUND, 404);

  const obj = await c.env.R2.get(row.r2Key);
  if (!obj) return c.json(NOT_FOUND, 404);

  const isImage = row.contentType.startsWith("image/");
  const asDownload = c.req.query("download") === "1" || !isImage;
  const encoded = encodeURIComponent(row.fileName);
  return new Response(obj.body, {
    headers: {
      "Content-Type": row.contentType,
      "Content-Length": String(row.sizeBytes),
      "Content-Disposition": `${asDownload ? "attachment" : "inline"}; filename*=UTF-8''${encoded}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
});

meetingAttachmentRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!memberId) return c.json(NO_MEMBER, 403);
  const row = await db.select().from(schema.meetingAttachments).where(eq(schema.meetingAttachments.id, c.req.param("id"))).get();
  if (!row) return c.json({ ok: true }); // すでに無ければ、そのまま成功

  if (row.ownerType && row.ownerId) {
    const host = await isOwnerHost(db, row.ownerType as AttachmentOwnerType, row.ownerId, memberId);
    if (host !== true) return c.json({ error: { code: "forbidden", message: "主催者のみ削除できます" } }, 403);
  } else if (row.uploaderId !== memberId) {
    return c.json({ error: { code: "forbidden", message: "削除できません" } }, 403);
  }

  await c.env.R2.delete(row.r2Key).catch(() => {});
  await db.delete(schema.meetingAttachments).where(eq(schema.meetingAttachments.id, row.id));
  return c.json({ ok: true });
});
