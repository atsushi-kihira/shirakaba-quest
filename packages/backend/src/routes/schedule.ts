// =============================================================
// 外部ゲスト向け日程回答ルート（認証不要）
// GET  /api/schedule/:token          — ミーティング情報取得
// POST /api/schedule/:token/respond  — 外部ゲスト回答（メールアドレス必須、初回はブックマークURLをメール送信）
// =============================================================
import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { newId } from "../services/auth.ts";
import { MailService } from "../services/mailer.ts";
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
      inviteeEmail: extInvitee.email,
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

  const body = await c.req.json<{ name?: string; email?: string; answers: Record<string, Availability> }>();

  // メールアドレスは必須
  const emailInput = body.email?.trim();
  if (!emailInput) {
    return c.json({ error: { code: "invalid_input", message: "メールアドレスを入力してください" } }, 400);
  }

  const isFirstResponse = !extInvitee.email;

  // 名前・メールを更新
  const updateFields: { name?: string; email?: string } = {};
  if (body.name?.trim() && body.name.trim() !== extInvitee.name) {
    updateFields.name = body.name.trim();
  }
  if (emailInput !== extInvitee.email) {
    updateFields.email = emailInput;
  }
  if (Object.keys(updateFields).length > 0) {
    await db
      .update(schema.meetingExternalInvitees)
      .set(updateFields)
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

  // 初回回答時にブックマークURL付きメールを送信
  if (isFirstResponse) {
    const appUrl = c.env.CORS_ORIGIN ?? "https://shirakaba-quest.pages.dev";
    const scheduleUrl = `${appUrl}/schedule/${token}`;
    const guestName = updateFields.name ?? extInvitee.name ?? "ゲスト";

    const hostMember = await db.select({ name: schema.members.name }).from(schema.members)
      .where(eq(schema.members.id, meeting.hostMemberId)).get();
    const hostName = hostMember?.name ?? "主催者";
    const appTitleSched = (await db.select({ appTitle: schema.cardDesigns.appTitle }).from(schema.cardDesigns).get())?.appTitle ?? "白樺クエスト";

    new MailService(db, c.env).send("meeting_response_guest", emailInput, {
      appTitle: appTitleSched,
      guestName,
      hostName,
      meetingTitle: meeting.title,
      scheduleUrl,
    }).catch(console.error);
  }

  const appUrl = c.env.CORS_ORIGIN ?? "https://shirakaba-quest.pages.dev";

  return c.json({ ok: true, scheduleUrl: `${appUrl}/schedule/${token}` });
});

// ================================================================
// 共有招待URL（1つのURLを全員で共有。回答時に新規ゲスト生成）
// GET  /api/schedule/invite/:inviteToken  — ミーティング情報取得
// POST /api/schedule/invite/:inviteToken/respond — 新規ゲスト作成＋回答
// ================================================================

scheduleRoutes.get("/invite/:inviteToken", async (c) => {
  const db = createDb(c.env.DB);
  const { inviteToken } = c.req.param();

  const meeting = await db
    .select()
    .from(schema.meetings)
    .where(eq(schema.meetings.inviteToken, inviteToken))
    .get();

  if (!meeting) return c.json({ error: { code: "not_found", message: "このURLは無効です" } }, 404);
  if (meeting.status !== "open") {
    return c.json({ error: { code: "meeting_closed", message: "このミーティングは既に締め切られています" } }, 400);
  }

  const candidates = await db
    .select()
    .from(schema.meetingDateCandidates)
    .where(eq(schema.meetingDateCandidates.meetingId, meeting.id))
    .orderBy(schema.meetingDateCandidates.sortOrder)
    .all();

  const host = await db
    .select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji })
    .from(schema.members)
    .where(eq(schema.members.id, meeting.hostMemberId))
    .get();

  return c.json({
    data: {
      meeting: {
        id: meeting.id,
        title: meeting.title,
        description: meeting.description,
        status: meeting.status,
        host: host ?? null,
      },
      candidates: candidates.map((c) => ({
        id: c.id, startsAt: c.startsAt, endsAt: c.endsAt, note: c.note,
      })),
    },
  });
});

scheduleRoutes.post("/invite/:inviteToken/respond", async (c) => {
  const db = createDb(c.env.DB);
  const { inviteToken } = c.req.param();
  const now = Math.floor(Date.now() / 1000);

  const meeting = await db
    .select()
    .from(schema.meetings)
    .where(eq(schema.meetings.inviteToken, inviteToken))
    .get();

  if (!meeting) return c.json({ error: { code: "not_found", message: "このURLは無効です" } }, 404);
  if (meeting.status !== "open") {
    return c.json({ error: { code: "meeting_closed", message: "このミーティングは既に締め切られています" } }, 400);
  }

  const body = await c.req.json<{ name?: string; email?: string; answers: Record<string, "yes" | "maybe" | "no"> }>();
  const emailInput = body.email?.trim();
  if (!emailInput) {
    return c.json({ error: { code: "invalid_input", message: "メールアドレスを入力してください" } }, 400);
  }

  // 同じメールで既に回答済みなら既存レコードを返す（二重送信防止）
  const existing = await db
    .select()
    .from(schema.meetingExternalInvitees)
    .where(and(eq(schema.meetingExternalInvitees.meetingId, meeting.id), eq(schema.meetingExternalInvitees.email, emailInput)))
    .get();

  const { newId, generateRawToken } = await import("../services/auth.ts");

  let invitee = existing;
  if (!invitee) {
    // 新規ゲストを作成
    const personalToken = generateRawToken();
    const inviteeId = newId();
    await db.insert(schema.meetingExternalInvitees).values({
      id: inviteeId,
      meetingId: meeting.id,
      name: body.name?.trim() ?? "",
      email: emailInput,
      token: personalToken,
      createdAt: now,
    });
    invitee = { id: inviteeId, meetingId: meeting.id, name: body.name?.trim() ?? "", email: emailInput, token: personalToken, createdAt: now };
  } else if (body.name?.trim() && body.name.trim() !== invitee.name) {
    await db.update(schema.meetingExternalInvitees)
      .set({ name: body.name.trim() })
      .where(eq(schema.meetingExternalInvitees.id, invitee.id));
  }

  // 回答を upsert
  for (const [candidateId, availability] of Object.entries(body.answers)) {
    await db.delete(schema.meetingResponses).where(
      and(eq(schema.meetingResponses.candidateId, candidateId), eq(schema.meetingResponses.externalInviteeId, invitee.id))
    );
    await db.insert(schema.meetingResponses).values({
      id: newId(),
      meetingId: meeting.id,
      candidateId,
      memberId: null,
      externalInviteeId: invitee.id,
      availability,
      comment: null,
      respondedAt: now,
    });
  }

  const appUrl = c.env.CORS_ORIGIN ?? "https://shirakaba-quest.pages.dev";
  const personalScheduleUrl = `${appUrl}/schedule/${invitee.token}`;

  // 初回作成時のみ確認メールを送信
  if (!existing) {
    const hostMember = await db.select({ name: schema.members.name }).from(schema.members)
      .where(eq(schema.members.id, meeting.hostMemberId)).get();
    const appTitleInv = (await db.select({ appTitle: schema.cardDesigns.appTitle }).from(schema.cardDesigns).get())?.appTitle ?? "白樺クエスト";
    new MailService(db, c.env).send("meeting_response_guest", emailInput, {
      appTitle: appTitleInv,
      guestName: invitee.name || "ゲスト",
      hostName: hostMember?.name ?? "主催者",
      meetingTitle: meeting.title,
      scheduleUrl: personalScheduleUrl,
    }).catch(console.error);
  }

  return c.json({ ok: true, scheduleUrl: personalScheduleUrl });
});
