// =============================================================
// 管理者向けミーティング管理ルート
// GET    /api/admin/meetings          — 全ミーティング一覧
// PATCH  /api/admin/meetings/:id/hold — 保留（open → cancelled）
// DELETE /api/admin/meetings/:id      — 削除
// =============================================================
import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import type { Env, Variables } from "../../types.ts";

export const adminMeetingRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/admin/meetings
adminMeetingRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);

  const meetings = await db
    .select()
    .from(schema.meetings)
    .orderBy(desc(schema.meetings.createdAt))
    .all();

  const results = await Promise.all(
    meetings.map(async (m) => {
      const host = m.hostMemberId
        ? await db
            .select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji })
            .from(schema.members)
            .where(eq(schema.members.id, m.hostMemberId))
            .get()
        : null;

      const candidateCount = await db
        .select({ id: schema.meetingDateCandidates.id })
        .from(schema.meetingDateCandidates)
        .where(eq(schema.meetingDateCandidates.meetingId, m.id))
        .all()
        .then((rows) => rows.length);

      const confirmedCandidate = m.confirmedCandidateId
        ? await db
            .select()
            .from(schema.meetingDateCandidates)
            .where(eq(schema.meetingDateCandidates.id, m.confirmedCandidateId))
            .get()
        : null;

      return {
        id: m.id,
        title: m.title,
        description: m.description,
        status: m.status,
        scope: m.scope,
        host,
        candidateCount,
        confirmedDate: confirmedCandidate
          ? { startsAt: confirmedCandidate.startsAt, endsAt: confirmedCandidate.endsAt }
          : null,
        deadline: m.deadline,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      };
    })
  );

  return c.json({ data: results });
});

// PATCH /api/admin/meetings/:id/hold — キャンセル（保留）
adminMeetingRoutes.patch("/:id/hold", async (c) => {
  const db = createDb(c.env.DB);
  const { id } = c.req.param();
  const now = Math.floor(Date.now() / 1000);

  const meeting = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id)).get();
  if (!meeting) {
    return c.json({ error: { code: "not_found", message: "ミーティングが見つかりません" } }, 404);
  }

  await db
    .update(schema.meetings)
    .set({ status: "cancelled", updatedAt: now })
    .where(eq(schema.meetings.id, id));

  return c.json({ ok: true });
});

// DELETE /api/admin/meetings/:id — 完全削除
adminMeetingRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const { id } = c.req.param();

  const meeting = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id)).get();
  if (!meeting) {
    return c.json({ error: { code: "not_found", message: "ミーティングが見つかりません" } }, 404);
  }

  // 関連データを削除
  await db.delete(schema.meetingResponses).where(eq(schema.meetingResponses.meetingId, id));
  await db.delete(schema.meetingExternalInvitees).where(eq(schema.meetingExternalInvitees.meetingId, id));
  await db.delete(schema.meetingInvitees).where(eq(schema.meetingInvitees.meetingId, id));
  await db.delete(schema.meetingDateCandidates).where(eq(schema.meetingDateCandidates.meetingId, id));
  await db.delete(schema.meetingNotifications).where(eq(schema.meetingNotifications.meetingId, id));
  await db.delete(schema.meetings).where(eq(schema.meetings.id, id));

  return c.json({ ok: true });
});
