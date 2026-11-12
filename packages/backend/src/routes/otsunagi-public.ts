// =============================================================
// お繋ぎ（ご紹介）— 外部の人向けの受付ページ（認証不要）
// GET  /api/otsunagi/public/:token           → ご紹介の内容と、日程の準備の状況
// POST /api/otsunagi/public/:token/open      → ページを開いたことの記録（紹介者の進捗に「相手が開いた」と出すため）
// POST /api/otsunagi/public/:token/register  → 外部の人が、自分でメールアドレスを登録する（日程の準備ができたらメールで知らせる）
// URLは、お繋ぎを作った時点で決まり、変わらない。日程の準備が進むと、同じURLの中身が変わる
// =============================================================
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { invitePagePath, loadStage, type OtsunagiStage } from "../services/otsunagi.ts";
import type { Env, Variables } from "../types.ts";

export const otsunagiPublicRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type GuestState = "waiting" | "ready" | "confirmed" | "declined" | "cancelled" | "expired";
const STATE_OF_STAGE: Record<OtsunagiStage, GuestState> = {
  waiting_member: "waiting",
  booking_cancelled: "waiting", // 決まった日程が取り消された。メンバーが改めて準備するのを待つ
  arranging: "ready",
  confirmed: "confirmed",
  done: "confirmed",
  declined: "declined",
  cancelled: "cancelled",
  expired: "expired",
};

async function loadByToken(db: ReturnType<typeof createDb>, token: string) {
  return db.select().from(schema.otsunagiRequests).where(eq(schema.otsunagiRequests.token, token)).get();
}

otsunagiPublicRoutes.get("/:token", async (c) => {
  const db = createDb(c.env.DB);
  const row = await loadByToken(db, c.req.param("token"));
  if (!row) return c.json({ error: { code: "not_found", message: "このご案内は見つかりません。URLをご確認ください" } }, 404);

  const ctx = await loadStage(db, row);
  const state = STATE_OF_STAGE[ctx.stage];
  const [introducer, member] = await Promise.all([
    db.select({ name: schema.members.name, emoji: schema.members.emoji }).from(schema.members).where(eq(schema.members.id, row.introducerMemberId)).get(),
    // お繋ぎ先のメンバーは、「誰でも見える」情報（名前・職種・事業内容）だけを見せる。会社名・連絡先などの名刺情報は見せない
    db.select({
      name: schema.members.name, emoji: schema.members.emoji, category: schema.members.category, businessDescription: schema.members.businessDescription,
    }).from(schema.members).where(eq(schema.members.id, row.memberId)).get(),
  ]);

  const confirmed = state === "confirmed" && ctx.booking && ctx.booking.status === "confirmed"
    ? {
        startAtUtc: ctx.booking.startAtUtc, endAtUtc: ctx.booking.endAtUtc,
        conferenceType: ctx.booking.conferenceType, conferenceUrl: ctx.booking.conferenceUrl,
        confirmationPath: `/book/confirmation/${ctx.booking.cancellationToken}`,
      }
    : null;

  return c.json({
    data: {
      state,
      guestName: row.guestName,
      introducerName: introducer?.name ?? "メンバー",
      introducerEmoji: introducer?.emoji ?? "🙂",
      memberName: member?.name ?? "メンバー",
      memberEmoji: member?.emoji ?? "🙂",
      memberCategory: member?.category ?? "",
      memberBusiness: member?.businessDescription ?? "",
      message: row.message,
      // メールアドレスは返さない。登録済みかどうかだけ
      emailRegistered: row.guestEmail !== "",
      expiresAt: row.expiresAt,
      // 日程を選ぶページ（予約ページ／候補日）。準備ができているときだけ
      schedulePath: state === "ready" && ctx.invite ? invitePagePath(ctx.invite) : null,
      confirmed,
    },
  });
});

otsunagiPublicRoutes.post("/:token/open", async (c) => {
  const db = createDb(c.env.DB);
  const row = await loadByToken(db, c.req.param("token"));
  if (!row) return c.json({ error: { code: "not_found", message: "このご案内は見つかりません" } }, 404);
  if (row.guestOpenedAt === null) {
    const now = Math.floor(Date.now() / 1000);
    await db.update(schema.otsunagiRequests).set({ guestOpenedAt: now }).where(eq(schema.otsunagiRequests.id, row.id));
  }
  return c.json({ ok: true });
});

otsunagiPublicRoutes.post("/:token/register", async (c) => {
  const db = createDb(c.env.DB);
  const row = await loadByToken(db, c.req.param("token"));
  if (!row) return c.json({ error: { code: "not_found", message: "このご案内は見つかりません" } }, 404);

  const body = await c.req.json<{ email?: string }>().catch(() => ({} as { email?: string }));
  const email = (body.email ?? "").trim();
  if (!EMAIL_RE.test(email)) return c.json({ error: { code: "bad_request", message: "メールアドレスの形式が正しくありません。もう一度ご確認ください" } }, 400);

  const ctx = await loadStage(db, row);
  if (!["waiting_member", "booking_cancelled", "arranging"].includes(ctx.stage)) {
    return c.json({ error: { code: "invalid_status", message: "このご案内は、すでに終了しているため、メールアドレスを登録できません" } }, 400);
  }
  // すでにメールアドレスが入っているときは、上書きしない（URLを知っていれば誰でも書き換えられてしまうため）
  if (row.guestEmail !== "") return c.json({ data: { registered: true, alreadyRegistered: true } });

  const now = Math.floor(Date.now() / 1000);
  await db.update(schema.otsunagiRequests).set({ guestEmail: email, guestEmailRegisteredAt: now, updatedAt: now }).where(eq(schema.otsunagiRequests.id, row.id));
  // 日程を選ぶページでも、入力済みとして表示できるようにする
  if (ctx.invite && ctx.invite.status === "pending") {
    await db.update(schema.oneOnOneGuestInvites).set({ guestEmail: email })
      .where(and(eq(schema.oneOnOneGuestInvites.id, ctx.invite.id), eq(schema.oneOnOneGuestInvites.status, "pending")));
  }
  return c.json({ data: { registered: true, alreadyRegistered: false } });
});
