// =============================================================
// 外部ゲスト向け日程回答ルート（認証不要）
// GET  /api/schedule/:token   — ミーティング情報取得
// POST /api/schedule/:token/respond — 外部ゲスト回答
// =============================================================
import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { newId } from "../services/auth.ts";
import type { Env, Variables } from "../types.ts";

type Availability = "yes" | "maybe" | "no";

export const scheduleRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/schedule/:token
scheduleRoutes.get("/:token", async (c) => {
  const db = createDb(c.env.DB);
  const { token } = c.req.param();

  const extInvitee = await db
    .select()
    .from(schema.meetingExternalInvitees)
    .where(eq(schema.meetingExternalInvitees.token, token))
    .get();

  if (!extInvitee) {
    return c.json({ error: { code: "not_found", message: "このURLは無効です" } }, 404);
  }

  const meeting = await db
    .select()
    .from(schema.meetings)
    .where(eq(schema.meetings.id, extInvitee.meetingId))
    .get();

  if (!meeting) {
    return c.json({ error: { code: "not_found", message: "ミーティングが見つかりません" } }, 404);
  }

  const candidates = await db
    .select()
    .from(schema.meetingDateCandidates)
    .where(eq(schema.meetingDateCandidates.meetingId, meeting.id))
    .orderBy(schema.meetingDateCandidates.sortOrder)
    .all();

  // 既存の回答を取得
  const existingResponses = await db
    .select()
    .from(schema.meetingResponses)
    .where(eq(schema.meetingResponses.externalInviteeId, extInvitee.id))
    .all();

  const myAnswers: Record<string, Availability> = {};
  for (const r of existingResponses) {
    myAnswers[r.candidateId] = r.availability as Availability;
  }

  // ホスト情報
  const host = await db
    .select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji })
    .from(schema.members)
    .where(eq(schema.members.id, meeting.hostMemberId))
    .get();

  return c.json({
    data: {
      inviteeId: extInvitee.id,
      inviteeName: extInvitee.name,
      meeting: {
        id: meeting.id,
        title: meeting.title,
        description: meeting.description,
        status: meeting.status,
        confirmedCandidateId: meeting.confirmedCandidateId,
        host: host ?? null,
      },
      candidates: candidates.map((c) => ({
        id: c.id, startsAt: c.startsAt, endsAt: c.endsAt, note: c.note,
      })),
      myAnswers,
    },
  });
});

// POST /api/schedule/:token/respond
scheduleRoutes.post("/:token/respond", async (c) => {
  const db = createDb(c.env.DB);
  const { token } = c.req.param();
  const now = Math.floor(Date.now() / 1000);

  const extInvitee = await db
    .select()
    .from(schema.meetingExternalInvitees)
    .where(eq(schema.meetingExternalInvitees.token, token))
    .get();

  if (!extInvitee) {
    return c.json({ error: { code: "not_found", message: "このURLは無効です" } }, 404);
  }

  const meeting = await db
    .select()
    .from(schema.meetings)
    .where(eq(schema.meetings.id, extInvitee.meetingId))
    .get();

  if (!meeting || meeting.status !== "open") {
    return c.json({ error: { code: "meeting_closed", message: "このミーティングは既に締め切られています" } }, 400);
  }

  const body = await c.req.json<{ name?: string; answers: Record<string, Availability> }>();

  // 名前を更新（初回のみ、または変更時）
  if (body.name?.trim() && body.name.trim() !== extInvitee.name) {
    await db
      .update(schema.meetingExternalInvitees)
      .set({ name: body.name.trim() })
      .where(eq(schema.meetingExternalInvitees.id, extInvitee.id));
  }

  // 回答を upsert
  for (const [candidateId, availability] of Object.entries(body.answers)) {
    await db
      .delete(schema.meetingResponses)
      .where(
        and(
          eq(schema.meetingResponses.candidateId, candidateId),
          eq(schema.meetingResponses.externalInviteeId, extInvitee.id)
        )
      );
    await db.insert(schema.meetingResponses).values({
      id: newId(),
      meetingId: meeting.id,
      candidateId,
      memberId: null,
      externalInviteeId: extInvitee.id,
      availability,
      comment: null,
      respondedAt: now,
    });
  }

  return c.json({ ok: true });
});
