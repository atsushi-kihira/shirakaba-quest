// =============================================================
// お繋ぎ（ご紹介）— 紹介者が、メンバーと外部の人をつなぐ
//
// 流れ
//   1. 紹介者が「お繋ぎ」を作る（お繋ぎ先のメンバー・外部の人・ひとこと）。以降、紹介者は途中で何もしない
//   2. お繋ぎ先のメンバーが、日程の決め方（予約ページ／候補日）を選ぶ → 既存の「外部ゲスト招待」を、そのメンバーが主催者として作る
//   3. 外部の人は、お繋ぎの受付ページ（作った時点でURLが決まる）から、日程を選ぶ。メールアドレスは、その場で自分で入力できる
//   4. 日程が決まると、紹介者に知らせる（紹介者は1to1に参加しないので、紹介者のカレンダー・会議URLには何も作らない）
//
// 状況（stage）は、保存せず、外部ゲスト招待・予約の状態から、そのつど導く（同期のずれをなくすため）
// =============================================================
import { and, eq, inArray, gt } from "drizzle-orm";
import { schema } from "../db/index.ts";
import type { Db } from "../db/index.ts";
import { generateUrlSafeToken, newId } from "./auth.ts";
import { formatBookingDateRange } from "./bookingCreation.ts";
import { getFrontendUrl } from "./frontendUrl.ts";
import { MailService } from "./mailer.ts";
import { listOneOnOneEvents } from "./oneonone-event.ts";
import type { Env } from "../types.ts";

export const OTSUNAGI_EXPIRY_DAYS = 14;
/** メンバーへの催促（お繋ぎが届いて、何日目か） */
const MEMBER_REMIND_DAYS = 2;
/** 外部の人への催促（日程の準備ができて、何日目か） */
const GUEST_REMIND_DAYS = [2, 7] as const;
const DAY = 86_400;
const SWEEP_LIMIT = 300;
const MAX_MESSAGE_LENGTH = 1000;

export { MAX_MESSAGE_LENGTH };

export type OtsunagiRow = typeof schema.otsunagiRequests.$inferSelect;
type InviteRow = typeof schema.oneOnOneGuestInvites.$inferSelect;
type BookingRow = typeof schema.bookings.$inferSelect;

/** お繋ぎの状況 */
export type OtsunagiStage =
  | "waiting_member"   // お繋ぎ先のメンバーが、まだ日程の決め方を選んでいない
  | "arranging"        // メンバーが準備を終え、外部の人の選択待ち
  | "confirmed"        // 日時が決まった
  | "done"             // 1to1の時刻を過ぎた
  | "booking_cancelled" // 決まった日時が取り消された（メンバーが、改めて準備できる）
  | "declined"         // メンバーが見送った
  | "cancelled"        // 紹介者が取り消した
  | "expired";         // 期限切れ

export type StageContext = { stage: OtsunagiStage; invite: InviteRow | null; booking: BookingRow | null };

export function deriveStage(row: OtsunagiRow, invite: InviteRow | null, booking: BookingRow | null, now: number): OtsunagiStage {
  if (row.status === "declined") return "declined";
  if (row.status === "cancelled") return "cancelled";
  // メンバーが外部ゲスト招待を削除した場合は、準備前に戻る
  const liveInvite = invite && invite.status !== "cancelled" ? invite : null;
  if (liveInvite?.status === "selected") {
    if (booking && booking.status === "confirmed") {
      return new Date(booking.endAtUtc).getTime() / 1000 < now ? "done" : "confirmed";
    }
    return "booking_cancelled";
  }
  if (row.expiresAt <= now) return "expired";
  return liveInvite ? "arranging" : "waiting_member";
}

/** 複数のお繋ぎの状況を、まとめて導く（D1の変数の上限があるので、小分けに調べる） */
export async function loadStages(db: Db, rows: OtsunagiRow[], now: number = Math.floor(Date.now() / 1000)): Promise<Map<string, StageContext>> {
  const inviteIds = [...new Set(rows.map((r) => r.guestInviteId).filter((x): x is string => !!x))];
  const invites = new Map<string, InviteRow>();
  for (let i = 0; i < inviteIds.length; i += 50) {
    const part = await db.select().from(schema.oneOnOneGuestInvites).where(inArray(schema.oneOnOneGuestInvites.id, inviteIds.slice(i, i + 50))).all();
    for (const r of part) invites.set(r.id, r);
  }
  const bookingIds = [...new Set([...invites.values()].map((i) => i.resultingBookingId).filter((x): x is string => !!x))];
  const bookings = new Map<string, BookingRow>();
  for (let i = 0; i < bookingIds.length; i += 50) {
    const part = await db.select().from(schema.bookings).where(inArray(schema.bookings.id, bookingIds.slice(i, i + 50))).all();
    for (const r of part) bookings.set(r.id, r);
  }
  const result = new Map<string, StageContext>();
  for (const row of rows) {
    const invite = row.guestInviteId ? invites.get(row.guestInviteId) ?? null : null;
    const booking = invite?.resultingBookingId ? bookings.get(invite.resultingBookingId) ?? null : null;
    result.set(row.id, { stage: deriveStage(row, invite, booking, now), invite, booking });
  }
  return result;
}

export async function loadStage(db: Db, row: OtsunagiRow): Promise<StageContext> {
  return (await loadStages(db, [row])).get(row.id)!;
}

// ---- URL ----
export function receptionUrl(env: Env, token: string): string {
  return `${getFrontendUrl(env)}/otsunagi/guest/${token}`;
}
export function detailUrl(env: Env, id: string): string {
  return `${getFrontendUrl(env)}/otsunagi/${id}`;
}
/** 外部の人が日程を選ぶページのパス（メンバーが決めた日程の決め方による） */
export function invitePagePath(invite: InviteRow): string {
  return invite.arrangementMethod === "public_url" ? `/book/${invite.token}` : `/oneonone/guest/${invite.token}`;
}

function formatDateLabel(sec: number): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(new Date(sec * 1000));
}

async function appTitleOf(db: Db): Promise<string> {
  return (await db.select({ appTitle: schema.cardDesigns.appTitle }).from(schema.cardDesigns).get())?.appTitle ?? "白樺クエスト";
}

type PersonLite = { id: string; name: string; email: string };
async function loadPerson(db: Db, memberId: string): Promise<PersonLite | null> {
  const m = await db.select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
    .from(schema.members).where(eq(schema.members.id, memberId)).get();
  return m ?? null;
}

function messageBlock(message: string): string {
  return message.trim() ? `💬 ひとこと：${message.trim()}\n\n` : "";
}

// ---- 作成時の通知 ----
/** お繋ぎを作った直後の知らせ（お繋ぎ先のメンバーへ。メールアドレスがわかっていれば、外部の人へも） */
export async function notifyOtsunagiCreated(db: Db, env: Env, row: OtsunagiRow): Promise<{ guestEmailSent: boolean }> {
  const [introducer, member, appTitle] = await Promise.all([loadPerson(db, row.introducerMemberId), loadPerson(db, row.memberId), appTitleOf(db)]);
  if (!introducer || !member) return { guestEmailSent: false };
  const mailer = new MailService(db, env);
  await mailer.send("otsunagi_member_request", member.email, {
    appTitle, memberName: member.name, introducerName: introducer.name, guestName: row.guestName,
    messageBlock: messageBlock(row.message), detailUrl: detailUrl(env, row.id),
  }, { push: { body: `${introducer.name}さんから、${row.guestName}さんとのお繋ぎが届きました。日程の決め方を選んでください`, url: `/otsunagi/${row.id}` } })
    .catch((e) => console.error("[otsunagi] member request mail failed", e));

  let guestEmailSent = false;
  if (row.guestEmail) {
    await mailer.send("otsunagi_guest_invite", row.guestEmail, {
      appTitle, guestName: row.guestName, introducerName: introducer.name, memberName: member.name,
      messageBlock: messageBlock(row.message), receptionUrl: receptionUrl(env, row.token),
    }).then(() => { guestEmailSent = true; }).catch((e) => console.error("[otsunagi] guest invite mail failed", e));
  }
  return { guestEmailSent };
}

// ---- 日程の準備（お繋ぎ先のメンバー）----
export type PrepareInput = {
  method: "public_url" | "candidates";
  durationMinutes: number | null;
  slots: { startsAt: number; endsAt: number }[];
};

/**
 * お繋ぎ先のメンバーが日程の決め方を選んだとき、そのメンバーを主催者とする外部ゲスト招待を作り、お繋ぎに結びつける。
 * 外部の人にメールアドレスがわかっていれば、「日程を選べるようになりました」と知らせる
 */
export async function prepareOtsunagi(db: Db, env: Env, row: OtsunagiRow, input: PrepareInput, now: number = Math.floor(Date.now() / 1000)): Promise<{ inviteId: string; guestEmailSent: boolean }> {
  const [introducer, member, appTitle] = await Promise.all([loadPerson(db, row.introducerMemberId), loadPerson(db, row.memberId), appTitleOf(db)]);
  const inviteId = newId();
  const expiresAt = now + OTSUNAGI_EXPIRY_DAYS * DAY;
  const eventCampaignId = (await listOneOnOneEvents(db, "visitor"))[0]?.id ?? null;
  const title = `${member?.name ?? "メンバー"}さんと${row.guestName}さんの1to1（${introducer?.name ?? "紹介者"}さんのご紹介）`;

  await db.insert(schema.oneOnOneGuestInvites).values({
    id: inviteId,
    hostMemberId: row.memberId,
    guestName: row.guestName,
    guestEmail: row.guestEmail,
    token: generateUrlSafeToken(),
    arrangementMethod: input.method,
    status: "pending",
    expiresAt,
    customTitle: title,
    customDurationMinutes: input.durationMinutes,
    customNote: row.message.trim() || null,
    eventCampaignId,
    createdAt: now,
  });
  if (input.method === "candidates" && input.slots.length > 0) {
    await db.insert(schema.oneOnOneGuestInviteCandidateSlots).values(
      input.slots.map((s, i) => ({ id: newId(), inviteId, startsAt: s.startsAt, endsAt: s.endsAt, sortOrder: i, createdAt: now }))
    );
  }
  // 古い招待（取り消された日程など）が残っていれば、使えないようにしておく
  if (row.guestInviteId) {
    await db.update(schema.oneOnOneGuestInvites).set({ status: "cancelled" })
      .where(and(eq(schema.oneOnOneGuestInvites.id, row.guestInviteId), eq(schema.oneOnOneGuestInvites.status, "pending")));
  }
  await db.update(schema.otsunagiRequests).set({
    guestInviteId: inviteId, preparedAt: now, expiresAt, confirmedNotifiedAt: null,
    guestRemind1At: null, guestRemind2At: null, updatedAt: now,
  }).where(eq(schema.otsunagiRequests.id, row.id));

  let guestEmailSent = false;
  if (row.guestEmail && member && introducer) {
    await new MailService(db, env).send("otsunagi_guest_ready", row.guestEmail, {
      appTitle, guestName: row.guestName, introducerName: introducer.name, memberName: member.name,
      receptionUrl: receptionUrl(env, row.token), expiresLabel: formatDateLabel(expiresAt),
    }).then(() => { guestEmailSent = true; }).catch((e) => console.error("[otsunagi] guest ready mail failed", e));
  }
  return { inviteId, guestEmailSent };
}

/** 進行中の外部ゲスト招待を、使えなくする（見送り・取り消し） */
async function closeInvite(db: Db, row: OtsunagiRow): Promise<void> {
  if (!row.guestInviteId) return;
  await db.update(schema.oneOnOneGuestInvites).set({ status: "cancelled" })
    .where(and(eq(schema.oneOnOneGuestInvites.id, row.guestInviteId), eq(schema.oneOnOneGuestInvites.status, "pending")));
}

/** お繋ぎ先のメンバーが見送る。紹介者に1回知らせる */
export async function declineOtsunagi(db: Db, env: Env, row: OtsunagiRow, now: number = Math.floor(Date.now() / 1000)): Promise<void> {
  await closeInvite(db, row);
  await db.update(schema.otsunagiRequests).set({ status: "declined", declinedAt: now, updatedAt: now }).where(eq(schema.otsunagiRequests.id, row.id));
  const [introducer, member, appTitle] = await Promise.all([loadPerson(db, row.introducerMemberId), loadPerson(db, row.memberId), appTitleOf(db)]);
  if (!introducer || !member) return;
  await new MailService(db, env).send("otsunagi_introducer_declined", introducer.email, {
    appTitle, introducerName: introducer.name, memberName: member.name, guestName: row.guestName, detailUrl: detailUrl(env, row.id),
  }, { push: { body: `${member.name}さんと${row.guestName}さんのお繋ぎは、今回は見送りになりました`, url: `/otsunagi/${row.id}` } })
    .catch((e) => console.error("[otsunagi] declined mail failed", e));
}

/** 紹介者が取り消す（相手には知らせない。受付ページは「無効」の表示になる） */
export async function cancelOtsunagi(db: Db, row: OtsunagiRow, now: number = Math.floor(Date.now() / 1000)): Promise<void> {
  await closeInvite(db, row);
  await db.update(schema.otsunagiRequests).set({ status: "cancelled", updatedAt: now }).where(eq(schema.otsunagiRequests.id, row.id));
}

// ---- 日時が決まったとき（予約ページ・候補日の選択から呼ぶ）----
/**
 * 外部ゲスト招待から日時が決まったとき、お繋ぎから作った招待であれば、紹介者に1回知らせる。
 * 紹介者は1to1に参加しないので、カレンダー・会議URLは何も作らず、日時を文章で伝えるだけにする。
 * お繋ぎと関係のない招待なら、何もしない。失敗しても、日時の確定には影響させない
 */
export async function onGuestInviteBooked(db: Db, env: Env, inviteId: string): Promise<void> {
  try {
    const row = await db.select().from(schema.otsunagiRequests).where(eq(schema.otsunagiRequests.guestInviteId, inviteId)).get();
    if (!row || row.confirmedNotifiedAt) return;
    const invite = await db.select().from(schema.oneOnOneGuestInvites).where(eq(schema.oneOnOneGuestInvites.id, inviteId)).get();
    const booking = invite?.resultingBookingId
      ? await db.select().from(schema.bookings).where(eq(schema.bookings.id, invite.resultingBookingId)).get()
      : null;
    if (!booking) return;
    const now = Math.floor(Date.now() / 1000);
    await db.update(schema.otsunagiRequests).set({ confirmedNotifiedAt: now, updatedAt: now }).where(eq(schema.otsunagiRequests.id, row.id));
    const [introducer, member, appTitle] = await Promise.all([loadPerson(db, row.introducerMemberId), loadPerson(db, row.memberId), appTitleOf(db)]);
    if (!introducer || !member) return;
    const dateRange = formatBookingDateRange(booking.startAtUtc, booking.endAtUtc, booking.timezone || "Asia/Tokyo");
    await new MailService(db, env).send("otsunagi_introducer_confirmed", introducer.email, {
      appTitle, introducerName: introducer.name, memberName: member.name, guestName: row.guestName, dateRange, detailUrl: detailUrl(env, row.id),
    }, { push: { body: `${member.name}さんと${row.guestName}さんの1to1が決まりました：${dateRange}`, url: `/otsunagi/${row.id}` } });
  } catch (e) {
    console.error("[otsunagi] confirmed notify failed", e);
  }
}

// ---- 毎時の定期実行：催促 ----
export type OtsunagiSweepResult = { memberReminders: number; guestReminders: number };

/**
 * 催促を送る（毎時の定期実行から呼ぶ。同じ催促は、1回しか送らない）
 *   ・メンバー：お繋ぎが届いて2日たっても、日程の決め方を選んでいないとき
 *   ・外部の人（メールアドレスがわかる場合）：日程の準備ができて2日後、7日後に、まだ日時を選んでいないとき
 * 期限（14日）を過ぎたものは、対象にしない
 */
export async function runOtsunagiSweep(db: Db, env: Env, now: number = Math.floor(Date.now() / 1000)): Promise<OtsunagiSweepResult> {
  const rows = await db.select().from(schema.otsunagiRequests)
    .where(and(eq(schema.otsunagiRequests.status, "active"), gt(schema.otsunagiRequests.expiresAt, now)))
    .limit(SWEEP_LIMIT).all();
  if (rows.length === 0) return { memberReminders: 0, guestReminders: 0 };
  const stages = await loadStages(db, rows, now);
  const appTitle = await appTitleOf(db);
  const mailer = new MailService(db, env);
  const result: OtsunagiSweepResult = { memberReminders: 0, guestReminders: 0 };

  for (const row of rows) {
    const stage = stages.get(row.id)?.stage;
    if (stage === "waiting_member" && !row.memberRemindedAt && now >= row.createdAt + MEMBER_REMIND_DAYS * DAY) {
      const [introducer, member] = await Promise.all([loadPerson(db, row.introducerMemberId), loadPerson(db, row.memberId)]);
      // 先に記録して、二重に送らない
      await db.update(schema.otsunagiRequests).set({ memberRemindedAt: now }).where(eq(schema.otsunagiRequests.id, row.id));
      if (introducer && member) {
        await mailer.send("otsunagi_member_reminder", member.email, {
          appTitle, memberName: member.name, introducerName: introducer.name, guestName: row.guestName, detailUrl: detailUrl(env, row.id),
        }, { push: { body: `${row.guestName}さんとのお繋ぎが、お待ちです。日程の決め方を選んでください`, url: `/otsunagi/${row.id}` } })
          .then(() => { result.memberReminders++; }).catch((e) => console.error("[otsunagi] member reminder failed", e));
      }
    }
    if (stage === "arranging" && row.guestEmail && row.preparedAt) {
      const due1 = !row.guestRemind1At && now >= row.preparedAt + GUEST_REMIND_DAYS[0] * DAY;
      const due2 = !row.guestRemind2At && row.guestRemind1At !== null && now >= row.preparedAt + GUEST_REMIND_DAYS[1] * DAY;
      const which = due2 ? 2 : due1 ? 1 : 0;
      if (which > 0) {
        const [introducer, member] = await Promise.all([loadPerson(db, row.introducerMemberId), loadPerson(db, row.memberId)]);
        // 1回目の時期をとうに過ぎて、2回目の時期にもなっているときは、2回目も送ったことにして、立て続けに送らない
        const skipSecond = which === 1 && now >= row.preparedAt + GUEST_REMIND_DAYS[1] * DAY;
        await db.update(schema.otsunagiRequests)
          .set(which === 1 ? { guestRemind1At: now, ...(skipSecond ? { guestRemind2At: now } : {}) } : { guestRemind2At: now })
          .where(eq(schema.otsunagiRequests.id, row.id));
        if (introducer && member) {
          await mailer.send("otsunagi_guest_reminder", row.guestEmail, {
            appTitle, guestName: row.guestName, introducerName: introducer.name, memberName: member.name,
            receptionUrl: receptionUrl(env, row.token), expiresLabel: formatDateLabel(row.expiresAt),
          }).then(() => { result.guestReminders++; }).catch((e) => console.error("[otsunagi] guest reminder failed", e));
        }
      }
    }
  }
  return result;
}

