// =============================================================
// 外部ゲスト向け 定例会の日程回答ルート（認証不要）
// GET  /api/schedule/series/:token                  — ゲスト専用ページ（投票中は候補パターン、確定後は開催日の一覧）
// POST /api/schedule/series/:token/respond          — 候補パターンへの投票（ゲスト専用URL）
// GET  /api/schedule/series-invite/:inviteToken     — 共有URLのページ（作成前は「準備中」）
// POST /api/schedule/series-invite/:inviteToken/respond — 共有URLから、名前・メールアドレスを入れて投票（ゲストを新規に作成）
// =============================================================
import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { newId, generateRawToken } from "../services/auth.ts";
import { MailService } from "../services/mailer.ts";
import { getFrontendUrl } from "../services/frontendUrl.ts";
import { PREPARING_MESSAGE, isReserved } from "../services/invite-reservations.ts";
import { isEmailLike, normalizeEmail, registerGuestAsContact } from "../services/guest-contacts.ts";
import { parseExtraSlots } from "../services/recurrence.ts";
import { patternLabel, upcomingDatesFor } from "./meeting-series.ts";
import type { Env, Variables } from "../types.ts";

type Availability = "yes" | "maybe" | "no";
type Db = ReturnType<typeof createDb>;
type Series = typeof schema.meetingSeries.$inferSelect;
type Invitee = typeof schema.meetingSeriesExternalInvitees.$inferSelect;

export const scheduleSeriesRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const AVAILABILITIES: Availability[] = ["yes", "maybe", "no"];
const closed = { error: { code: "series_closed", message: "この定例会は、すでに投票が締め切られています" } };

async function buildView(db: Db, series: Series, invitee: Invitee | null) {
  const now = Math.floor(Date.now() / 1000);
  const candidates = await db.select().from(schema.meetingSeriesPatternCandidates)
    .where(eq(schema.meetingSeriesPatternCandidates.seriesId, series.id))
    .orderBy(schema.meetingSeriesPatternCandidates.sortOrder).all();
  const [memberResponses, externalResponses, externals] = await Promise.all([
    db.select().from(schema.meetingSeriesResponses).where(eq(schema.meetingSeriesResponses.seriesId, series.id)).all(),
    db.select().from(schema.meetingSeriesExternalResponses).where(eq(schema.meetingSeriesExternalResponses.seriesId, series.id)).all(),
    db.select({ id: schema.meetingSeriesExternalInvitees.id, name: schema.meetingSeriesExternalInvitees.name })
      .from(schema.meetingSeriesExternalInvitees).where(eq(schema.meetingSeriesExternalInvitees.seriesId, series.id)).all(),
  ]);
  const memberIds = [...new Set(memberResponses.map((r) => r.memberId))];
  const members = memberIds.length > 0
    ? await db.select({ id: schema.members.id, name: schema.members.name }).from(schema.members).where(inArray(schema.members.id, memberIds)).all()
    : [];
  const nameOf = new Map<string, string>([...members.map((m) => [m.id, m.name] as const), ...externals.map((e) => [e.id, e.name || "ゲスト"] as const)]);

  const respondentsOf = (candidateId: string) => [
    ...memberResponses.filter((r) => r.candidateId === candidateId).map((r) => ({ name: nameOf.get(r.memberId) ?? "メンバー", availability: r.availability as Availability })),
    ...externalResponses.filter((r) => r.candidateId === candidateId).map((r) => ({ name: nameOf.get(r.externalInviteeId) ?? "ゲスト", availability: r.availability as Availability })),
  ];
  const myAnswers: Record<string, Availability> = {};
  if (invitee) for (const r of externalResponses) if (r.externalInviteeId === invitee.id) myAnswers[r.candidateId] = r.availability as Availability;

  // 確定後は、開催日の一覧
  let occurrences: Array<{ startsAt: number; endsAt: number | null; conferenceUrl: string | null }> = [];
  if (series.status === "confirmed" || series.status === "ended") {
    const meetingRows = await db.select().from(schema.meetings).where(eq(schema.meetings.seriesId, series.id)).all();
    const candIds = meetingRows.filter((m) => m.status !== "cancelled").map((m) => m.confirmedCandidateId).filter((x): x is string => !!x);
    const dates: Array<typeof schema.meetingDateCandidates.$inferSelect> = [];
    for (let i = 0; i < candIds.length; i += 50) {
      dates.push(...await db.select().from(schema.meetingDateCandidates).where(inArray(schema.meetingDateCandidates.id, candIds.slice(i, i + 50))).all());
    }
    occurrences = dates
      .map((d) => ({ startsAt: d.startsAt, endsAt: d.endsAt, conferenceUrl: d.conferenceUrl ?? series.conferenceUrl ?? null }))
      .sort((a, b) => a.startsAt - b.startsAt);
  }

  const host = await db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji })
    .from(schema.members).where(eq(schema.members.id, series.hostMemberId)).get();

  return {
    inviteeName: invitee?.name ?? "",
    inviteeEmail: invitee?.email ?? null,
    inviteeCompany: invitee?.company ?? "",
    series: { id: series.id, title: series.title, description: series.description, status: series.status, host: host ?? null },
    candidates: candidates.map((cand) => ({
      id: cand.id, note: cand.note, isConfirmed: cand.isConfirmed === 1,
      label: patternLabel({ ...cand, extraSlots: parseExtraSlots(cand.extraSlotsJson) }),
      upcomingDates: series.status === "voting" ? upcomingDatesFor(cand, series, now) : [],
      respondents: respondentsOf(cand.id),
    })),
    myAnswers,
    occurrences,
  };
}

/** 回答を保存（投票中のみ）。送られた候補パターンIDは、この定例会のものだけを受け付ける */
async function saveAnswers(db: Db, series: Series, inviteeId: string, answers: Record<string, unknown>, now: number): Promise<void> {
  const candidates = await db.select({ id: schema.meetingSeriesPatternCandidates.id }).from(schema.meetingSeriesPatternCandidates)
    .where(eq(schema.meetingSeriesPatternCandidates.seriesId, series.id)).all();
  const valid = new Set(candidates.map((c) => c.id));
  for (const [candidateId, availability] of Object.entries(answers ?? {})) {
    if (!valid.has(candidateId) || !AVAILABILITIES.includes(availability as Availability)) continue;
    await db.delete(schema.meetingSeriesExternalResponses).where(and(
      eq(schema.meetingSeriesExternalResponses.candidateId, candidateId), eq(schema.meetingSeriesExternalResponses.externalInviteeId, inviteeId)));
    await db.insert(schema.meetingSeriesExternalResponses).values({
      id: newId(), seriesId: series.id, candidateId, externalInviteeId: inviteeId, availability: availability as Availability, respondedAt: now,
    });
  }
}

async function sendBookmarkMail(c: { env: Env; executionCtx: ExecutionContext }, db: Db, series: Series, invitee: { name: string; token: string }, email: string) {
  const host = await db.select({ name: schema.members.name }).from(schema.members).where(eq(schema.members.id, series.hostMemberId)).get();
  const design = await db.select({ appTitle: schema.cardDesigns.appTitle }).from(schema.cardDesigns).get();
  c.executionCtx.waitUntil(
    new MailService(db, c.env).send("meeting_response_guest", email, {
      appTitle: design?.appTitle ?? "白樺クエスト", guestName: invitee.name || "ゲスト", hostName: host?.name ?? "主催者",
      meetingTitle: `【定例会】${series.title}`, scheduleUrl: `${getFrontendUrl(c.env)}/schedule/series/${invitee.token}`,
    }).catch(console.error)
  );
}

// ---- ゲスト専用URL ----
async function loadByToken(db: Db, token: string) {
  const invitee = await db.select().from(schema.meetingSeriesExternalInvitees).where(eq(schema.meetingSeriesExternalInvitees.token, token)).get();
  if (!invitee) return null;
  const series = await db.select().from(schema.meetingSeries).where(eq(schema.meetingSeries.id, invitee.seriesId)).get();
  return series ? { invitee, series } : null;
}

scheduleSeriesRoutes.get("/series/:token", async (c) => {
  const db = createDb(c.env.DB);
  const found = await loadByToken(db, c.req.param("token"));
  if (!found) return c.json({ error: { code: "not_found", message: "このURLは無効です" } }, 404);
  if (found.series.status === "cancelled") return c.json({ error: { code: "series_closed", message: "この定例会は中止されました" } }, 400);
  return c.json({ data: await buildView(db, found.series, found.invitee) });
});

scheduleSeriesRoutes.post("/series/:token/respond", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const found = await loadByToken(db, c.req.param("token"));
  if (!found) return c.json({ error: { code: "not_found", message: "このURLは無効です" } }, 404);
  const { series, invitee } = found;
  if (series.status !== "voting") return c.json(closed, 400);

  const body = await c.req.json<{ name?: string; email?: string; company?: string; answers?: Record<string, unknown> }>().catch(() => ({} as { name?: string; email?: string; company?: string; answers?: Record<string, unknown> }));
  // ゲストは、メールアドレスで特定する。招待時にメールアドレスが分かっているゲストは、メールアドレスを変えられない
  const hadEmail = !!invitee.email;
  const email = invitee.email ?? normalizeEmail(body.email ?? "");
  if (!email || !isEmailLike(email)) return c.json({ error: { code: "invalid_input", message: "メールアドレスを正しく入力してください" } }, 400);
  if (!hadEmail) {
    const taken = await db.select({ id: schema.meetingSeriesExternalInvitees.id }).from(schema.meetingSeriesExternalInvitees)
      .where(and(eq(schema.meetingSeriesExternalInvitees.seriesId, series.id), sql`lower(${schema.meetingSeriesExternalInvitees.email}) = ${email}`)).get();
    if (taken) return c.json({ error: { code: "invalid_input", message: "このメールアドレスは、すでにこの定例会に登録されています。招待メールのURL、または共有URLからご回答ください" } }, 400);
  }
  const name = body.name?.trim() || invitee.name;
  if (!name.trim()) return c.json({ error: { code: "invalid_input", message: "お名前を入力してください" } }, 400);
  const company = body.company?.trim() || invitee.company?.trim() || "";
  if (!company) return c.json({ error: { code: "invalid_input", message: "会社名（屋号）を入力してください。個人の方は「個人」とご入力ください" } }, 400);

  await db.update(schema.meetingSeriesExternalInvitees).set({ name, email, company }).where(eq(schema.meetingSeriesExternalInvitees.id, invitee.id));
  await saveAnswers(db, series, invitee.id, body.answers ?? {}, now);
  await registerGuestAsContact(db, series.hostMemberId, { name, email, company, contactId: invitee.contactId }).catch((e) => console.error("[guest contact] failed", e));
  // メールアドレスがなかった旧方式のゲストには、初回の回答時に専用URLをメールでお知らせする
  if (!hadEmail) await sendBookmarkMail(c, db, series, { name, token: invitee.token }, email);
  return c.json({ ok: true, scheduleUrl: `${getFrontendUrl(c.env)}/schedule/series/${invitee.token}` });
});

// ---- 共有URL（1つのURLを複数人で共有。回答時にゲストを新規作成） ----
scheduleSeriesRoutes.get("/series-invite/:inviteToken", async (c) => {
  const db = createDb(c.env.DB);
  const { inviteToken } = c.req.param();
  const series = await db.select().from(schema.meetingSeries).where(eq(schema.meetingSeries.inviteToken, inviteToken)).get();
  if (!series) {
    if (await isReserved(db, inviteToken, "series", Math.floor(Date.now() / 1000))) return c.json({ error: { code: "preparing", message: PREPARING_MESSAGE } }, 409);
    return c.json({ error: { code: "not_found", message: "このURLは無効です" } }, 404);
  }
  if (series.status !== "voting") return c.json(closed, 400);
  return c.json({ data: await buildView(db, series, null) });
});

scheduleSeriesRoutes.post("/series-invite/:inviteToken/respond", async (c) => {
  const db = createDb(c.env.DB);
  const { inviteToken } = c.req.param();
  const now = Math.floor(Date.now() / 1000);
  const series = await db.select().from(schema.meetingSeries).where(eq(schema.meetingSeries.inviteToken, inviteToken)).get();
  if (!series) {
    if (await isReserved(db, inviteToken, "series", now)) return c.json({ error: { code: "preparing", message: PREPARING_MESSAGE } }, 409);
    return c.json({ error: { code: "not_found", message: "このURLは無効です" } }, 404);
  }
  if (series.status !== "voting") return c.json(closed, 400);

  const body = await c.req.json<{ name?: string; email?: string; company?: string; answers?: Record<string, unknown> }>().catch(() => ({} as { name?: string; email?: string; company?: string; answers?: Record<string, unknown> }));
  const email = normalizeEmail(body.email ?? "");
  if (!email || !isEmailLike(email)) return c.json({ error: { code: "invalid_input", message: "メールアドレスを正しく入力してください" } }, 400);
  const name = body.name?.trim() ?? "";
  if (!name) return c.json({ error: { code: "invalid_input", message: "お名前を入力してください" } }, 400);
  const company = body.company?.trim() ?? "";
  if (!company) return c.json({ error: { code: "invalid_input", message: "会社名（屋号）を入力してください。個人の方は「個人」とご入力ください" } }, 400);

  // 同じメールアドレス（大文字・小文字は区別しない）のゲストが、すでにいれば、その人の回答を更新する
  // （主催者があらかじめ登録したゲストが、共有URLから回答した場合も、同じ人として扱う）
  let invitee = await db.select().from(schema.meetingSeriesExternalInvitees)
    .where(and(eq(schema.meetingSeriesExternalInvitees.seriesId, series.id), sql`lower(${schema.meetingSeriesExternalInvitees.email}) = ${email}`)).get();
  const isNew = !invitee;
  if (!invitee) {
    const created = { id: newId(), seriesId: series.id, name, email, token: generateRawToken(), contactId: null, invitedAt: null, createdAt: now, company };
    await db.insert(schema.meetingSeriesExternalInvitees).values(created);
    invitee = created;
  } else if (name !== invitee.name || company !== (invitee.company ?? "")) {
    await db.update(schema.meetingSeriesExternalInvitees).set({ name, company }).where(eq(schema.meetingSeriesExternalInvitees.id, invitee.id));
  }
  await registerGuestAsContact(db, series.hostMemberId, { name, email, company, contactId: invitee.contactId }).catch((e) => console.error("[guest contact] failed", e));
  await saveAnswers(db, series, invitee.id, body.answers ?? {}, now);
  if (isNew) await sendBookmarkMail(c, db, series, { name, token: invitee.token }, email);
  return c.json({ ok: true, scheduleUrl: `${getFrontendUrl(c.env)}/schedule/series/${invitee.token}` });
});
