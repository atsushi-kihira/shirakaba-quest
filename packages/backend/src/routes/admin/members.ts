// =============================================================
// 管理者向けメンバー管理ルート
// GET    /api/admin/members
// PATCH  /api/admin/members/:id/approve      — 承認（active化。ゲストからの昇格にも使う）
// PATCH  /api/admin/members/:id/mark-guest   — ゲストユーザーに振り分ける（承認待ちから除外）
// PATCH  /api/admin/members/:id/reject       — 利用却下（記録は残す。承認待ち・ゲストどちらからも可）
// PATCH  /api/admin/members/:id/leave        — 休会にする（記録は残す）
// PATCH  /api/admin/members/:id/reactivate   — 休会からアクティブに戻す
// DELETE /api/admin/members/:id              — 完全削除（記録ごと全削除。メールアドレスが再登録可能になる）
// PATCH  /api/admin/members/:id/profile      — プロフィールの編集（マイページの「プロフィール編集」と同じ項目すべて）
// POST   /api/admin/members/:id/avatar       — アバター画像のアップロード／DELETE で絵文字に戻す
// PATCH  /api/admin/members/:id/roles
// PATCH  /api/admin/members/:id/email         — メールアドレスを代行で変更（本人が確認メールを受け取れない場合用）
// GET    /api/admin/members/registration-pending   — メール確認が済んでいない（登録が完了していない）人の一覧
// POST   /api/admin/members/registration-pending/resend — 確認メールを再送（入力内容の下書きが残っている人のみ）
// POST   /api/admin/members/registration-pending/complete — メールの確認は済んでいるのに登録が作られなかった人を、残っている入力内容から管理者が登録（承認待ちに追加）する
// DELETE /api/admin/members/registration-pending?email=…  — 一覧から外す（下書きを削除）
// =============================================================
import { Hono } from "hono";
import { and, eq, gt, or, sql } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { MailService } from "../../services/mailer.ts";
import { getFrontendUrl } from "../../services/frontendUrl.ts";
import {
  createPendingMember, deleteDraft, isEmailAlreadyRegistered, listDrafts, loadDraft, normalizeEmail, sendVerificationMail, validateRegistrationBody,
} from "../../services/registration.ts";
import { hardDeleteMember } from "../../services/memberDeletion.ts";
import { applyEmailChange, findLinkedAdmin, isEmailInUse, isValidEmailFormat } from "../../services/email-change.ts";
import { getCardImageDataUrl, saveAvatarImage } from "../../services/card-image.ts";
import { buildProfilePatch, type ProfileBody } from "../../services/member-profile.ts";
import {
  getActiveMemberIdsWithRole,
  grantMemberRole,
  revokeMemberRole,
  type MemberRoleName,
} from "../../services/member-roles.ts";
import type { Env, Variables } from "../../types.ts";
import type { Skill } from "@shared/types";

export const adminMemberRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- GET /api/admin/members ----
adminMemberRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);

  const [members, pilot1Ids, pilot2Ids, ptcIds, mtcIds, pmIds, tmIds] = await Promise.all([
    db.select().from(schema.members).all(),
    getActiveMemberIdsWithRole(db, "pilot1"),
    getActiveMemberIdsWithRole(db, "pilot2"),
    getActiveMemberIdsWithRole(db, "power_team_coordinator"),
    getActiveMemberIdsWithRole(db, "mentor_coordinator"),
    getActiveMemberIdsWithRole(db, "personal_mentor"),
    getActiveMemberIdsWithRole(db, "topic_mentor"),
  ]);

  return c.json({
    data: members.map((m) => ({
      ...m,
      skills: parseJson<Skill[]>(m.skills, []),
      customFields: parseJson(m.customFields, {}),
      isPilot1: pilot1Ids.has(m.id),
      isPilot2: pilot2Ids.has(m.id),
      isPowerTeamCoordinator: ptcIds.has(m.id),
      isMentorCoordinator: mtcIds.has(m.id),
      isPersonalMentor: pmIds.has(m.id),
      isTopicMentor: tmIds.has(m.id),
    })),
  });
});

// ---- GET /api/admin/members/registration-pending ----
// 手入力で登録を始めたが、確認メールのリンクを開いていない（＝まだ承認待ちに出てこない）人の一覧。
// ・入力内容の下書きが残っている人（リンクを開けば仮登録が完了する）
// ・下書きはないが、直近14日間に確認メールを送ったまま登録が完了していないメールアドレス
adminMemberRoutes.get("/registration-pending", async (c) => {
  const db = createDb(c.env.DB);
  const nowSec = Math.floor(Date.now() / 1000);

  const drafts = await listDrafts(c.env.KV);
  const verifications = await db.select({
    email: schema.emailVerifications.email,
    createdAt: schema.emailVerifications.createdAt,
    verifiedAt: schema.emailVerifications.verifiedAt,
  }).from(schema.emailVerifications)
    .where(gt(schema.emailVerifications.createdAt, nowSec - 14 * 24 * 3600))
    .all();

  const memberEmails = new Set((await db.select({ email: schema.members.email }).from(schema.members).all()).map((m) => m.email.toLowerCase()));

  const byEmail = new Map<string, { email: string; name: string | null; requestedAt: number; hasDraft: boolean; linkOpened: boolean }>();
  for (const d of drafts) {
    if (memberEmails.has(d.email)) continue;
    byEmail.set(d.email, { email: d.email, name: d.name, requestedAt: d.requestedAt, hasDraft: true, linkOpened: false });
  }
  for (const v of verifications) {
    const email = v.email.toLowerCase();
    if (memberEmails.has(email)) continue;
    const cur = byEmail.get(email);
    if (cur) {
      cur.requestedAt = Math.max(cur.requestedAt, v.createdAt);
      if (v.verifiedAt) cur.linkOpened = true;
    } else {
      byEmail.set(email, { email, name: null, requestedAt: v.createdAt, hasDraft: false, linkOpened: !!v.verifiedAt });
    }
  }
  const data = [...byEmail.values()].sort((a, b) => b.requestedAt - a.requestedAt);
  return c.json({ data });
});

// ---- POST /api/admin/members/registration-pending/resend ----
adminMemberRoutes.post("/registration-pending/resend", async (c) => {
  const db = createDb(c.env.DB);
  const { email } = await c.req.json<{ email?: string }>().catch(() => ({} as { email?: string }));
  if (!email) return c.json({ error: { code: "invalid_input", message: "メールアドレスを指定してください" } }, 400);
  const normalized = normalizeEmail(email);
  if (!(await loadDraft(c.env.KV, normalized))) {
    return c.json({ error: { code: "no_draft", message: "入力内容が残っていないため、確認メールを再送できません。ご本人に登録をやり直していただいてください" } }, 400);
  }
  await sendVerificationMail(db, c.env, normalized);
  return c.json({ ok: true });
});

// ---- POST /api/admin/members/registration-pending/complete ----
// 確認メールのリンクは開かれている（メールアドレスの持ち主であることは確認済み）のに、登録が作られなかった人を、
// 残っている入力内容から管理者が登録する。登録した方に再度の操作をお願いしなくて済むようにするための操作。
// 失敗した場合は、原因を調べられるよう、管理者向けにエラーの内容を返す。
adminMemberRoutes.post("/registration-pending/complete", async (c) => {
  const db = createDb(c.env.DB);
  const { email } = await c.req.json<{ email?: string }>().catch(() => ({} as { email?: string }));
  if (!email) return c.json({ error: { code: "invalid_input", message: "メールアドレスを指定してください" } }, 400);
  const normalized = normalizeEmail(email);

  if (await isEmailAlreadyRegistered(db, normalized)) {
    return c.json({ error: { code: "already_registered", message: "このメールアドレスは、すでにメンバーとして登録されています" } }, 409);
  }
  const verified = await db.select({ token: schema.emailVerifications.token }).from(schema.emailVerifications)
    .where(and(eq(schema.emailVerifications.email, normalized), sql`${schema.emailVerifications.verifiedAt} IS NOT NULL`))
    .get();
  if (!verified) {
    return c.json({ error: { code: "not_verified", message: "メールアドレスの確認（リンクを開くこと）がまだ済んでいないため、登録できません" } }, 400);
  }
  const draft = await loadDraft(c.env.KV, normalized);
  if (!draft) {
    return c.json({ error: { code: "no_draft", message: "入力内容が残っていないため、登録できません。ご本人に登録をやり直していただいてください" } }, 400);
  }
  const problem = validateRegistrationBody(draft);
  if (problem) return c.json({ error: { code: "invalid_draft", message: `入力内容に不足があります：${problem}` } }, 400);

  try {
    const memberId = await createPendingMember(db, c.env, (p) => c.executionCtx.waitUntil(p), draft);
    await deleteDraft(c.env.KV, normalized);
    return c.json({ ok: true, data: { memberId } });
  } catch (e) {
    console.error("[admin] 登録の完了に失敗", e);
    const detail = e instanceof Error ? e.message : String(e);
    return c.json({ error: { code: "create_failed", message: `登録を作成できませんでした（${detail.slice(0, 300)}）` } }, 500);
  }
});

// ---- DELETE /api/admin/members/registration-pending?email=... ----
adminMemberRoutes.delete("/registration-pending", async (c) => {
  const email = c.req.query("email");
  if (!email) return c.json({ error: { code: "invalid_input", message: "メールアドレスを指定してください" } }, 400);
  const db = createDb(c.env.DB);
  const normalized = normalizeEmail(email);
  await deleteDraft(c.env.KV, normalized);
  // 確認メールの送信記録も消して、一覧に残らないようにする（メンバー登録済みのアドレスの記録は消さない）
  const registered = await db.select({ id: schema.members.id }).from(schema.members).where(eq(schema.members.email, normalized)).get();
  if (!registered) await db.delete(schema.emailVerifications).where(eq(schema.emailVerifications.email, normalized));
  return c.json({ ok: true });
});

// ---- GET /api/admin/members/:id/detail ----
// 一般ユーザーがメンバーのプロフィールで確認できる内容（協働の状況・金の卵/ガチョウ・外部人脈の件数など）を、
// 1to1の有無にかかわらずすべて返す。名刺情報・ポイントなどは一覧/別エンドポイントと同じ内容を画面側で組み合わせる。
adminMemberRoutes.get("/:id/detail", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");

  const member = await db.select({ id: schema.members.id, cardImageKey: schema.members.cardImageKey })
    .from(schema.members).where(eq(schema.members.id, id)).get();
  if (!member) return c.json({ error: { code: "not_found", message: "メンバーが見つかりません" } }, 404);

  const [guildRows, collabRows, seedLinks, oneOnOneRow, contactRows, eggs, geese, lastLoginRow] = await Promise.all([
    db.select({ id: schema.teams.id, name: schema.teams.name, emblemEmoji: schema.teams.emblemEmoji, isLeader: schema.teamMembers.isLeader })
      .from(schema.teamMembers).innerJoin(schema.teams, eq(schema.teams.id, schema.teamMembers.teamId))
      .where(eq(schema.teamMembers.memberId, id)).all(),
    db.select({ id: schema.collabTeams.id, name: schema.collabTeams.name, type: schema.collabTeams.type, status: schema.collabTeamMembers.status })
      .from(schema.collabTeamMembers).innerJoin(schema.collabTeams, eq(schema.collabTeams.id, schema.collabTeamMembers.teamId))
      .where(and(eq(schema.collabTeamMembers.memberId, id), eq(schema.collabTeams.archived, 0))).all(),
    db.select({ low: schema.collaborationLinks.memberLowId, high: schema.collaborationLinks.memberHighId })
      .from(schema.collaborationLinks)
      .where(and(eq(schema.collaborationLinks.stage, "seed"), or(eq(schema.collaborationLinks.memberLowId, id), eq(schema.collaborationLinks.memberHighId, id)))).all(),
    db.select({ n: sql<number>`count(*)` }).from(schema.oneOnOneSessions)
      .where(and(eq(schema.oneOnOneSessions.status, "completed"), or(eq(schema.oneOnOneSessions.requesterId, id), eq(schema.oneOnOneSessions.responderId, id)))).get(),
    db.select({ visibility: schema.externalContacts.visibility, n: sql<number>`count(*)` })
      .from(schema.externalContacts).where(eq(schema.externalContacts.ownerMemberId, id))
      .groupBy(schema.externalContacts.visibility).all(),
    db.select().from(schema.goldenEggs).where(eq(schema.goldenEggs.memberId, id)).orderBy(schema.goldenEggs.createdAt).all(),
    db.select().from(schema.goldenGeese).where(eq(schema.goldenGeese.memberId, id)).orderBy(schema.goldenGeese.createdAt).all(),
    db.select({ last: sql<number>`max(${schema.authSessions.createdAt})` }).from(schema.authSessions)
      .where(and(eq(schema.authSessions.userId, id), eq(schema.authSessions.userType, "member"))).get(),
  ]);

  const partnerIds = seedLinks.map((l) => (l.low === id ? l.high : l.low));
  const partners = partnerIds.length > 0
    ? (await db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji }).from(schema.members).all())
        .filter((m) => partnerIds.includes(m.id))
    : [];

  const contactCounts = { total: 0, private: 0, existence: 0, full: 0 };
  for (const r of contactRows) {
    const n = Number(r.n);
    contactCounts.total += n;
    if (r.visibility === "private" || r.visibility === "existence" || r.visibility === "full") contactCounts[r.visibility] += n;
  }

  return c.json({
    data: {
      guilds: guildRows.map((g) => ({ ...g, isLeader: !!g.isLeader })),
      collabTeams: collabRows,
      seedPartners: partners,
      oneOnOneCompleted: Number(oneOnOneRow?.n ?? 0),
      externalContacts: contactCounts,
      goldenEggs: eggs,
      goldenGeese: geese,
      lastLoginAt: lastLoginRow?.last ?? null,
      hasCardImage: !!member.cardImageKey,
    },
  });
});

// ---- GET /api/admin/members/:id/card-image ---- 名刺（リアルカード）の撮影画像
adminMemberRoutes.get("/:id/card-image", async (c) => {
  const db = createDb(c.env.DB);
  const member = await db.select({ cardImageKey: schema.members.cardImageKey }).from(schema.members)
    .where(eq(schema.members.id, c.req.param("id"))).get();
  if (!member?.cardImageKey) return c.json({ error: { code: "not_found", message: "カード画像がありません" } }, 404);
  const dataUrl = await getCardImageDataUrl(c.env.R2, member.cardImageKey);
  if (!dataUrl) return c.json({ error: { code: "not_found", message: "カード画像がありません" } }, 404);
  return c.json({ data: { imageDataUrl: dataUrl } });
});

const VALID_MEMBER_ROLES: MemberRoleName[] = [
  "pilot1", "pilot2", "power_team_coordinator",
  "mentor_coordinator", "personal_mentor", "topic_mentor",
];

// ---- PATCH /api/admin/members/:id/profile ----
// 本人がマイページの「プロフィール編集」で変えられる項目を、管理者が代わりに編集する（メールアドレスは、下の /email で変更する）
adminMemberRoutes.patch("/:id/profile", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  const member = await db.select({ id: schema.members.id }).from(schema.members).where(eq(schema.members.id, id)).get();
  if (!member) return c.json({ error: { code: "not_found", message: "メンバーが見つかりません" } }, 404);
  const body = await c.req.json<ProfileBody>().catch(() => ({} as ProfileBody));
  const built = buildProfilePatch(body, Math.floor(Date.now() / 1000));
  if (!built.ok) return c.json({ error: { code: "invalid_input", message: built.message } }, 400);
  await db.update(schema.members).set(built.patch).where(eq(schema.members.id, id));
  return c.json({ ok: true });
});

// ---- POST/DELETE /api/admin/members/:id/avatar ---- アバター画像の登録（アップロード）／絵文字に戻す
adminMemberRoutes.post("/:id/avatar", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  const member = await db.select({ id: schema.members.id }).from(schema.members).where(eq(schema.members.id, id)).get();
  if (!member) return c.json({ error: { code: "not_found", message: "メンバーが見つかりません" } }, 404);
  const body = await c.req.json<{ imageBase64?: string }>().catch(() => ({} as { imageBase64?: string }));
  if (!body.imageBase64) return c.json({ error: { code: "bad_request", message: "画像データが必要です" } }, 400);
  const key = await saveAvatarImage(c.env.R2, id, body.imageBase64);
  await db.update(schema.members).set({ avatarImageKey: key, updatedAt: Math.floor(Date.now() / 1000) }).where(eq(schema.members.id, id));
  return c.json({ ok: true });
});

adminMemberRoutes.delete("/:id/avatar", async (c) => {
  const db = createDb(c.env.DB);
  await db.update(schema.members).set({ avatarImageKey: null, updatedAt: Math.floor(Date.now() / 1000) }).where(eq(schema.members.id, c.req.param("id")));
  return c.json({ ok: true });
});

// ---- PATCH /api/admin/members/:id/roles ----
// body: { role: MemberRoleName, enabled: boolean }
adminMemberRoutes.patch("/:id/roles", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const memberId = c.req.param("id");
  const { role, enabled } = await c.req.json<{ role: MemberRoleName; enabled: boolean }>();

  if (!VALID_MEMBER_ROLES.includes(role)) {
    return c.json({ error: { code: "invalid_input", message: "不正なロールです" } }, 400);
  }

  const member = await db.select({ id: schema.members.id }).from(schema.members)
    .where(eq(schema.members.id, memberId)).get();
  if (!member) return c.json({ error: { code: "not_found", message: "メンバーが見つかりません" } }, 404);

  if (enabled) {
    await grantMemberRole(db, memberId, role, adminId);
  } else {
    await revokeMemberRole(db, memberId, role);
  }

  return c.json({ ok: true });
});

// ---- PATCH /api/admin/members/:id/email ----
// 本人が古いメールアドレスを使えず、確認メールを受け取れない場合に、管理者が代わりに変更する。
// 管理者アカウントを兼ねているメンバーは、管理者権限の乗っ取りを防ぐため、本人がマイページから変更する。
adminMemberRoutes.patch("/:id/email", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  const { email: rawEmail } = await c.req.json<{ email?: string }>().catch(() => ({} as { email?: string }));
  const email = normalizeEmail(rawEmail ?? "");
  if (!isValidEmailFormat(email)) {
    return c.json({ error: { code: "invalid_email", message: "メールアドレスの形式が正しくありません。もう一度ご確認ください。" } }, 400);
  }
  const member = await db.select({ email: schema.members.email }).from(schema.members).where(eq(schema.members.id, id)).get();
  if (!member) return c.json({ error: { code: "not_found", message: "メンバーが見つかりません" } }, 404);
  if (normalizeEmail(member.email) === email) {
    return c.json({ error: { code: "same_email", message: "いま登録されているメールアドレスと同じです" } }, 400);
  }
  if (await findLinkedAdmin(db, member.email)) {
    return c.json({ error: { code: "linked_admin", message: "このメンバーは管理者アカウントを兼ねているため、ここでは変更できません。本人にマイページの「メールアドレスを変更する」から変更してもらってください。" } }, 409);
  }
  if (await isEmailInUse(db, email, id)) {
    return c.json({ error: { code: "email_taken", message: "このメールアドレスは、すでに別の方が使っています" } }, 409);
  }
  await applyEmailChange(db, c.env, (p) => c.executionCtx.waitUntil(p), id, email, { syncLinkedAdmin: false });
  return c.json({ ok: true, data: { email } });
});

// ---- PATCH /api/admin/members/:id/approve ----
adminMemberRoutes.patch("/:id/approve", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const id = c.req.param("id");

  const member = await db
    .select({ name: schema.members.name, email: schema.members.email, status: schema.members.status })
    .from(schema.members)
    .where(eq(schema.members.id, id))
    .get();

  await db.update(schema.members)
    .set({
      status: "active", approvedAt: now, updatedAt: now,
      // 承認前（承認待ち・ゲストユーザー）のログインは「初めてのログイン」に数えない。
      // 承認後に初めてログインしたときに「ようこそ」を配信するため、配信済みの印をここでリセットする
      // （すでにアクティブなメンバーの承認操作では触らない）
      ...(member && member.status !== "active" ? { firstLoginWelcomedAt: null } : {}),
    })
    .where(eq(schema.members.id, id));

  if (member) {
    const mailer = new MailService(db, c.env);
    const loginUrl = getFrontendUrl(c.env);
    c.executionCtx.waitUntil(
      mailer.send("member_approved", member.email, {
        memberName: member.name,
        loginUrl,
      }).catch((e) => console.error("[mail] member_approved failed:", e))
    );
  }

  return c.json({ ok: true });
});

// ---- PATCH /api/admin/members/:id/mark-guest ----
// ゲストユーザーに振り分ける：白樺のメンバーとしてではなく、スケジューラー等の
// 限定機能だけを使うゲストとして扱う。承認待ち一覧・バッジの対象からは外れる。
adminMemberRoutes.patch("/:id/mark-guest", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  await db.update(schema.members)
    .set({ status: "guest", updatedAt: now })
    .where(eq(schema.members.id, c.req.param("id")));

  return c.json({ ok: true });
});

// ---- PATCH /api/admin/members/:id/reject ----
// 利用却下：レコードは残したまま「却下済み」として履歴に残す（完全削除はしない）。
// メールアドレスをすぐに解放したい場合は、別途「完全に削除する」を使う。
adminMemberRoutes.patch("/:id/reject", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  await db.update(schema.members)
    .set({ status: "rejected", updatedAt: now })
    .where(eq(schema.members.id, c.req.param("id")));

  return c.json({ ok: true });
});

// ---- PATCH /api/admin/members/:id/leave ----
// 休会にする：レコードは残したまま、アクティブ一覧から外す。いつでもアクティブに戻せる。
adminMemberRoutes.patch("/:id/leave", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  await db.update(schema.members)
    .set({ status: "on_leave", updatedAt: now })
    .where(eq(schema.members.id, c.req.param("id")));

  return c.json({ ok: true });
});

// ---- PATCH /api/admin/members/:id/reactivate ----
// 休会からアクティブに戻す
adminMemberRoutes.patch("/:id/reactivate", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  await db.update(schema.members)
    .set({ status: "active", updatedAt: now })
    .where(eq(schema.members.id, c.req.param("id")));

  return c.json({ ok: true });
});

// ---- DELETE /api/admin/members/:id ----
// 完全削除：レコードごと全データを削除する（元に戻せない）。メールアドレスは再登録可能になる。
adminMemberRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");

  const member = await db.select({ id: schema.members.id })
    .from(schema.members)
    .where(eq(schema.members.id, id))
    .get();

  if (!member) return c.json({ error: { code: "NOT_FOUND", message: "メンバーが見つかりません" } }, 404);

  await hardDeleteMember(db, c.env, id, c.env.KV);

  return c.json({ ok: true });
});


function parseJson<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str) as T; }
  catch { return fallback; }
}
