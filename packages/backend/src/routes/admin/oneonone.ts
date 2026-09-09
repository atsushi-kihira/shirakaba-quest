// =============================================================
// 管理画面 — 1to1履歴管理
// 1) シーズンの期間に記録された1to1履歴を削除（ポイントリセットと同じ考え方）
// 2) 特定メンバーの1to1履歴を選んで個別に削除
// 3) 過去累計の1to1履歴をすべて削除
// いずれも、削除する1to1に紐づくポイント履歴（1to1完了ポイント）・予約(bookings)も
// あわせて削除し、データの整合性を保つ。
// =============================================================
import { Hono } from "hono";
import { eq, and, or, gte, lte, inArray } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import type { Env, Variables } from "../../types.ts";

export const adminOneOnOneRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// D1のバインド変数上限を避けるため、IN句に渡すID件数を安全な単位に分割するヘルパー
const ID_CHUNK_SIZE = 50;
function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) chunks.push(ids.slice(i, i + ID_CHUNK_SIZE));
  return chunks;
}

// 指定した1to1セッション群を、紐づく予約・ポイント履歴もあわせて削除する
async function deleteSessionsCascade(db: ReturnType<typeof createDb>, sessionIds: string[]): Promise<void> {
  for (const chunk of chunkIds(sessionIds)) {
    await db.delete(schema.bookings).where(inArray(schema.bookings.oneOnOneSessionId, chunk));
    await db.delete(schema.pointTransactions).where(
      and(
        eq(schema.pointTransactions.reason, "one_on_one_completed"),
        inArray(schema.pointTransactions.relatedId, chunk)
      )
    );
    await db.delete(schema.oneOnOneSessions).where(inArray(schema.oneOnOneSessions.id, chunk));
  }
}

// ---- GET /api/admin/oneonone ----
// memberId指定時：そのメンバーが関わる1to1履歴一覧（削除対象選択用）
adminOneOnOneRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const memberId = c.req.query("memberId");
  if (!memberId) return c.json({ data: [] });

  const sessions = await db.select().from(schema.oneOnOneSessions)
    .where(or(eq(schema.oneOnOneSessions.requesterId, memberId), eq(schema.oneOnOneSessions.responderId, memberId)))
    .orderBy(schema.oneOnOneSessions.requestedAt)
    .all();
  if (sessions.length === 0) return c.json({ data: [] });

  const partnerIds = [...new Set(sessions.map((s) => (s.requesterId === memberId ? s.responderId : s.requesterId)))];
  const partners = partnerIds.length > 0
    ? await db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji })
        .from(schema.members).where(inArray(schema.members.id, partnerIds)).all()
    : [];
  const partnerMap = new Map(partners.map((p) => [p.id, p]));

  const data = sessions
    .slice()
    .reverse()
    .map((s) => {
      const partnerId = s.requesterId === memberId ? s.responderId : s.requesterId;
      const partner = partnerMap.get(partnerId);
      return {
        id: s.id,
        partnerName: partner?.name ?? "（不明なメンバー）",
        partnerEmoji: partner?.emoji ?? "❓",
        status: s.status,
        requestedAt: s.requestedAt,
        scheduledFor: s.scheduledFor,
        completedAt: s.completedAt,
        autoTransitionReason: s.autoTransitionReason,
      };
    });

  return c.json({ data });
});

// ---- POST /api/admin/oneonone/reset-season ----
adminOneOnOneRoutes.post("/reset-season", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const { seasonId, memberIds } = await c.req.json<{ seasonId?: string; memberIds?: string[] }>()
    .catch(() => ({ seasonId: undefined, memberIds: undefined }));

  if (!seasonId) return c.json({ error: { code: "invalid_input", message: "シーズンを指定してください" } }, 400);

  const season = await db.select().from(schema.seasons).where(eq(schema.seasons.id, seasonId)).get();
  if (!season) return c.json({ error: { code: "not_found", message: "シーズンが見つかりません" } }, 404);

  const endTs = season.endsAt ?? Math.floor(Date.now() / 1000);
  const conditions = [
    gte(schema.oneOnOneSessions.requestedAt, season.startsAt),
    lte(schema.oneOnOneSessions.requestedAt, endTs),
  ];
  if (memberIds && memberIds.length > 0) {
    conditions.push(
      or(
        inArray(schema.oneOnOneSessions.requesterId, memberIds),
        inArray(schema.oneOnOneSessions.responderId, memberIds)
      )!
    );
  }

  const targets = await db.select({ id: schema.oneOnOneSessions.id })
    .from(schema.oneOnOneSessions).where(and(...conditions)).all();

  await deleteSessionsCascade(db, targets.map((t) => t.id));

  console.log(`[ADMIN] Season 1to1 history reset by ${adminId}, season=${seasonId}, ${targets.length} sessions deleted`);
  return c.json({ ok: true, deletedCount: targets.length });
});

// ---- DELETE /api/admin/oneonone/sessions ----
adminOneOnOneRoutes.delete("/sessions", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const { ids } = await c.req.json<{ ids?: string[] }>().catch(() => ({ ids: undefined }));
  const uniqueIds = [...new Set(ids ?? [])];

  if (uniqueIds.length === 0) {
    return c.json({ error: { code: "invalid_input", message: "削除する履歴を選択してください" } }, 400);
  }

  await deleteSessionsCascade(db, uniqueIds);

  console.log(`[ADMIN] 1to1 sessions deleted by ${adminId}: ${uniqueIds.length}`);
  return c.json({ ok: true, deletedCount: uniqueIds.length });
});

// ---- POST /api/admin/oneonone/reset-all ----
adminOneOnOneRoutes.post("/reset-all", async (c) => {
  const db = createDb(c.env.DB);
  const adminId = c.get("userId");
  const { memberIds } = await c.req.json<{ memberIds?: string[] }>().catch(() => ({ memberIds: undefined }));

  const targets = memberIds && memberIds.length > 0
    ? await db.select({ id: schema.oneOnOneSessions.id }).from(schema.oneOnOneSessions)
        .where(or(
          inArray(schema.oneOnOneSessions.requesterId, memberIds),
          inArray(schema.oneOnOneSessions.responderId, memberIds)
        )).all()
    : await db.select({ id: schema.oneOnOneSessions.id }).from(schema.oneOnOneSessions).all();

  await deleteSessionsCascade(db, targets.map((t) => t.id));

  console.log(`[ADMIN] All-time 1to1 history reset by ${adminId}, ${targets.length} sessions deleted`);
  return c.json({ ok: true, deletedCount: targets.length });
});
