// =============================================================
// 管理者向けメンバー管理ルート
// GET    /api/admin/members
// PATCH  /api/admin/members/:id/approve
// PATCH  /api/admin/members/:id/suspend
// PATCH  /api/admin/members/:id/unsuspend
// DELETE /api/admin/members/:id
// =============================================================
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import type { Skill } from "@shared/types";

export const adminMemberRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- GET /api/admin/members ----
adminMemberRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);

  const members = await db
    .select()
    .from(schema.members)
    .all();

  return c.json({
    data: members.map((m) => ({
      ...m,
      skills: parseJson<Skill[]>(m.skills, []),
      customFields: parseJson(m.customFields, {}),
    })),
  });
});

// ---- PATCH /api/admin/members/:id/approve ----
adminMemberRoutes.patch("/:id/approve", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  await db.update(schema.members)
    .set({ status: "active", approvedAt: now, updatedAt: now })
    .where(eq(schema.members.id, c.req.param("id")));

  return c.json({ ok: true });
});

// ---- PATCH /api/admin/members/:id/suspend ----
adminMemberRoutes.patch("/:id/suspend", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  await db.update(schema.members)
    .set({ status: "suspended", updatedAt: now })
    .where(eq(schema.members.id, c.req.param("id")));

  return c.json({ ok: true });
});

// ---- PATCH /api/admin/members/:id/unsuspend ----
adminMemberRoutes.patch("/:id/unsuspend", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  await db.update(schema.members)
    .set({ status: "active", updatedAt: now })
    .where(eq(schema.members.id, c.req.param("id")));

  return c.json({ ok: true });
});

// ---- DELETE /api/admin/members/:id ----
adminMemberRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  // ソフトデリート
  await db.update(schema.members)
    .set({ status: "deleted", updatedAt: now })
    .where(eq(schema.members.id, c.req.param("id")));

  return c.json({ ok: true });
});


function parseJson<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str) as T; }
  catch { return fallback; }
}
