// =============================================================
// 外部ゲスト（未登録者）を名前・メールで指定して1to1を招待するルート（認証必須）
// POST   /api/oneonone/guest-invites     → 招待作成
// GET    /api/oneonone/guest-invites     → 自分が発行した招待の一覧（招待URLを後から確認するため）
// DELETE /api/oneonone/guest-invites     → 未確定（pending）の招待をまとめて削除
// DELETE /api/oneonone/guest-invites/:id → 招待を1件削除
// =============================================================
import { Hono } from "hono";
import { eq, and, desc, inArray } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { candidateEndSeconds } from "../services/candidate-length.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId, generateUrlSafeToken } from "../services/auth.ts";
import { MailService } from "../services/mailer.ts";
import { getFrontendUrl } from "../services/frontendUrl.ts";
import { getSchedulerLinkValidityHours } from "../services/schedulerShareToken.ts";
import { isGoogleCalendarConnected } from "../services/conferenceService.ts";
import { listOneOnOneEvents, resolveOneOnOneEvent } from "../services/oneonone-event.ts";
import { resolveEffectiveMemberId, isMemberApproved } from "../services/resolve-member.ts";
import type { Env, Variables } from "../types.ts";

export const oneOnOneGuestInviteRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
oneOnOneGuestInviteRoutes.use("*", authMiddleware);

const MIN_ONEONONE_CANDIDATES = 2;
const MAX_ONEONONE_CANDIDATES = 5;

type CandidateSlotInput = { startAtUtc: string; endAtUtc: string };

function validateCandidateSlots(candidateSlots: CandidateSlotInput[] | undefined, durationMinutes?: number): { error: string } | { slots: { startsAt: number; endsAt: number }[] } {
  if (!candidateSlots || candidateSlots.length < MIN_ONEONONE_CANDIDATES || candidateSlots.length > MAX_ONEONONE_CANDIDATES) {
    return { error: `候補日は${MIN_ONEONONE_CANDIDATES}〜${MAX_ONEONONE_CANDIDATES}件で指定してください` };
  }
  const slots: { startsAt: number; endsAt: number }[] = [];
  for (const slot of candidateSlots) {
    const startMs = new Date(slot.startAtUtc).getTime();
    const endMs = new Date(slot.endAtUtc).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      return { error: "候補日時の指定が正しくありません" };
    }
    if (startMs <= Date.now()) {
      return { error: "過去の日時は候補日にできません" };
    }
    // 終了時刻は、開始＋共通の所要時間にそろえる（極端に長い候補は作らせない）
    const startsAt = Math.floor(startMs / 1000);
    slots.push({ startsAt, endsAt: candidateEndSeconds(startsAt, Math.floor(endMs / 1000), durationMinutes) ?? startsAt + 3600 });
  }
  return { slots };
}

// ---- POST /api/oneonone/guest-invites ----
oneOnOneGuestInviteRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const hostMemberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!hostMemberId) {
    return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないため1to1を招待できません" } }, 403);
  }
  if (!(await isMemberApproved(db, hostMemberId))) {
    return c.json({ error: { code: "not_approved", message: "承認されるまでは外部ゲストへの1to1招待はご利用いただけません" } }, 403);
  }

  const body = await c.req.json<{
    guestName?: string;
    guestEmail?: string;
    arrangementMethod: "public_url" | "candidates";
    candidateSlots?: CandidateSlotInput[];
    title?: string;
    durationMinutes?: number;
    note?: string;
    notifyByEmail?: boolean;
    /** 結びつける1to1イベント（ビジターとの1to1向け） */
    eventCampaignId?: string;
  }>();

  if (body.arrangementMethod !== "public_url" && body.arrangementMethod !== "candidates") {
    return c.json({ error: { code: "bad_request", message: "日程の決め方の指定が正しくありません" } }, 400);
  }

  // メールで案内する場合は、宛先を特定するために名前・メールアドレスを必須にする。
  // 公開予約URL方式は、招待ごとに固定の専用URLを発行する（ローテーションしない）ため、
  // 誰宛のURLかを予約ページ側で示せるよう、メール案内の有無に関わらず名前は必須にする
  // （候補日提示方式は案内しない場合、相手自身がリンクを開いた際に名前を入力してもらう）。
  const notifyByEmail = body.notifyByEmail === true;
  const nameRequired = notifyByEmail || body.arrangementMethod === "public_url";
  if (nameRequired && !body.guestName?.trim()) {
    return c.json({ error: { code: "bad_request", message: "招待する相手の名前を入力してください" } }, 400);
  }
  if (notifyByEmail && !body.guestEmail?.trim()) {
    return c.json({ error: { code: "bad_request", message: "メールで案内する場合は、相手のメールアドレスを入力してください" } }, 400);
  }
  if (body.guestEmail?.trim()) {
    // メール案内しない場合でも、メールアドレスを入力したなら形式だけは検証する
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(body.guestEmail)) {
      return c.json({ error: { code: "bad_request", message: "メールアドレスの形式が正しくありません" } }, 400);
    }
  }
  if (body.arrangementMethod === "public_url" && !(await isGoogleCalendarConnected(db, hostMemberId))) {
    return c.json({
      error: { code: "not_connected", message: "公開予約URLを使うにはGoogleカレンダーとの連携が必要です。先に「マイページ→日程調整設定→外部サービス連携」で連携してください。" },
    }, 400);
  }
  let candidateSlotsToInsert: { startsAt: number; endsAt: number }[] = [];
  if (body.arrangementMethod === "candidates") {
    const validated = validateCandidateSlots(body.candidateSlots, body.durationMinutes);
    if ("error" in validated) return c.json({ error: { code: "bad_request", message: validated.error } }, 400);
    candidateSlotsToInsert = validated.slots;
  }

  let customDurationMinutes: number | null = null;
  if (body.durationMinutes !== undefined) {
    if (!Number.isFinite(body.durationMinutes) || body.durationMinutes < 5 || body.durationMinutes > 720) {
      return c.json({ error: { code: "bad_request", message: "所要時間の指定が正しくありません" } }, 400);
    }
    customDurationMinutes = Math.round(body.durationMinutes);
  }

  // 結びつける1to1イベント（ビジターとの1to1向け）。未指定なら先頭のイベント（なければなし）
  let eventCampaignId: string | null = null;
  if (body.eventCampaignId) {
    eventCampaignId = await resolveOneOnOneEvent(db, body.eventCampaignId, "visitor");
    if (!eventCampaignId) {
      return c.json({ error: { code: "bad_request", message: "選んだイベントは、現在は使えません（終了または削除されています）。選び直してください" } }, 400);
    }
  } else {
    eventCampaignId = (await listOneOnOneEvents(db, "visitor"))[0]?.id ?? null;
  }

  const now = Math.floor(Date.now() / 1000);
  const id = newId();
  const token = generateUrlSafeToken();
  const validityHours = await getSchedulerLinkValidityHours(db);
  const expiresAt = now + validityHours * 3600;

  const guestName = body.guestName?.trim() ?? "";
  const guestEmail = body.guestEmail?.trim() ?? "";

  await db.insert(schema.oneOnOneGuestInvites).values({
    id,
    hostMemberId,
    guestName,
    guestEmail,
    token,
    arrangementMethod: body.arrangementMethod,
    status: "pending",
    expiresAt,
    customTitle: body.title?.trim() || null,
    customDurationMinutes,
    customNote: body.note?.trim() || null,
    eventCampaignId,
    createdAt: now,
  });

  if (candidateSlotsToInsert.length > 0) {
    await db.insert(schema.oneOnOneGuestInviteCandidateSlots).values(
      candidateSlotsToInsert.map((slot, i) => ({
        id: newId(),
        inviteId: id,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        sortOrder: i,
        createdAt: now,
      }))
    );
  }

  // 公開予約URL方式は、招待の固定トークンをそのまま予約ページのURLとして使う
  // （汎用のマイページ公開URLとは異なる、この招待専用の固定URL。コピーしても切り替わらない）。
  const frontendUrl = getFrontendUrl(c.env);
  const inviteUrl = body.arrangementMethod === "public_url"
    ? `${frontendUrl}/book/${token}`
    : `${frontendUrl}/oneonone/guest/${token}`;

  if (notifyByEmail && guestEmail) {
    try {
      const host = await db.select({ name: schema.members.name }).from(schema.members).where(eq(schema.members.id, hostMemberId)).get();
      const design = await db.select().from(schema.cardDesigns).get();
      await new MailService(db, c.env).send("oneonone_guest_invite", guestEmail, {
        appTitle: design?.appTitle ?? "白樺クエスト",
        guestName: guestName || "ゲスト",
        hostName: host?.name ?? "メンバー",
        inviteUrl,
        noteBlock: body.note ? `💬 メッセージ：${body.note}\n\n` : "",
      });
    } catch (err) {
      console.error("[oneonone-guest-invites] 招待メール送信失敗", err);
    }
  }

  return c.json({ data: { id, status: "pending", arrangementMethod: body.arrangementMethod, inviteUrl, expiresAt, guestName, emailSent: notifyByEmail && !!guestEmail } }, 201);
});

// ---- GET /api/oneonone/guest-invites ----
// 自分が発行した招待の一覧を返す。招待作成直後の画面を閉じてしまっても、
// あとから招待URLを確認してDM等で改めて送れるようにするため。
oneOnOneGuestInviteRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const hostMemberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!hostMemberId) {
    return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないため利用できません" } }, 403);
  }

  const invites = await db
    .select()
    .from(schema.oneOnOneGuestInvites)
    .where(eq(schema.oneOnOneGuestInvites.hostMemberId, hostMemberId))
    .orderBy(desc(schema.oneOnOneGuestInvites.createdAt))
    .limit(30)
    .all();

  const now = Math.floor(Date.now() / 1000);
  const frontendUrl = getFrontendUrl(c.env);

  const data = invites.map((invite) => {
    const effectiveStatus = invite.status === "pending" && invite.expiresAt <= now ? "expired" : invite.status;

    const inviteUrl = effectiveStatus === "pending"
      ? (invite.arrangementMethod === "public_url"
          ? `${frontendUrl}/book/${invite.token}`
          : `${frontendUrl}/oneonone/guest/${invite.token}`)
      : null;

    return {
      id: invite.id,
      guestName: invite.guestName,
      guestEmail: invite.guestEmail,
      arrangementMethod: invite.arrangementMethod,
      status: effectiveStatus,
      customTitle: invite.customTitle,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      inviteUrl,
    };
  });

  return c.json({ data });
});

// ---- DELETE /api/oneonone/guest-invites ----
// 自分が発行した「未確定（pending）」の招待をまとめて削除する（一覧の「すべて削除」用）。
// 相手が既に候補を選んで確定した招待（selected）は履歴として残すため対象外。
// body.notify=true の場合、メールアドレスが分かっている招待については、
// 削除前にキャンセルの通知メールを送る。
oneOnOneGuestInviteRoutes.delete("/", async (c) => {
  const db = createDb(c.env.DB);
  const hostMemberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!hostMemberId) {
    return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないため利用できません" } }, 403);
  }
  const body = await c.req.json<{ notify?: boolean }>().catch(() => ({ notify: false }));

  const targets = await db
    .select({ id: schema.oneOnOneGuestInvites.id, guestName: schema.oneOnOneGuestInvites.guestName, guestEmail: schema.oneOnOneGuestInvites.guestEmail })
    .from(schema.oneOnOneGuestInvites)
    .where(and(eq(schema.oneOnOneGuestInvites.hostMemberId, hostMemberId), eq(schema.oneOnOneGuestInvites.status, "pending")))
    .all();
  if (targets.length === 0) return c.json({ data: { deletedCount: 0 } });

  if (body.notify) {
    await notifyGuestInvitesCancelled(db, c.env, hostMemberId, targets);
  }

  await db.delete(schema.oneOnOneGuestInviteCandidateSlots)
    .where(inArray(schema.oneOnOneGuestInviteCandidateSlots.inviteId, targets.map((t) => t.id)));
  await db.delete(schema.oneOnOneGuestInvites)
    .where(inArray(schema.oneOnOneGuestInvites.id, targets.map((t) => t.id)));

  return c.json({ data: { deletedCount: targets.length } });
});

// ---- DELETE /api/oneonone/guest-invites/:id ----
// 自分が発行した招待を1件削除する。相手が既に確定した予約自体（bookings）は削除しない
// （招待の管理レコードだけを消す。予約のキャンセルは既存の予約キャンセル機能を使う）。
// body.notify=true かつメールアドレスが分かっている場合、削除前にキャンセルの通知メールを送る。
oneOnOneGuestInviteRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const hostMemberId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!hostMemberId) {
    return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないため利用できません" } }, 403);
  }
  const id = c.req.param("id");
  const body = await c.req.json<{ notify?: boolean }>().catch(() => ({ notify: false }));

  const invite = await db
    .select({ id: schema.oneOnOneGuestInvites.id, hostMemberId: schema.oneOnOneGuestInvites.hostMemberId, guestName: schema.oneOnOneGuestInvites.guestName, guestEmail: schema.oneOnOneGuestInvites.guestEmail })
    .from(schema.oneOnOneGuestInvites)
    .where(eq(schema.oneOnOneGuestInvites.id, id))
    .get();
  if (!invite) return c.json({ error: { code: "not_found", message: "招待が見つかりません" } }, 404);
  if (invite.hostMemberId !== hostMemberId) return c.json({ error: { code: "forbidden", message: "権限がありません" } }, 403);

  if (body.notify) {
    await notifyGuestInvitesCancelled(db, c.env, hostMemberId, [invite]);
  }

  await db.delete(schema.oneOnOneGuestInviteCandidateSlots).where(eq(schema.oneOnOneGuestInviteCandidateSlots.inviteId, id));
  await db.delete(schema.oneOnOneGuestInvites).where(eq(schema.oneOnOneGuestInvites.id, id));

  return c.json({ data: { id, deleted: true } });
});

// メールアドレスが分かっている招待について、キャンセルの通知メールをまとめて送る
async function notifyGuestInvitesCancelled(
  db: ReturnType<typeof createDb>,
  env: Env,
  hostMemberId: string,
  invites: { guestName: string; guestEmail: string }[]
): Promise<void> {
  const targets = invites.filter((i) => i.guestEmail);
  if (targets.length === 0) return;

  const [host, design] = await Promise.all([
    db.select({ name: schema.members.name }).from(schema.members).where(eq(schema.members.id, hostMemberId)).get(),
    db.select().from(schema.cardDesigns).get(),
  ]);
  const mailer = new MailService(db, env);
  await Promise.all(targets.map((invite) =>
    mailer.send("oneonone_guest_invite_cancelled", invite.guestEmail, {
      appTitle: design?.appTitle ?? "白樺クエスト",
      guestName: invite.guestName || "ゲスト",
      hostName: host?.name ?? "メンバー",
    }).catch((err) => console.error("[oneonone-guest-invites] キャンセル通知メール送信失敗", err))
  ));
}
