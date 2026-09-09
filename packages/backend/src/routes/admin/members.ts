// =============================================================
// 管理者向けメンバー管理ルート
// GET    /api/admin/members
// PATCH  /api/admin/members/:id/approve
// PATCH  /api/admin/members/:id/leave        — 休会にする（記録は残す）
// PATCH  /api/admin/members/:id/reactivate   — 休会からアクティブに戻す
// DELETE /api/admin/members/:id              — 完全削除（記録ごと全削除。メールアドレスが再登録可能になる）
// PATCH  /api/admin/members/:id/roles
// =============================================================
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { MailService } from "../../services/mailer.ts";
import { getFrontendUrl } from "../../services/frontendUrl.ts";
import { hardDeleteMember } from "../../services/memberDeletion.ts";
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

const VALID_MEMBER_ROLES: MemberRoleName[] = [
  "pilot1", "pilot2", "power_team_coordinator",
  "mentor_coordinator", "personal_mentor", "topic_mentor",
];

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

// ---- PATCH /api/admin/members/:id/approve ----
adminMemberRoutes.patch("/:id/approve", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const id = c.req.param("id");

  const member = await db
    .select({ name: schema.members.name, email: schema.members.email })
    .from(schema.members)
    .where(eq(schema.members.id, id))
    .get();

  await db.update(schema.members)
    .set({ status: "active", approvedAt: now, updatedAt: now })
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

  await hardDeleteMember(db, c.env, id);

  return c.json({ ok: true });
});


function parseJson<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str) as T; }
  catch { return fallback; }
}
