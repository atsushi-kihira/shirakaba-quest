// =============================================================
// 外部ゲスト用の共有URLの予約（ミーティング・定例会の作成画面で、作成前にURLを発行する）
// GET    /api/invite-reservations?kind=meeting|series         → 有効な予約（なければ null）
// POST   /api/invite-reservations  { kind, days? }            → URLを発行（有効な予約があれば再利用し、有効期限を更新）
// DELETE /api/invite-reservations?kind=meeting|series         → URLを無効にする
// =============================================================
import { Hono } from "hono";
import { createDb } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { resolveEffectiveMemberId, isMemberApproved } from "../services/resolve-member.ts";
import {
  DEFAULT_RESERVATION_DAYS, clampDays, discardReservation, getActiveReservation, issueReservation, reservationUrl,
  type ReservationKind,
} from "../services/invite-reservations.ts";
import type { Env, Variables } from "../types.ts";

export const inviteReservationRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
inviteReservationRoutes.use("*", authMiddleware);

const asKind = (v: unknown): ReservationKind | null => (v === "meeting" || v === "series" ? v : null);
const badKind = { error: { code: "invalid", message: "種類の指定が正しくありません" } };

async function approvedMemberId(c: { get: (k: "userId" | "userType") => unknown; env: Env }, db: ReturnType<typeof createDb>): Promise<string | null> {
  const id = await resolveEffectiveMemberId(db, c.get("userId") as string, c.get("userType") as "member" | "admin");
  return id && (await isMemberApproved(db, id)) ? id : null;
}

inviteReservationRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const kind = asKind(c.req.query("kind"));
  if (!kind) return c.json(badKind, 400);
  const me = await approvedMemberId(c, db);
  if (!me) return c.json({ data: null });
  const r = await getActiveReservation(db, me, kind, Math.floor(Date.now() / 1000));
  return c.json({ data: r ? { ...r, url: reservationUrl(c.env, kind, r.token) } : null });
});

inviteReservationRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const body = await c.req.json<{ kind?: unknown; days?: unknown }>().catch(() => ({} as { kind?: unknown; days?: unknown }));
  const kind = asKind(body.kind);
  if (!kind) return c.json(badKind, 400);
  const me = await approvedMemberId(c, db);
  if (!me) return c.json({ error: { code: "not_approved", message: "承認されるまでは、ゲスト用のURLは発行できません" } }, 403);
  const days = body.days === undefined ? DEFAULT_RESERVATION_DAYS : clampDays(body.days);
  const r = await issueReservation(db, me, kind, days, Math.floor(Date.now() / 1000));
  return c.json({ data: { ...r, url: reservationUrl(c.env, kind, r.token) } });
});

inviteReservationRoutes.delete("/", async (c) => {
  const db = createDb(c.env.DB);
  const kind = asKind(c.req.query("kind"));
  if (!kind) return c.json(badKind, 400);
  const me = await approvedMemberId(c, db);
  if (me) await discardReservation(db, me, kind);
  return c.json({ ok: true });
});
