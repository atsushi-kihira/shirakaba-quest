// =============================================================
// お繋ぎ（ご紹介）— メンバー向け（認証必須）
// GET  /api/otsunagi              → 自分が紹介したお繋ぎ・自分に届いたお繋ぎの一覧
// GET  /api/otsunagi/summary      → ホームの表示用の件数
// POST /api/otsunagi              → お繋ぎを作る（紹介者）
// GET  /api/otsunagi/:id          → 1件の詳細（紹介者・お繋ぎ先のメンバーのどちらか）
// POST /api/otsunagi/:id/prepare  → 日程の決め方（予約ページ／候補日）を選ぶ（お繋ぎ先のメンバー）
// POST /api/otsunagi/:id/decline  → 見送る（お繋ぎ先のメンバー）
// POST /api/otsunagi/:id/cancel   → 取り消す（紹介者）
// 外部の人のメールアドレスは、紹介者・お繋ぎ先のメンバーのどちらにも返さない（「登録済みか」だけを返す）
// =============================================================
import { Hono } from "hono";
import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import type { Db } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { generateUrlSafeToken, newId } from "../services/auth.ts";
import { isGoogleCalendarConnected } from "../services/conferenceService.ts";
import { resolveEffectiveMemberId, isMemberApproved } from "../services/resolve-member.ts";
import {
  MAX_MESSAGE_LENGTH, OTSUNAGI_EXPIRY_DAYS, cancelOtsunagi, declineOtsunagi, invitePagePath, loadStage, loadStages,
  notifyOtsunagiCreated, prepareOtsunagi, receptionUrl, type OtsunagiRow, type OtsunagiStage, type StageContext,
} from "../services/otsunagi.ts";
import { validateCandidateSlots } from "./oneonone-guest-invites.ts";
import type { Env, Variables } from "../types.ts";

export const otsunagiRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
otsunagiRoutes.use("*", authMiddleware);

const DAY = 86_400;
const DAILY_LIMIT = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const bad = (message: string) => ({ error: { code: "bad_request", message } });

type PersonView = { id: string; name: string; emoji: string; bgColor: string };

async function loadPeople(db: Db, ids: string[]): Promise<Map<string, PersonView>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, PersonView>();
  for (let i = 0; i < unique.length; i += 50) {
    const rows = await db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
      .from(schema.members).where(inArray(schema.members.id, unique.slice(i, i + 50))).all();
    for (const r of rows) map.set(r.id, r);
  }
  return map;
}

function toView(row: OtsunagiRow, ctx: StageContext, people: Map<string, PersonView>, meId: string) {
  const introducer = people.get(row.introducerMemberId);
  const member = people.get(row.memberId);
  const confirmed = ctx.booking && (ctx.stage === "confirmed" || ctx.stage === "done")
    ? { startAtUtc: ctx.booking.startAtUtc, endAtUtc: ctx.booking.endAtUtc }
    : null;
  return {
    id: row.id,
    role: row.introducerMemberId === meId ? "introducer" as const : "member" as const,
    stage: ctx.stage,
    guestName: row.guestName,
    guestCompany: row.guestCompany,
    message: row.message,
    introducer: introducer ?? { id: row.introducerMemberId, name: "メンバー", emoji: "🙂", bgColor: "bg-amber-100" },
    member: member ?? { id: row.memberId, name: "メンバー", emoji: "🙂", bgColor: "bg-amber-100" },
    method: ctx.invite?.arrangementMethod ?? null,
    createdAt: row.createdAt,
    preparedAt: row.preparedAt,
    expiresAt: row.expiresAt,
    guestOpened: row.guestOpenedAt !== null,
    guestEmailRegistered: row.guestEmail !== "",
    confirmed,
  };
}

async function viewsFor(db: Db, rows: OtsunagiRow[], meId: string) {
  const [stages, people] = await Promise.all([
    loadStages(db, rows),
    loadPeople(db, rows.flatMap((r) => [r.introducerMemberId, r.memberId])),
  ]);
  return rows.map((r) => toView(r, stages.get(r.id)!, people, meId));
}

async function myApprovedId(c: { get: (k: "userId" | "userType") => never | string }, db: Db): Promise<string | null> {
  const id = await resolveEffectiveMemberId(db, c.get("userId") as string, c.get("userType") as "member" | "admin");
  if (!id) return null;
  return (await isMemberApproved(db, id)) ? id : null;
}

// ---- 一覧 ----
otsunagiRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await myApprovedId(c, db);
  if (!meId) return c.json({ data: { introduced: [], received: [] } });
  const rows = await db.select().from(schema.otsunagiRequests)
    .where(or(eq(schema.otsunagiRequests.introducerMemberId, meId), eq(schema.otsunagiRequests.memberId, meId)))
    .orderBy(desc(schema.otsunagiRequests.createdAt)).limit(200).all();
  const views = await viewsFor(db, rows, meId);
  return c.json({ data: { introduced: views.filter((v) => v.role === "introducer"), received: views.filter((v) => v.role === "member") } });
});

// ---- ホームの表示用の件数 ----
// needsAction: お繋ぎ先として、日程の決め方をまだ選んでいない（または、決まった日程が取り消された）もの
// inProgress: 自分が紹介して、まだ日程が決まっていないもの
otsunagiRoutes.get("/summary", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await myApprovedId(c, db);
  if (!meId) return c.json({ data: { needsAction: 0, inProgress: 0, needsActionItems: [] } });
  const rows = await db.select().from(schema.otsunagiRequests)
    .where(and(
      eq(schema.otsunagiRequests.status, "active"),
      gte(schema.otsunagiRequests.expiresAt, Math.floor(Date.now() / 1000)),
      or(eq(schema.otsunagiRequests.introducerMemberId, meId), eq(schema.otsunagiRequests.memberId, meId)),
    )).all();
  const stages = await loadStages(db, rows);
  const mine = rows.filter((r) => r.memberId === meId && ["waiting_member", "booking_cancelled"].includes(stages.get(r.id)!.stage));
  const inProgress = rows.filter((r) => r.introducerMemberId === meId && ["waiting_member", "arranging"].includes(stages.get(r.id)!.stage)).length;
  return c.json({ data: { needsAction: mine.length, inProgress, needsActionItems: mine.slice(0, 5).map((r) => ({ id: r.id, guestName: r.guestName })) } });
});

// ---- 作成（紹介者）----
otsunagiRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await myApprovedId(c, db);
  if (!meId) return c.json({ error: { code: "not_approved", message: "承認されるまでは、お繋ぎはご利用いただけません" } }, 403);

  const body = await c.req.json<{
    memberId?: string; guestName?: string; guestCompany?: string; guestEmail?: string; emailConsent?: boolean; message?: string;
  }>().catch(() => ({} as Record<string, never>));

  const memberId = (body.memberId ?? "").trim();
  const guestName = (body.guestName ?? "").trim();
  const guestCompany = (body.guestCompany ?? "").trim();
  const guestEmail = (body.guestEmail ?? "").trim();
  const message = (body.message ?? "").trim();

  if (!memberId) return c.json(bad("お繋ぎするメンバーを選んでください"), 400);
  if (memberId === meId) return c.json(bad("ご自身を、お繋ぎ先にはできません"), 400);
  if (!guestName) return c.json(bad("お繋ぎする相手（外部の方）のお名前を入力してください"), 400);
  if (guestName.length > 60 || guestCompany.length > 100) return c.json(bad("お名前・会社名が長すぎます"), 400);
  if (message.length > MAX_MESSAGE_LENGTH) return c.json(bad(`ひとことは${MAX_MESSAGE_LENGTH}文字以内で入力してください`), 400);
  if (guestEmail) {
    if (!EMAIL_RE.test(guestEmail)) return c.json(bad("メールアドレスの形式が正しくありません"), 400);
    // 相手の連絡先をお繋ぎ先のシステムで使うため、ご本人の了承を得ていることを、かならず確認する
    if (body.emailConsent !== true) return c.json(bad("メールアドレスを入力するときは、「ご本人の了承を得ています」にチェックを入れてください"), 400);
  }

  const target = await db.select({ id: schema.members.id, status: schema.members.status }).from(schema.members).where(eq(schema.members.id, memberId)).get();
  if (!target || target.status !== "active") return c.json(bad("選んだメンバーは、お繋ぎ先にできません。選び直してください"), 400);

  const now = Math.floor(Date.now() / 1000);
  const recent = await db.select({ id: schema.otsunagiRequests.id }).from(schema.otsunagiRequests)
    .where(and(eq(schema.otsunagiRequests.introducerMemberId, meId), gte(schema.otsunagiRequests.createdAt, now - DAY))).all();
  if (recent.length >= DAILY_LIMIT) return c.json(bad("1日にお繋ぎできる件数の上限に達しました。明日、改めてお試しください"), 400);

  const row: typeof schema.otsunagiRequests.$inferInsert = {
    id: newId(), introducerMemberId: meId, memberId, guestName, guestCompany: guestCompany || null,
    guestEmail, guestEmailConsent: guestEmail ? 1 : 0, message,
    token: generateUrlSafeToken(), status: "active",
    expiresAt: now + OTSUNAGI_EXPIRY_DAYS * DAY, createdAt: now, updatedAt: now,
  };
  await db.insert(schema.otsunagiRequests).values(row);
  const saved = (await db.select().from(schema.otsunagiRequests).where(eq(schema.otsunagiRequests.id, row.id!)).get())!;
  const { guestEmailSent } = await notifyOtsunagiCreated(db, c.env, saved);
  return c.json({ data: { id: saved.id, receptionUrl: receptionUrl(c.env, saved.token), guestEmailSent } }, 201);
});

// ---- 詳細 ----
async function loadMine(db: Db, id: string, meId: string): Promise<OtsunagiRow | null> {
  const row = await db.select().from(schema.otsunagiRequests).where(eq(schema.otsunagiRequests.id, id)).get();
  if (!row || (row.introducerMemberId !== meId && row.memberId !== meId)) return null;
  return row;
}

otsunagiRoutes.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await myApprovedId(c, db);
  if (!meId) return c.json({ error: { code: "not_approved", message: "承認されるまでは、お繋ぎはご利用いただけません" } }, 403);
  const row = await loadMine(db, c.req.param("id"), meId);
  if (!row) return c.json({ error: { code: "not_found", message: "お繋ぎが見つかりません" } }, 404);

  const [ctx, people] = await Promise.all([loadStage(db, row), loadPeople(db, [row.introducerMemberId, row.memberId])]);
  const view = toView(row, ctx, people, meId);
  const isIntroducer = row.introducerMemberId === meId;

  const candidateSlots = ctx.invite && ctx.invite.arrangementMethod === "candidates" && ctx.stage === "arranging"
    ? (await db.select().from(schema.oneOnOneGuestInviteCandidateSlots)
        .where(eq(schema.oneOnOneGuestInviteCandidateSlots.inviteId, ctx.invite.id))
        .orderBy(schema.oneOnOneGuestInviteCandidateSlots.sortOrder).all()).map((s) => ({ startAt: s.startsAt, endAt: s.endsAt }))
    : [];

  return c.json({
    data: {
      ...view,
      // 受付ページのURLは、外部の人に最初に送る人（紹介者）にだけ返す
      receptionUrl: isIntroducer ? receptionUrl(c.env, row.token) : null,
      // 決まった1to1の予約（お繋ぎ先のメンバーだけが、予約の詳細を開ける）
      bookingId: !isIntroducer && ctx.booking ? ctx.booking.id : null,
      candidateSlots: isIntroducer ? [] : candidateSlots,
      googleConnected: isIntroducer ? null : await isGoogleCalendarConnected(db, meId),
      invitePath: !isIntroducer && ctx.invite && ctx.stage === "arranging" ? invitePagePath(ctx.invite) : null,
    },
  });
});

// ---- 日程の決め方を選ぶ（お繋ぎ先のメンバー）----
otsunagiRoutes.post("/:id/prepare", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await myApprovedId(c, db);
  if (!meId) return c.json({ error: { code: "not_approved", message: "承認されるまでは、お繋ぎはご利用いただけません" } }, 403);
  const row = await loadMine(db, c.req.param("id"), meId);
  if (!row || row.memberId !== meId) return c.json({ error: { code: "not_found", message: "お繋ぎが見つかりません" } }, 404);

  const ctx = await loadStage(db, row);
  if (ctx.stage !== "waiting_member" && ctx.stage !== "booking_cancelled") {
    return c.json(bad("このお繋ぎは、日程の準備ができない状態です（すでに準備済み、見送り、期限切れなど）。画面を開き直してご確認ください"), 400);
  }

  const body = await c.req.json<{
    method?: "public_url" | "candidates";
    candidateSlots?: { startAtUtc: string; endAtUtc: string }[];
    durationMinutes?: number;
  }>().catch(() => ({} as Record<string, never>));
  if (body.method !== "public_url" && body.method !== "candidates") return c.json(bad("日程の決め方を選んでください"), 400);

  let durationMinutes: number | null = null;
  if (body.durationMinutes !== undefined) {
    if (!Number.isFinite(body.durationMinutes) || body.durationMinutes < 5 || body.durationMinutes > 720) return c.json(bad("所要時間の指定が正しくありません"), 400);
    durationMinutes = Math.round(body.durationMinutes);
  }
  let slots: { startsAt: number; endsAt: number }[] = [];
  if (body.method === "public_url") {
    if (!(await isGoogleCalendarConnected(db, meId))) {
      return c.json({ error: { code: "not_connected", message: "予約ページを使うには、Googleカレンダーとの連携が必要です。先に「マイページ→日程調整設定→外部サービス連携」で連携してください。" } }, 400);
    }
  } else {
    const validated = validateCandidateSlots(body.candidateSlots, durationMinutes ?? undefined);
    if ("error" in validated) return c.json(bad(validated.error), 400);
    slots = validated.slots;
  }

  const result = await prepareOtsunagi(db, c.env, row, { method: body.method, durationMinutes, slots });
  return c.json({ data: { inviteId: result.inviteId, guestEmailSent: result.guestEmailSent } });
});

// ---- 見送る（お繋ぎ先のメンバー）----
otsunagiRoutes.post("/:id/decline", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await myApprovedId(c, db);
  if (!meId) return c.json({ error: { code: "not_approved", message: "承認されるまでは、お繋ぎはご利用いただけません" } }, 403);
  const row = await loadMine(db, c.req.param("id"), meId);
  if (!row || row.memberId !== meId) return c.json({ error: { code: "not_found", message: "お繋ぎが見つかりません" } }, 404);
  const ctx = await loadStage(db, row);
  if (!["waiting_member", "arranging", "booking_cancelled"].includes(ctx.stage)) {
    return c.json(bad("このお繋ぎは、すでに終わっているため、見送れません"), 400);
  }
  await declineOtsunagi(db, c.env, row);
  return c.json({ data: { stage: "declined" satisfies OtsunagiStage } });
});

// ---- 取り消す（紹介者）----
otsunagiRoutes.post("/:id/cancel", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await myApprovedId(c, db);
  if (!meId) return c.json({ error: { code: "not_approved", message: "承認されるまでは、お繋ぎはご利用いただけません" } }, 403);
  const row = await loadMine(db, c.req.param("id"), meId);
  if (!row || row.introducerMemberId !== meId) return c.json({ error: { code: "not_found", message: "お繋ぎが見つかりません" } }, 404);
  const ctx = await loadStage(db, row);
  if (!["waiting_member", "arranging", "booking_cancelled", "expired"].includes(ctx.stage)) {
    return c.json(bad("日程が決まったあとや、すでに終わったお繋ぎは、取り消せません"), 400);
  }
  await cancelOtsunagi(db, row);
  return c.json({ data: { stage: "cancelled" satisfies OtsunagiStage } });
});
