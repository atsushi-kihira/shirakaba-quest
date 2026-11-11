// =============================================================
// 外部ゲスト用ページの、説明に添付された画像・ファイル（認証なし）
// GET /api/schedule/attachments/:id/file?token=...&download=1
//   token は、ゲストが開いているページのURLに含まれる、ゲスト用のトークン（個別URL・共有URL・定例会のURL）。
//   そのトークンで開けるミーティング・定例会の添付だけを返す（ほかの会のファイルは返さない）。
// =============================================================
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import type { Env, Variables } from "../types.ts";

export const scheduleAttachmentRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

type Db = ReturnType<typeof createDb>;

/** このトークンは、定例会（seriesId）のページを開けるものか（定例会の共有URL・定例会の個別URL） */
async function seriesTokenOk(db: Db, seriesId: string, token: string): Promise<boolean> {
  const s = await db.select({ t: schema.meetingSeries.inviteToken }).from(schema.meetingSeries).where(eq(schema.meetingSeries.id, seriesId)).get();
  if (s?.t && s.t === token) return true;
  const ext = await db.select({ id: schema.meetingSeriesExternalInvitees.id }).from(schema.meetingSeriesExternalInvitees)
    .where(and(eq(schema.meetingSeriesExternalInvitees.seriesId, seriesId), eq(schema.meetingSeriesExternalInvitees.token, token))).get();
  return !!ext;
}

/** このトークンは、ミーティング（meetingId）のページを開けるものか（共有URL・個別URL。定例会の回なら、定例会のURLも） */
async function meetingTokenOk(db: Db, meetingId: string, token: string): Promise<boolean> {
  const m = await db.select({ t: schema.meetings.inviteToken, seriesId: schema.meetings.seriesId }).from(schema.meetings).where(eq(schema.meetings.id, meetingId)).get();
  if (!m) return false;
  if (m.t && m.t === token) return true;
  const ext = await db.select({ id: schema.meetingExternalInvitees.id }).from(schema.meetingExternalInvitees)
    .where(and(eq(schema.meetingExternalInvitees.meetingId, meetingId), eq(schema.meetingExternalInvitees.token, token))).get();
  if (ext) return true;
  return m.seriesId ? seriesTokenOk(db, m.seriesId, token) : false;
}

/** 定例会の添付を、その定例会の「回」のゲストURLからも開けるようにする（回に引き継いだ説明が、定例会の画像を使うため） */
async function seriesViaMeetingTokenOk(db: Db, seriesId: string, token: string): Promise<boolean> {
  const byShared = await db.select({ id: schema.meetings.id }).from(schema.meetings)
    .where(and(eq(schema.meetings.seriesId, seriesId), eq(schema.meetings.inviteToken, token))).get();
  if (byShared) return true;
  const ext = await db.select({ meetingId: schema.meetingExternalInvitees.meetingId }).from(schema.meetingExternalInvitees)
    .where(eq(schema.meetingExternalInvitees.token, token)).get();
  if (!ext) return false;
  const m = await db.select({ seriesId: schema.meetings.seriesId }).from(schema.meetings).where(eq(schema.meetings.id, ext.meetingId)).get();
  return m?.seriesId === seriesId;
}

scheduleAttachmentRoutes.get("/attachments/:id/file", async (c) => {
  const db = createDb(c.env.DB);
  const token = c.req.query("token") ?? "";
  const notFound = () => c.json({ error: { code: "not_found", message: "ファイルが見つかりません" } }, 404);
  if (token.length < 8) return notFound();

  const row = await db.select().from(schema.meetingAttachments).where(eq(schema.meetingAttachments.id, c.req.param("id"))).get();
  if (!row || !row.ownerId || !row.ownerType) return notFound();

  const allowed = row.ownerType === "series"
    ? (await seriesTokenOk(db, row.ownerId, token)) || (await seriesViaMeetingTokenOk(db, row.ownerId, token))
    : await meetingTokenOk(db, row.ownerId, token);
  if (!allowed) return notFound();

  const obj = await c.env.R2.get(row.r2Key);
  if (!obj) return notFound();

  const isImage = row.contentType.startsWith("image/");
  const asDownload = c.req.query("download") === "1" || !isImage;
  return new Response(obj.body, {
    headers: {
      "Content-Type": row.contentType,
      "Content-Length": String(row.sizeBytes),
      "Content-Disposition": `${asDownload ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
});
