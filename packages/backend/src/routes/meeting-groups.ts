// =============================================================
// 対象者の「グループ」ルート（認証必要。自分が作ったグループだけを扱える）
// GET    /api/meeting-groups                       — 自分のグループ一覧（メンバー・外部ゲスト付き）
// POST   /api/meeting-groups                       — 作成
// PATCH  /api/meeting-groups/:id                   — 名前の変更
// DELETE /api/meeting-groups/:id                   — 削除（そのグループで作ったミーティング・定例会は、そのまま残る）
// POST   /api/meeting-groups/:id/members           — メンバーを追加（そのグループで作った未実施のミーティング・定例会にも招待する）
// DELETE /api/meeting-groups/:id/members/:memberId — メンバーを外す（このグループで作った、これから開催される会からも外す）
// POST   /api/meeting-groups/:id/guests            — 外部ゲストを追加（同上）
// DELETE /api/meeting-groups/:id/guests/:guestId   — 外部ゲストを外す（同上）
// =============================================================
import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId } from "../services/auth.ts";
import { resolveEffectiveMemberId } from "../services/resolve-member.ts";
import { MAX_GUESTS, resolveGuests, type GuestInput } from "../services/meeting-guests.ts";
import { MAX_GROUPS_PER_MEMBER, MAX_GROUP_NAME_LENGTH } from "../services/meeting-groups.ts";
import { propagateGroupAdditions, propagateGroupRemovals, type GuestToAdd } from "../services/meeting-participants.ts";
import type { Env, Variables } from "../types.ts";

export const meetingGroupRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
meetingGroupRoutes.use("*", authMiddleware);

type Db = ReturnType<typeof createDb>;
const NO_MEMBER = { error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } } as const;
const NOT_FOUND = { error: { code: "not_found", message: "グループが見つかりません" } } as const;

function validName(raw: unknown): { ok: true; name: string } | { ok: false; message: string } {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) return { ok: false, message: "グループの名前を入力してください" };
  if (name.length > MAX_GROUP_NAME_LENGTH) return { ok: false, message: `グループの名前は${MAX_GROUP_NAME_LENGTH}文字までです` };
  return { ok: true, name };
}

async function ownedGroup(db: Db, ownerId: string, id: string) {
  return db.select().from(schema.meetingGroups).where(and(eq(schema.meetingGroups.id, id), eq(schema.meetingGroups.ownerMemberId, ownerId))).get();
}

/** 追加できるメンバー（有効なメンバー・本人以外）だけに絞る */
async function usableMemberIds(db: Db, ownerId: string, ids: string[] | undefined): Promise<string[]> {
  const list = [...new Set((ids ?? []).filter((id) => id && id !== ownerId))];
  if (list.length === 0) return [];
  const rows = (await Promise.all(Array.from({ length: Math.ceil(list.length / 50) }, (_, i) =>
    db.select({ id: schema.members.id }).from(schema.members)
      .where(and(inArray(schema.members.id, list.slice(i * 50, i * 50 + 50)), eq(schema.members.status, "active"))).all()
  ))).flat();
  return rows.map((r) => r.id);
}

async function insertMembers(db: Db, groupId: string, ids: string[], now: number): Promise<string[]> {
  const existing = new Set((await db.select({ id: schema.meetingGroupMembers.memberId }).from(schema.meetingGroupMembers)
    .where(eq(schema.meetingGroupMembers.groupId, groupId)).all()).map((r) => r.id));
  const fresh = ids.filter((id) => !existing.has(id));
  for (const memberId of fresh) await db.insert(schema.meetingGroupMembers).values({ id: newId(), groupId, memberId, createdAt: now });
  return fresh;
}

/** 外部ゲストを検証して、グループに加える。追加した人（会への招待に使う）を返す */
async function insertGuests(
  db: Db, ownerId: string, groupId: string, inputs: GuestInput[] | undefined, now: number,
): Promise<{ ok: true; added: GuestToAdd[] } | { ok: false; message: string }> {
  const resolved = await resolveGuests(db, ownerId, inputs);
  if (!resolved.ok) return resolved;
  const existing = await db.select().from(schema.meetingGroupGuests).where(eq(schema.meetingGroupGuests.groupId, groupId)).all();
  const emails = new Set(existing.map((g) => g.email));
  const fresh = resolved.guests.filter((g) => !emails.has(g.email));
  if (existing.length + fresh.length > MAX_GUESTS) {
    return { ok: false, message: `1つのグループに入れられる外部ゲストは${MAX_GUESTS}人までです（現在${existing.length}人）` };
  }
  for (const g of fresh) {
    await db.insert(schema.meetingGroupGuests).values({ id: newId(), groupId, name: g.name, email: g.email, contactId: g.contactId, createdAt: now });
  }
  return { ok: true, added: fresh.map((g) => ({ name: g.name, email: g.email, contactId: g.contactId })) };
}

// ----------------------------------------------------------------
// GET /api/meeting-groups
// ----------------------------------------------------------------
meetingGroupRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const ownerId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!ownerId) return c.json({ data: [] });

  const groups = await db.select().from(schema.meetingGroups).where(eq(schema.meetingGroups.ownerMemberId, ownerId))
    .orderBy(schema.meetingGroups.createdAt).all();
  if (groups.length === 0) return c.json({ data: [] });
  const ids = groups.map((g) => g.id);

  const memberRows = await db.select().from(schema.meetingGroupMembers).where(inArray(schema.meetingGroupMembers.groupId, ids)).all();
  const guestRows = await db.select().from(schema.meetingGroupGuests).where(inArray(schema.meetingGroupGuests.groupId, ids)).all();
  const memberIds = [...new Set(memberRows.map((r) => r.memberId))];
  const members = memberIds.length > 0
    ? (await Promise.all(Array.from({ length: Math.ceil(memberIds.length / 50) }, (_, i) =>
        db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor, status: schema.members.status })
          .from(schema.members).where(inArray(schema.members.id, memberIds.slice(i * 50, i * 50 + 50))).all()
      ))).flat()
    : [];
  const memberById = new Map(members.filter((m) => m.status === "active").map((m) => [m.id, m]));

  // このグループで作った、まだ終わっていないミーティング・定例会の件数（追加の影響範囲の目安）
  const meetingCounts = await db.select({ groupId: schema.meetings.groupId, n: sql<number>`count(*)` }).from(schema.meetings)
    .where(and(inArray(schema.meetings.groupId, ids), inArray(schema.meetings.status, ["open", "confirmed"]), sql`${schema.meetings.seriesId} is null`))
    .groupBy(schema.meetings.groupId).all();
  const seriesCounts = await db.select({ groupId: schema.meetingSeries.groupId, n: sql<number>`count(*)` }).from(schema.meetingSeries)
    .where(and(inArray(schema.meetingSeries.groupId, ids), inArray(schema.meetingSeries.status, ["voting", "confirmed"])))
    .groupBy(schema.meetingSeries.groupId).all();
  const meetingCountById = new Map(meetingCounts.map((r) => [r.groupId, Number(r.n)]));
  const seriesCountById = new Map(seriesCounts.map((r) => [r.groupId, Number(r.n)]));

  return c.json({
    data: groups.map((g) => ({
      id: g.id, name: g.name, createdAt: g.createdAt,
      members: memberRows.filter((r) => r.groupId === g.id).map((r) => memberById.get(r.memberId))
        .filter((m): m is NonNullable<typeof m> => !!m).map((m) => ({ id: m.id, name: m.name, emoji: m.emoji, bgColor: m.bgColor })),
      guests: guestRows.filter((r) => r.groupId === g.id).map((r) => ({ id: r.id, name: r.name, email: r.email, contactId: r.contactId })),
      activeMeetingCount: meetingCountById.get(g.id) ?? 0,
      activeSeriesCount: seriesCountById.get(g.id) ?? 0,
    })),
  });
});

// ----------------------------------------------------------------
// POST /api/meeting-groups
// ----------------------------------------------------------------
meetingGroupRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const ownerId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!ownerId) return c.json(NO_MEMBER, 403);
  const body = await c.req.json<{ name?: string; memberIds?: string[]; guests?: GuestInput[] }>();

  const name = validName(body.name);
  if (!name.ok) return c.json({ error: { code: "invalid_input", message: name.message } }, 400);
  const count = (await db.select({ n: sql<number>`count(*)` }).from(schema.meetingGroups).where(eq(schema.meetingGroups.ownerMemberId, ownerId)).get())?.n ?? 0;
  if (Number(count) >= MAX_GROUPS_PER_MEMBER) {
    return c.json({ error: { code: "limit", message: `グループは${MAX_GROUPS_PER_MEMBER}個まで作れます。使わないグループを削除してください` } }, 400);
  }
  const duplicate = await db.select({ id: schema.meetingGroups.id }).from(schema.meetingGroups)
    .where(and(eq(schema.meetingGroups.ownerMemberId, ownerId), eq(schema.meetingGroups.name, name.name))).get();
  if (duplicate) return c.json({ error: { code: "duplicate", message: "同じ名前のグループがすでにあります。別の名前にしてください" } }, 400);

  // 外部ゲストの検証を先に済ませ、問題があれば何も作らない
  const groupId = newId();
  const now = Math.floor(Date.now() / 1000);
  const memberIds = await usableMemberIds(db, ownerId, body.memberIds);
  const resolved = await resolveGuests(db, ownerId, body.guests);
  if (!resolved.ok) return c.json({ error: { code: "invalid_input", message: resolved.message } }, 400);

  await db.insert(schema.meetingGroups).values({ id: groupId, ownerMemberId: ownerId, name: name.name, createdAt: now, updatedAt: now });
  await insertMembers(db, groupId, memberIds, now);
  for (const g of resolved.guests) {
    await db.insert(schema.meetingGroupGuests).values({ id: newId(), groupId, name: g.name, email: g.email, contactId: g.contactId, createdAt: now });
  }
  return c.json({ data: { id: groupId } }, 201);
});

// ----------------------------------------------------------------
// PATCH /api/meeting-groups/:id
// ----------------------------------------------------------------
meetingGroupRoutes.patch("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const ownerId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!ownerId) return c.json(NO_MEMBER, 403);
  const group = await ownedGroup(db, ownerId, c.req.param("id"));
  if (!group) return c.json(NOT_FOUND, 404);
  const body = await c.req.json<{ name?: string }>();
  const name = validName(body.name);
  if (!name.ok) return c.json({ error: { code: "invalid_input", message: name.message } }, 400);
  const duplicate = await db.select({ id: schema.meetingGroups.id }).from(schema.meetingGroups)
    .where(and(eq(schema.meetingGroups.ownerMemberId, ownerId), eq(schema.meetingGroups.name, name.name))).get();
  if (duplicate && duplicate.id !== group.id) return c.json({ error: { code: "duplicate", message: "同じ名前のグループがすでにあります。別の名前にしてください" } }, 400);
  await db.update(schema.meetingGroups).set({ name: name.name, updatedAt: Math.floor(Date.now() / 1000) }).where(eq(schema.meetingGroups.id, group.id));
  return c.json({ ok: true });
});

// ----------------------------------------------------------------
// DELETE /api/meeting-groups/:id
// ----------------------------------------------------------------
meetingGroupRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const ownerId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!ownerId) return c.json(NO_MEMBER, 403);
  const group = await ownedGroup(db, ownerId, c.req.param("id"));
  if (!group) return c.json(NOT_FOUND, 404);
  // 作成済みのミーティング・定例会はそのまま残し、グループとの紐づけだけを外す（以降は、追加の対象にならない）
  await db.update(schema.meetings).set({ groupId: null }).where(eq(schema.meetings.groupId, group.id));
  await db.update(schema.meetingSeries).set({ groupId: null }).where(eq(schema.meetingSeries.groupId, group.id));
  await db.delete(schema.meetingGroupMembers).where(eq(schema.meetingGroupMembers.groupId, group.id));
  await db.delete(schema.meetingGroupGuests).where(eq(schema.meetingGroupGuests.groupId, group.id));
  await db.delete(schema.meetingGroups).where(eq(schema.meetingGroups.id, group.id));
  return c.json({ ok: true });
});

// ----------------------------------------------------------------
// POST /api/meeting-groups/:id/members
// ----------------------------------------------------------------
meetingGroupRoutes.post("/:id/members", async (c) => {
  const db = createDb(c.env.DB);
  const ownerId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!ownerId) return c.json(NO_MEMBER, 403);
  const group = await ownedGroup(db, ownerId, c.req.param("id"));
  if (!group) return c.json(NOT_FOUND, 404);
  const body = await c.req.json<{ memberIds?: string[] }>();

  const ids = await usableMemberIds(db, ownerId, body.memberIds);
  if (ids.length === 0) return c.json({ error: { code: "invalid_input", message: "追加するメンバーを選んでください" } }, 400);
  const now = Math.floor(Date.now() / 1000);
  const added = await insertMembers(db, group.id, ids, now);
  await db.update(schema.meetingGroups).set({ updatedAt: now }).where(eq(schema.meetingGroups.id, group.id));

  const reached = await propagateGroupAdditions(
    { db, env: c.env, waitUntil: (p) => c.executionCtx.waitUntil(p) }, group.id, { memberIds: added, guests: [] },
  );
  return c.json({ data: { added: added.length, meetings: reached.meetings, series: reached.series } });
});

// ----------------------------------------------------------------
// DELETE /api/meeting-groups/:id/members/:memberId
// ----------------------------------------------------------------
meetingGroupRoutes.delete("/:id/members/:memberId", async (c) => {
  const db = createDb(c.env.DB);
  const ownerId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!ownerId) return c.json(NO_MEMBER, 403);
  const group = await ownedGroup(db, ownerId, c.req.param("id"));
  if (!group) return c.json(NOT_FOUND, 404);
  const memberId = c.req.param("memberId");
  const existed = await db.select({ id: schema.meetingGroupMembers.id }).from(schema.meetingGroupMembers)
    .where(and(eq(schema.meetingGroupMembers.groupId, group.id), eq(schema.meetingGroupMembers.memberId, memberId))).get();
  if (!existed) return c.json({ data: { meetings: 0, series: 0 } });
  await db.delete(schema.meetingGroupMembers).where(eq(schema.meetingGroupMembers.id, existed.id));
  const reached = await propagateGroupRemovals(
    { db, env: c.env, waitUntil: (p) => c.executionCtx.waitUntil(p) }, group.id, { memberIds: [memberId], guestEmails: [] },
  );
  return c.json({ data: reached });
});

// ----------------------------------------------------------------
// POST /api/meeting-groups/:id/guests
// ----------------------------------------------------------------
meetingGroupRoutes.post("/:id/guests", async (c) => {
  const db = createDb(c.env.DB);
  const ownerId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!ownerId) return c.json(NO_MEMBER, 403);
  const group = await ownedGroup(db, ownerId, c.req.param("id"));
  if (!group) return c.json(NOT_FOUND, 404);
  const body = await c.req.json<{ guests?: GuestInput[] }>();
  if (!body.guests?.length) return c.json({ error: { code: "invalid_input", message: "追加するゲストを入力してください" } }, 400);

  const now = Math.floor(Date.now() / 1000);
  const result = await insertGuests(db, ownerId, group.id, body.guests, now);
  if (!result.ok) return c.json({ error: { code: "invalid_input", message: result.message } }, 400);
  await db.update(schema.meetingGroups).set({ updatedAt: now }).where(eq(schema.meetingGroups.id, group.id));

  const reached = await propagateGroupAdditions(
    { db, env: c.env, waitUntil: (p) => c.executionCtx.waitUntil(p) }, group.id, { memberIds: [], guests: result.added },
  );
  return c.json({ data: { added: result.added.length, meetings: reached.meetings, series: reached.series } });
});

// ----------------------------------------------------------------
// DELETE /api/meeting-groups/:id/guests/:guestId
// ----------------------------------------------------------------
meetingGroupRoutes.delete("/:id/guests/:guestId", async (c) => {
  const db = createDb(c.env.DB);
  const ownerId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!ownerId) return c.json(NO_MEMBER, 403);
  const group = await ownedGroup(db, ownerId, c.req.param("id"));
  if (!group) return c.json(NOT_FOUND, 404);
  const guest = await db.select().from(schema.meetingGroupGuests)
    .where(and(eq(schema.meetingGroupGuests.groupId, group.id), eq(schema.meetingGroupGuests.id, c.req.param("guestId")))).get();
  if (!guest) return c.json({ data: { meetings: 0, series: 0 } });
  await db.delete(schema.meetingGroupGuests).where(eq(schema.meetingGroupGuests.id, guest.id));
  const reached = await propagateGroupRemovals(
    { db, env: c.env, waitUntil: (p) => c.executionCtx.waitUntil(p) }, group.id, { memberIds: [], guestEmails: [guest.email] },
  );
  return c.json({ data: reached });
});
