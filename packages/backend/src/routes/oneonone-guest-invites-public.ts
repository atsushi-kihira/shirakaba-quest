// =============================================================
// 外部ゲスト招待の公開ルート（認証不要）— 招待された本人がリンクを開いて候補日から選ぶ
// GET  /api/oneonone/guest/:token         → 招待内容の確認
// POST /api/oneonone/guest/:token/select  → 候補日を選んで予約確定
// =============================================================
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { createBookingForConfirmedSlot } from "../services/bookingCreation.ts";
import { getAvailableConferenceTypes } from "../services/conferenceService.ts";
import type { Env, Variables } from "../types.ts";

export const oneOnOneGuestInvitePublicRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

async function loadInviteByToken(db: ReturnType<typeof createDb>, token: string) {
  const invite = await db
    .select()
    .from(schema.oneOnOneGuestInvites)
    .where(eq(schema.oneOnOneGuestInvites.token, token))
    .get();
  if (!invite) return null;
  const host = await db
    .select({ name: schema.members.name, emoji: schema.members.emoji })
    .from(schema.members)
    .where(eq(schema.members.id, invite.hostMemberId))
    .get();
  return { invite, host };
}

// ---- GET /api/oneonone/guest/:token ----
oneOnOneGuestInvitePublicRoutes.get("/:token", async (c) => {
  const db = createDb(c.env.DB);
  const token = c.req.param("token");
  const result = await loadInviteByToken(db, token);
  if (!result) return c.json({ error: { code: "not_found", message: "招待が見つかりません" } }, 404);
  const { invite, host } = result;

  const now = Math.floor(Date.now() / 1000);
  const effectiveStatus = invite.status === "pending" && invite.expiresAt <= now ? "expired" : invite.status;

  const candidateSlots = effectiveStatus === "pending" && invite.arrangementMethod === "candidates"
    ? await db
        .select()
        .from(schema.oneOnOneGuestInviteCandidateSlots)
        .where(eq(schema.oneOnOneGuestInviteCandidateSlots.inviteId, invite.id))
        .orderBy(schema.oneOnOneGuestInviteCandidateSlots.sortOrder)
        .all()
    : [];

  const availableConferenceTypes = effectiveStatus === "pending"
    ? await getAvailableConferenceTypes(db, invite.hostMemberId)
    : [];

  return c.json({
    data: {
      status: effectiveStatus,
      hostName: host?.name ?? "メンバー",
      hostEmoji: host?.emoji ?? "🙂",
      displayTitle: invite.customTitle,
      durationMinutes: invite.customDurationMinutes,
      // 招待作成時に相手の名前・メールが分かっていない場合は空文字になる（この画面で本人に入力してもらう）
      guestName: invite.guestName,
      guestEmail: invite.guestEmail,
      availableConferenceTypes,
      // startAt/endAt は unix秒（ISO文字列ではない）
      candidateSlots: candidateSlots.map((s) => ({ id: s.id, startAt: s.startsAt, endAt: s.endsAt })),
    },
  });
});

// ---- POST /api/oneonone/guest/:token/select ----
oneOnOneGuestInvitePublicRoutes.post("/:token/select", async (c) => {
  const db = createDb(c.env.DB);
  const token = c.req.param("token");
  const result = await loadInviteByToken(db, token);
  if (!result) return c.json({ error: { code: "not_found", message: "招待が見つかりません" } }, 404);
  const { invite, host } = result;
  if (!host) return c.json({ error: { code: "not_found", message: "招待した方が見つかりません" } }, 404);

  const now = Math.floor(Date.now() / 1000);
  if (invite.status !== "pending" || invite.expiresAt <= now) {
    return c.json({ error: { code: "invalid_status", message: "この招待はすでに無効になっています" } }, 400);
  }
  if (invite.arrangementMethod !== "candidates") {
    return c.json({ error: { code: "bad_request", message: "この招待は候補日提示方式ではありません" } }, 400);
  }

  const body = await c.req.json<{
    candidateSlotId?: string;
    guestName?: string;
    guestEmail?: string;
    guestMessage?: string;
    guestCompany?: string;
    conferenceType?: "google_meet" | "zoom" | "manual";
  }>();
  if (!body.candidateSlotId) {
    return c.json({ error: { code: "bad_request", message: "候補日を指定してください" } }, 400);
  }

  // 招待作成時に分かっていた名前・メールは画面側で入力済み表示にしているが、本人が
  // その場で修正して送ってきた場合はその内容を優先する（通常は修正不要だが、変更を許可する）
  const finalGuestName = body.guestName?.trim() || invite.guestName || "";
  const finalGuestEmail = body.guestEmail?.trim() || invite.guestEmail || "";
  if (!finalGuestName || !finalGuestEmail) {
    return c.json({ error: { code: "bad_request", message: "お名前・メールアドレスを入力してください" } }, 400);
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(finalGuestEmail)) {
    return c.json({ error: { code: "bad_request", message: "メールアドレスの形式が正しくありません" } }, 400);
  }

  const slot = await db
    .select()
    .from(schema.oneOnOneGuestInviteCandidateSlots)
    .where(eq(schema.oneOnOneGuestInviteCandidateSlots.id, body.candidateSlotId))
    .get();
  if (!slot || slot.inviteId !== invite.id) {
    return c.json({ error: { code: "not_found", message: "候補日が見つかりません" } }, 404);
  }

  const hostMember = await db
    .select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
    .from(schema.members)
    .where(eq(schema.members.id, invite.hostMemberId))
    .get();
  if (!hostMember) return c.json({ error: { code: "not_found", message: "招待した方が見つかりません" } }, 404);

  const startAtUtc = new Date(slot.startsAt * 1000).toISOString();
  const endAtUtc = new Date(slot.endsAt * 1000).toISOString();

  // 会議ツールは、連携済みが2種類ある場合はゲストが選んだもの（未指定ならZoomを優先）、1種類ならそれ、
  // 0種類ならmanualにする。ホスト・ゲストどちらも選ばずに常にGoogle Meetへ固定されることがないようにする。
  const availableConferenceTypes = await getAvailableConferenceTypes(db, hostMember.id);
  const defaultConferenceType: "google_meet" | "zoom" | undefined = availableConferenceTypes.includes("zoom")
    ? "zoom"
    : availableConferenceTypes[0];
  const requestedConferenceType = availableConferenceTypes.length === 0
    ? "manual" as const
    : availableConferenceTypes.length === 1
      ? availableConferenceTypes[0]
      : (body.conferenceType && availableConferenceTypes.includes(body.conferenceType as "google_meet" | "zoom")
          ? body.conferenceType
          : defaultConferenceType!);

  const bookingResult = await createBookingForConfirmedSlot({
    db,
    env: c.env,
    hostMemberId: hostMember.id,
    hostName: hostMember.name,
    hostEmail: hostMember.email,
    guestName: finalGuestName,
    guestEmail: finalGuestEmail,
    guestMessage: body.guestMessage,
    guestCompany: body.guestCompany,
    startAtUtc,
    endAtUtc,
    timezone: "Asia/Tokyo",
    requestedConferenceType,
    conferenceSummary: invite.customTitle || `${hostMember.name}さんと${finalGuestName}さんの1to1`,
    displayTitle: invite.customTitle || "1to1 ミーティング",
    guestInviteId: invite.id,
    source: "guest_invite",
  });

  await db
    .update(schema.oneOnOneGuestInvites)
    .set({
      status: "selected",
      selectedSlotId: slot.id,
      resultingBookingId: bookingResult.bookingId,
      // 招待作成時に未入力だった場合、本人がここで入力した名前・メールを記録として残す
      guestName: finalGuestName,
      guestEmail: finalGuestEmail,
    })
    .where(eq(schema.oneOnOneGuestInvites.id, invite.id));

  return c.json({
    data: {
      bookingId: bookingResult.bookingId,
      cancellationToken: bookingResult.cancellationToken,
      conferenceType: bookingResult.conferenceType,
      conferenceUrl: bookingResult.conferenceUrl,
      startAtUtc,
      endAtUtc,
    },
  }, 201);
});
