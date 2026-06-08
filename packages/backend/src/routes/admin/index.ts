// =============================================================
// 管理者ルート集約
// =============================================================
import { Hono } from "hono";
import { sum } from "drizzle-orm";
import { adminMemberRoutes } from "./members.ts";
import { adminQuestRoutes } from "./quests.ts";
import { adminUspRoutes } from "./usps.ts";
import { createDb, schema } from "../../db/index.ts";
import { newId } from "../../services/auth.ts";
import type { Env, Variables } from "../../types.ts";

export const adminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

adminRoutes.route("/members", adminMemberRoutes);
adminRoutes.route("/quests", adminQuestRoutes);
adminRoutes.route("/usps", adminUspRoutes);

// ---- POST /api/admin/points/reset ----
adminRoutes.post("/points/reset", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);
  const { label } = await c.req.json<{ label?: string }>().catch(() => ({ label: undefined }));

  const { eq } = await import("drizzle-orm");

  const activeMembers = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(eq(schema.members.status, "active"))
    .all();

  const pointRows = await db
    .select({
      memberId: schema.pointTransactions.memberId,
      total: sum(schema.pointTransactions.delta).as("total"),
    })
    .from(schema.pointTransactions)
    .groupBy(schema.pointTransactions.memberId)
    .all();

  const pointMap = new Map(pointRows.map((r) => [r.memberId, Number(r.total ?? 0)]));

  const inserts = activeMembers
    .filter((m) => (pointMap.get(m.id) ?? 0) > 0)
    .map((m) => ({
      id: newId(),
      memberId: m.id,
      delta: -(pointMap.get(m.id)!),
      reason: "admin_reset" as const,
      relatedId: label ?? null,
      createdAt: now,
    }));

  if (inserts.length > 0) {
    await db.insert(schema.pointTransactions).values(inserts);
  }

  console.log(`[ADMIN] Point reset by ${adminId}, ${inserts.length} members affected`);
  return c.json({ ok: true, affectedMembers: inserts.length });
});

// ---- GET /api/admin/app-settings ----
adminRoutes.get("/app-settings", async (c) => {
  const db = createDb(c.env.DB);
  const design = await db.select().from(schema.cardDesigns).get();
  return c.json({ data: design });
});

// ---- PATCH /api/admin/app-settings ----
adminRoutes.patch("/app-settings", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);
  const body = await c.req.json<Partial<{
    appTitle: string; appLogo: string; appPointName: string;
    termQuest: string; termUsp: string; termOneOnOne: string;
  }>>();

  const { eq } = await import("drizzle-orm");

  await db.update(schema.cardDesigns).set({
    ...(body.appTitle     !== undefined && { appTitle: body.appTitle }),
    ...(body.appLogo      !== undefined && { appLogo: body.appLogo }),
    ...(body.appPointName !== undefined && { appPointName: body.appPointName }),
    ...(body.termQuest    !== undefined && { termQuest: body.termQuest }),
    ...(body.termUsp      !== undefined && { termUsp: body.termUsp }),
    ...(body.termOneOnOne !== undefined && { termOneOnOne: body.termOneOnOne }),
    updatedAt: now,
    updatedBy: adminId,
  }).where(eq(schema.cardDesigns.id, "default"));

  return c.json({ ok: true });
});
