// =============================================================
// 予定のリマインド通知（1to1・ミーティング・定例会）の設定と、ホーム画面のリマインド
// GET    /api/reminders/settings        → 自分の初期設定
// PUT    /api/reminders/settings        → 初期設定を保存
// GET    /api/reminders/target          → ある予定の設定（?kind=&id=）。予定ごとの設定がなければ、初期設定
// PUT    /api/reminders/target          → ある予定だけの設定を保存
// DELETE /api/reminders/target          → ある予定だけの設定をやめて、初期設定に戻す（?kind=&id=）
// GET    /api/reminders/notices         → ホーム画面・通知画面に出すリマインド（未確認のもの）
// GET    /api/reminders/notices/history → 通知画面の履歴（確認済み・予定が始まったもの）
// POST   /api/reminders/notices/:id/read → リマインドを確認済みにする
// リマインドは、届ける相手本人が決める。主催者や相手が、他のメンバーの設定を変えたり、一方的に送ったりすることはできない
// =============================================================
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { resolveEffectiveMemberId } from "../services/resolve-member.ts";
import {
  DEFAULT_REMINDER, TARGET_KINDS, listHomeNotices, listNoticeHistory, normalizeSetting, parseSetting,
  type ReminderTargetKind,
} from "../services/event-reminders.ts";
import type { Env, Variables } from "../types.ts";

export const reminderRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
reminderRoutes.use("*", authMiddleware);

const invalid = (message: string) => ({ error: { code: "invalid", message } });
const INVALID_SETTING = "リマインドの設定が正しくありません。何日前か（1〜14日前、最大2つ）と、届け方を選び直してください";

async function myId(c: { get: (k: "userId" | "userType") => never | string }, db: ReturnType<typeof createDb>): Promise<string | null> {
  return resolveEffectiveMemberId(db, c.get("userId") as string, c.get("userType") as "member" | "admin");
}

async function loadDefault(db: ReturnType<typeof createDb>, memberId: string) {
  const row = await db.select().from(schema.memberReminderSettings).where(eq(schema.memberReminderSettings.memberId, memberId)).get();
  return { setting: row ? parseSetting(row.daysJson, row.channel) : { ...DEFAULT_REMINDER }, isDefault: !row };
}

reminderRoutes.get("/settings", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await myId(c, db);
  if (!meId) return c.json(invalid("ログインし直してください"), 401);
  const { setting, isDefault } = await loadDefault(db, meId);
  return c.json({ data: { ...setting, isDefault } });
});

reminderRoutes.put("/settings", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await myId(c, db);
  if (!meId) return c.json(invalid("ログインし直してください"), 401);
  const setting = normalizeSetting(await c.req.json<{ days?: unknown; channel?: unknown }>().catch(() => ({})));
  if (!setting) return c.json(invalid(INVALID_SETTING), 400);
  const now = Math.floor(Date.now() / 1000);
  await db.insert(schema.memberReminderSettings)
    .values({ memberId: meId, daysJson: JSON.stringify(setting.days), channel: setting.channel, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.memberReminderSettings.memberId,
      set: { daysJson: JSON.stringify(setting.days), channel: setting.channel, updatedAt: now },
    });
  return c.json({ data: { ...setting, isDefault: false } });
});

function parseTarget(kind: string | undefined, id: string | undefined): { kind: ReminderTargetKind; id: string } | null {
  if (!kind || !id || !(TARGET_KINDS as string[]).includes(kind)) return null;
  return { kind: kind as ReminderTargetKind, id };
}

reminderRoutes.get("/target", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await myId(c, db);
  if (!meId) return c.json(invalid("ログインし直してください"), 401);
  const t = parseTarget(c.req.query("kind"), c.req.query("id"));
  if (!t) return c.json(invalid("予定の指定が正しくありません"), 400);

  const getOverride = async (kind: string, id: string) => db.select().from(schema.reminderOverrides)
    .where(and(eq(schema.reminderOverrides.memberId, meId), eq(schema.reminderOverrides.targetKind, kind), eq(schema.reminderOverrides.targetId, id))).get();
  const own = await getOverride(t.kind, t.id);
  // 定例会の開催回は、定例会全体の設定を引き継ぐ
  let seriesId: string | null = null;
  if (t.kind === "meeting") {
    const m = await db.select({ seriesId: schema.meetings.seriesId }).from(schema.meetings).where(eq(schema.meetings.id, t.id)).get();
    seriesId = m?.seriesId ?? null;
  } else if (t.kind === "series") seriesId = t.id;
  const seriesOverride = !own && seriesId && t.kind === "meeting" ? await getOverride("series", seriesId) : undefined;
  const { setting: defaults } = await loadDefault(db, meId);

  const source = own ? "own" : seriesOverride ? "series" : "default";
  const effective = own ? parseSetting(own.daysJson, own.channel) : seriesOverride ? parseSetting(seriesOverride.daysJson, seriesOverride.channel) : defaults;
  return c.json({ data: { ...effective, source, seriesId: t.kind === "meeting" ? seriesId : null, defaults } });
});

reminderRoutes.put("/target", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await myId(c, db);
  if (!meId) return c.json(invalid("ログインし直してください"), 401);
  const body = await c.req.json<{ kind?: string; id?: string; days?: unknown; channel?: unknown }>().catch(() => ({} as { kind?: string; id?: string; days?: unknown; channel?: unknown }));
  const t = parseTarget(body.kind, body.id);
  if (!t) return c.json(invalid("予定の指定が正しくありません"), 400);
  const setting = normalizeSetting(body);
  if (!setting) return c.json(invalid(INVALID_SETTING), 400);
  const now = Math.floor(Date.now() / 1000);
  await db.insert(schema.reminderOverrides)
    .values({ memberId: meId, targetKind: t.kind, targetId: t.id, daysJson: JSON.stringify(setting.days), channel: setting.channel, updatedAt: now })
    .onConflictDoUpdate({
      target: [schema.reminderOverrides.memberId, schema.reminderOverrides.targetKind, schema.reminderOverrides.targetId],
      set: { daysJson: JSON.stringify(setting.days), channel: setting.channel, updatedAt: now },
    });
  return c.json({ data: { ...setting, source: "own" } });
});

reminderRoutes.delete("/target", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await myId(c, db);
  if (!meId) return c.json(invalid("ログインし直してください"), 401);
  const t = parseTarget(c.req.query("kind"), c.req.query("id"));
  if (!t) return c.json(invalid("予定の指定が正しくありません"), 400);
  await db.delete(schema.reminderOverrides).where(and(
    eq(schema.reminderOverrides.memberId, meId), eq(schema.reminderOverrides.targetKind, t.kind), eq(schema.reminderOverrides.targetId, t.id)));
  return c.json({ ok: true });
});

reminderRoutes.get("/notices", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await myId(c, db);
  if (!meId) return c.json({ data: [] });
  return c.json({ data: await listHomeNotices(db, meId) });
});

reminderRoutes.get("/notices/history", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await myId(c, db);
  if (!meId) return c.json({ data: [] });
  return c.json({ data: await listNoticeHistory(db, meId) });
});

reminderRoutes.post("/notices/:id/read", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await myId(c, db);
  if (!meId) return c.json({ ok: true });
  await db.update(schema.reminderNotices).set({ readAt: Math.floor(Date.now() / 1000) })
    .where(and(eq(schema.reminderNotices.id, c.req.param("id")), eq(schema.reminderNotices.memberId, meId)));
  return c.json({ ok: true });
});
