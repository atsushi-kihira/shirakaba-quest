// =============================================================
// 1to1のお誘いメッセージ（DM用）ルート
// GET  /api/oneonone/dm/template → 管理画面で編集できるひな形（なければ既定の文面）
// POST /api/oneonone/dm/ai       → ひな形と申込者のメッセージの重なりを、AIで整えた文面（ボタンを押したときだけ呼ぶ）
// =============================================================
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { resolveEffectiveMemberId, isMemberApproved } from "../services/resolve-member.ts";
import { adjustDmWithAi, loadDmTemplate } from "../services/oneonone-dm.ts";
import type { Env, Variables } from "../types.ts";

export const oneOnOneDmRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
oneOnOneDmRoutes.use("*", authMiddleware);

const MAX_NOTE = 2000;

oneOnOneDmRoutes.get("/template", async (c) => {
  const db = createDb(c.env.DB);
  return c.json({ data: { bodyText: await loadDmTemplate(db) } });
});

oneOnOneDmRoutes.post("/ai", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId || !(await isMemberApproved(db, meId))) {
    return c.json({ error: { code: "forbidden", message: "この機能は、承認されたメンバーのみ使えます" } }, 403);
  }
  const body = await c.req.json<{ partnerName?: string | null; url?: string; note?: string }>().catch(() => ({} as { partnerName?: string | null; url?: string; note?: string }));
  const note = (body.note ?? "").trim();
  const url = (body.url ?? "").trim();
  if (!note || !url || note.length > MAX_NOTE) {
    return c.json({ error: { code: "invalid", message: "メッセージが入力されていないか、長すぎます" } }, 400);
  }
  const me = await db.select({ name: schema.members.name }).from(schema.members).where(eq(schema.members.id, meId)).get();
  const template = await loadDmTemplate(db);
  const text = await adjustDmWithAi({
    apiKey: c.env.ANTHROPIC_API_KEY, isDev: c.env.ENVIRONMENT === "development", template,
    partnerName: body.partnerName?.trim() || null, senderName: me?.name ?? "", url, note,
  });
  if (!text) {
    return c.json({ error: { code: "ai_failed", message: "AIでの調整がうまくいきませんでした。自動で整えた文面をお使いいただくか、少し時間をおいてもう一度お試しください" } }, 502);
  }
  return c.json({ data: { text } });
});
