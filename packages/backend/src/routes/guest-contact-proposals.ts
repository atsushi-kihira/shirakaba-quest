// =============================================================
// 外部ゲストの回答からの人脈の自動登録で、登録件数の上限に達していたときの、主催者への確認
// GET  /api/guest-contact-proposals            → 自分の確認待ち一覧（と、上限の状況）
// POST /api/guest-contact-proposals/:id/resolve → { action: "private" | "swap" | "dismiss", swapContactId? }
//    private … 非公開として、新しく人脈に登録する
//    swap    … 既存の人脈1件を非公開に変えて、新しい人は「存在のみ公開」で登録する
//    dismiss … 登録しない
// =============================================================
import { Hono } from "hono";
import { and, eq, ne } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { resolveEffectiveMemberId } from "../services/resolve-member.ts";
import { CONTACT_LIMIT, countPublicContacts, insertGuestContact, normalizeEmail } from "../services/guest-contacts.ts";
import type { Env, Variables } from "../types.ts";

export const guestContactProposalRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
guestContactProposalRoutes.use("*", authMiddleware);

const err = (code: string, message: string) => ({ error: { code, message } });

guestContactProposalRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ data: { proposals: [], limit: CONTACT_LIMIT, publicCount: 0 } });
  const rows = await db.select().from(schema.guestContactProposals)
    .where(and(eq(schema.guestContactProposals.ownerMemberId, meId), eq(schema.guestContactProposals.status, "pending")))
    .orderBy(schema.guestContactProposals.createdAt).all();
  return c.json({
    data: {
      proposals: rows.map((r) => ({ id: r.id, name: r.name, email: r.email, company: r.company, context: r.context, createdAt: r.createdAt })),
      limit: CONTACT_LIMIT,
      publicCount: rows.length > 0 ? await countPublicContacts(db, meId) : 0,
    },
  });
});

guestContactProposalRoutes.post("/:id/resolve", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json(err("no_member", "メンバーとして登録されていないためご利用いただけません"), 403);
  const body = await c.req.json<{ action?: string; swapContactId?: string }>().catch(() => ({} as { action?: string; swapContactId?: string }));
  const proposal = await db.select().from(schema.guestContactProposals)
    .where(and(eq(schema.guestContactProposals.id, c.req.param("id")), eq(schema.guestContactProposals.ownerMemberId, meId))).get();
  if (!proposal || proposal.status !== "pending") return c.json(err("not_found", "この確認は、すでに済んでいるか、見つかりません"), 404);
  const now = Math.floor(Date.now() / 1000);
  const finish = (status: "registered" | "dismissed") =>
    db.update(schema.guestContactProposals).set({ status, resolvedAt: now }).where(eq(schema.guestContactProposals.id, proposal.id));

  if (body.action === "dismiss") {
    await finish("dismissed");
    return c.json({ ok: true });
  }

  // すでに同じメールアドレスの人脈がある（確認待ちの間に、自分で登録した）なら、新しく作らない
  const email = normalizeEmail(proposal.email);
  const dup = (await db.select({ id: schema.externalContacts.id, email: schema.externalContacts.email }).from(schema.externalContacts)
    .where(eq(schema.externalContacts.ownerMemberId, meId)).all()).find((ct) => ct.email && normalizeEmail(ct.email) === email);
  if (dup) {
    await finish("registered");
    return c.json({ ok: true, contactId: dup.id });
  }

  const g = { name: proposal.name, email: proposal.email, company: proposal.company };
  if (body.action === "private") {
    const id = await insertGuestContact(db, meId, g, "private");
    await finish("registered");
    return c.json({ ok: true, contactId: id });
  }

  if (body.action === "swap") {
    // 上限に余裕があれば、そのまま登録する（確認待ちの間に、人脈を削除・非公開にした場合）
    if ((await countPublicContacts(db, meId)) < CONTACT_LIMIT) {
      const id = await insertGuestContact(db, meId, g, "existence");
      await finish("registered");
      return c.json({ ok: true, contactId: id });
    }
    if (!body.swapContactId) return c.json(err("invalid", "非公開に変える人脈を選んでください"), 400);
    const target = await db.select({ id: schema.externalContacts.id }).from(schema.externalContacts)
      .where(and(eq(schema.externalContacts.id, body.swapContactId), eq(schema.externalContacts.ownerMemberId, meId), ne(schema.externalContacts.visibility, "private"))).get();
    if (!target) return c.json(err("invalid", "選んだ人脈が見つからないか、すでに非公開です。選び直してください"), 400);
    await db.update(schema.externalContacts).set({ visibility: "private", updatedAt: now }).where(eq(schema.externalContacts.id, target.id));
    const id = await insertGuestContact(db, meId, g, "existence");
    await finish("registered");
    return c.json({ ok: true, contactId: id });
  }
  return c.json(err("invalid", "操作の指定が正しくありません"), 400);
});
