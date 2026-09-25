// =============================================================
// 1to1 公開ルート（未ログインでのメール経由の辞退・候補日選択用）
// GET  /api/oneonone/public/:token                   → 申込内容の確認（認証不要）
// POST /api/oneonone/public/:token/reject             → 辞退（認証不要。承認という操作は廃止済み）
// POST /api/oneonone/public/:token/select-candidate  → 候補日から選んで確定（認証不要・候補日提示方式のみ）
// =============================================================
import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { getAvailableConferenceTypes } from "../services/conferenceService.ts";
import { createConferenceForOneOnOneSession } from "../services/oneOnOneConference.ts";
import { cancelConfirmedBooking } from "../services/bookingCancellation.ts";
import type { Env, Variables } from "../types.ts";

export const oneOnOnePublicRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

async function loadByToken(db: ReturnType<typeof createDb>, token: string) {
  const session = await db
    .select()
    .from(schema.oneOnOneSessions)
    .where(eq(schema.oneOnOneSessions.responseToken, token))
    .get();
  if (!session) return null;

  const [requester, responder] = await Promise.all([
    db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
      .from(schema.members).where(eq(schema.members.id, session.requesterId)).get(),
    // responder（回答者）本人にはこのページ内で名乗ってもらう必要がないよう、
    // 「これはあなた宛の申込です」と確認できる自分自身の情報（編集不可）を併せて返す
    db.select({
      id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor,
      company: schema.members.company, role: schema.members.role, category: schema.members.category, email: schema.members.email,
    })
      .from(schema.members).where(eq(schema.members.id, session.responderId)).get(),
  ]);

  const booking = await db
    .select({ conferenceType: schema.bookings.conferenceType, conferenceUrl: schema.bookings.conferenceUrl })
    .from(schema.bookings)
    .where(eq(schema.bookings.oneOnOneSessionId, session.id))
    .get();

  return { session, requester, responder, booking };
}

oneOnOnePublicRoutes.get("/:token", async (c) => {
  const db = createDb(c.env.DB);
  const token = c.req.param("token");
  const result = await loadByToken(db, token);
  if (!result) return c.json({ error: { code: "not_found", message: "申込が見つかりません" } }, 404);

  const { session, requester, responder, booking } = result;

  const isPendingCandidateSelection = session.arrangementMethod === "candidates" && session.status === "pending" && !session.selectedCandidateSlotId;
  const [candidateSlots, availableConferenceTypes] = await Promise.all([
    isPendingCandidateSelection
      ? db
          .select()
          .from(schema.oneOnOneCandidateSlots)
          .where(eq(schema.oneOnOneCandidateSlots.oneOnOneSessionId, session.id))
          .orderBy(schema.oneOnOneCandidateSlots.sortOrder)
          .all()
      : Promise.resolve([]),
    isPendingCandidateSelection ? getAvailableConferenceTypes(db, session.requesterId) : Promise.resolve([]),
  ]);

  return c.json({
    data: {
      status: session.status,
      requesterName: requester?.name ?? "メンバー",
      requesterEmoji: requester?.emoji ?? "🙂",
      responderName: responder?.name ?? "メンバー",
      responderCompany: responder?.company ?? null,
      responderRole: responder?.role ?? null,
      responderCategory: responder?.category ?? null,
      responderEmail: responder?.email ?? null,
      arrangementMethod: session.arrangementMethod,
      scheduledFor: session.scheduledFor,
      conferenceType: booking?.conferenceType ?? null,
      conferenceUrl: booking?.conferenceUrl ?? null,
      candidateSlots: candidateSlots.map((s) => ({ id: s.id, startAt: s.startsAt, endAt: s.endsAt })),
      availableConferenceTypes,
    },
  });
});

oneOnOnePublicRoutes.post("/:token/reject", async (c) => {
  const db = createDb(c.env.DB);
  const token = c.req.param("token");
  const result = await loadByToken(db, token);
  if (!result) return c.json({ error: { code: "not_found", message: "申込が見つかりません" } }, 404);

  const { session } = result;
  // 承認という操作は廃止したため、日時指定申込は最初から accepted で作成される。
  // 辞退は pending（候補日未選択）・accepted のどちらからでも行える。
  if (session.status !== "pending" && session.status !== "accepted") {
    return c.json({ data: { status: session.status, alreadyResolved: true } });
  }

  const now = Math.floor(Date.now() / 1000);
  await db.update(schema.oneOnOneSessions)
    .set({ status: "rejected", respondedAt: now })
    .where(eq(schema.oneOnOneSessions.id, session.id));

  // すでに日時確定済み（公開予約URL方式など）だった場合、自動発行済みの会議
  // （Googleカレンダー予定 / Zoomミーティング）を後始末する
  const linkedBooking = await db
    .select()
    .from(schema.bookings)
    .where(and(eq(schema.bookings.oneOnOneSessionId, session.id), eq(schema.bookings.status, "confirmed")))
    .get();
  if (linkedBooking) {
    await cancelConfirmedBooking(db, c.env, linkedBooking, {
      reason: "1to1申込が辞退されたため",
      actorKind: "member",
      actorId: session.responderId,
    });
  }

  return c.json({ data: { status: "rejected", alreadyResolved: false } });
});

oneOnOnePublicRoutes.post("/:token/select-candidate", async (c) => {
  const db = createDb(c.env.DB);
  const token = c.req.param("token");
  const result = await loadByToken(db, token);
  if (!result) return c.json({ error: { code: "not_found", message: "申込が見つかりません" } }, 404);

  const { session } = result;
  if (session.arrangementMethod !== "candidates") {
    return c.json({ error: { code: "bad_request", message: "この1to1は候補日提示方式ではありません" } }, 400);
  }
  if (session.status !== "pending") {
    return c.json({ data: { status: session.status, alreadyResolved: true } });
  }
  if (session.selectedCandidateSlotId) {
    return c.json({ error: { code: "already_selected", message: "既に日時を選択済みです" } }, 400);
  }

  const body = await c.req.json<{ candidateSlotId?: string; conferenceType?: "google_meet" | "zoom" }>();
  if (!body.candidateSlotId) {
    return c.json({ error: { code: "bad_request", message: "候補日を指定してください" } }, 400);
  }

  const slot = await db
    .select()
    .from(schema.oneOnOneCandidateSlots)
    .where(and(eq(schema.oneOnOneCandidateSlots.id, body.candidateSlotId), eq(schema.oneOnOneCandidateSlots.oneOnOneSessionId, session.id)))
    .get();
  if (!slot) return c.json({ error: { code: "not_found", message: "候補日が見つかりません" } }, 404);

  const availableTypes = await getAvailableConferenceTypes(db, session.requesterId);
  const resolvedConferenceType: "google_meet" | "zoom" | null = availableTypes.length === 0
    ? null
    : availableTypes.length === 1
      ? availableTypes[0]
      : (body.conferenceType && availableTypes.includes(body.conferenceType) ? body.conferenceType : null);
  if (availableTypes.length >= 2 && !resolvedConferenceType) {
    return c.json({ error: { code: "bad_request", message: "会議ツールを選択してください" } }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const update: { selectedCandidateSlotId: string; scheduledFor: number; status: "accepted"; respondedAt: number; conferenceUrlStatus?: string | null } = {
    selectedCandidateSlotId: slot.id, scheduledFor: slot.startsAt, status: "accepted", respondedAt: now,
  };

  let conferenceUrl: string | null = null;
  let resultConferenceType: string | null = null;
  if (resolvedConferenceType) {
    const [requester, responder] = await Promise.all([
      db.select({ name: schema.members.name, email: schema.members.email }).from(schema.members).where(eq(schema.members.id, session.requesterId)).get(),
      db.select({ name: schema.members.name, email: schema.members.email }).from(schema.members).where(eq(schema.members.id, session.responderId)).get(),
    ]);
    if (requester && responder) {
      try {
        const conferenceResult = await createConferenceForOneOnOneSession({
          db, env: c.env, sessionId: session.id,
          requesterId: session.requesterId, requesterName: requester.name, requesterEmail: requester.email,
          responderId: session.responderId, responderName: responder.name, responderEmail: responder.email,
          conferenceType: resolvedConferenceType,
          startAtUtc: new Date(slot.startsAt * 1000).toISOString(),
          endAtUtc: new Date(slot.endsAt * 1000).toISOString(),
        });
        conferenceUrl = conferenceResult.conferenceUrl;
        resultConferenceType = conferenceResult.conferenceType;
        update.conferenceUrlStatus = conferenceResult.conferenceUrlStatus;
      } catch (err) {
        // 会議URLの自動発行に失敗しても、日時の確定（承諾）自体は成立させる。
        // URLは「未解決」としてホーム画面のリマインダー対象にし、後から手動で入力できるようにする。
        console.error("[oneonone-public] select-candidate 会議URL発行失敗", err);
        update.conferenceUrlStatus = "unresolved";
      }
    }
  }

  // 候補から選ぶ行為自体が「承諾」を意味する（公開予約URL経由の確定と同様の扱い）
  await db.update(schema.oneOnOneSessions).set(update).where(eq(schema.oneOnOneSessions.id, session.id));
  await db.update(schema.connections)
    .set({ oneOnOneAcceptedAt: now })
    .where(and(eq(schema.connections.fromMemberId, session.requesterId), eq(schema.connections.toMemberId, session.responderId)));

  return c.json({ data: { status: "accepted", alreadyResolved: false, scheduledFor: slot.startsAt, conferenceType: resultConferenceType, conferenceUrl } });
});
