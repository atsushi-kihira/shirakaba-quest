// =============================================================
// 共有（読み取り専用）のルート
//   GET /api/shares/options                       — 共有先の選択肢（メンバー・ギルド・自分のチーム）
//   GET /api/shares/with-me                       — 自分に共有されているもの一覧
//   GET /api/shares/setting/:kind/:subjectId      — いまの共有の設定（設定できる人だけ）
//   PUT /api/shares/setting/:kind/:subjectId      — 共有の設定を変える（設定できる人だけ）
//   GET /api/shares/view/:kind/:subjectId         — 共有されたものを見る（見られる人だけ）
// ログイン不要の公開ルートは routes/shared-public.ts（GET /api/shared/:token）
// =============================================================
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId } from "../services/auth.ts";
import { getFrontendUrl } from "../services/frontendUrl.ts";
import { sendPushToMember } from "../services/push.ts";
import { isMemberApproved, resolveEffectiveMemberId } from "../services/resolve-member.ts";
import {
  canManage, getSetting, isShareKind, isSupportedKind, listSharedWithMe, saveSetting, viewAsMember,
  type ShareInput, type ShareKind,
} from "../services/content-share.ts";
import type { Env, Variables } from "../types.ts";

export const shareRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
shareRoutes.use("*", authMiddleware);

const err = (code: string, message: string) => ({ error: { code, message } });
const NOTICE_GROUP_ID = "content-share";

/** 共有のURL（URL共有のときだけ、画面に見せて、コピーしてもらう） */
function shareUrl(env: { FRONTEND_URL?: string }, token: string): string {
  return `${getFrontendUrl(env)}/shared/${token}`;
}

/** 画面の共有ボタンから開く、見るための画面のパス */
export function sharedViewPath(kind: ShareKind, subjectId: string): string {
  return `/shared/${kind}/${subjectId}`;
}

async function me(c: { get: (k: "userId" | "userType") => never | string }, db: ReturnType<typeof createDb>): Promise<string | null> {
  const id = await resolveEffectiveMemberId(db, c.get("userId") as string, c.get("userType") as "member" | "admin");
  if (!id || !(await isMemberApproved(db, id))) return null;
  return id;
}

shareRoutes.get("/options", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await me(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const [members, guilds, myTeams] = await Promise.all([
    db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji }).from(schema.members)
      .where(and(eq(schema.members.status, "active"))).all(),
    db.select({ id: schema.teams.id, name: schema.teams.name, emblemEmoji: schema.teams.emblemEmoji }).from(schema.teams).orderBy(schema.teams.sortOrder).all(),
    db.select({ id: schema.collabTeams.id, name: schema.collabTeams.name, type: schema.collabTeams.type }).from(schema.collabTeamMembers)
      .innerJoin(schema.collabTeams, eq(schema.collabTeams.id, schema.collabTeamMembers.teamId))
      .where(and(eq(schema.collabTeamMembers.memberId, meId), eq(schema.collabTeamMembers.status, "active"), eq(schema.collabTeams.archived, 0))).all(),
  ]);
  return c.json({ data: { members: members.filter((m) => m.id !== meId).sort((a, b) => a.name.localeCompare(b.name, "ja")), guilds, collabTeams: myTeams } });
});

shareRoutes.get("/with-me", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await me(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  return c.json({ data: await listSharedWithMe(db, meId) });
});

function parseKind(v: string): ShareKind | null {
  return isShareKind(v) && isSupportedKind(v) ? v : null;
}

shareRoutes.get("/setting/:kind/:subjectId", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await me(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const kind = parseKind(c.req.param("kind"));
  if (!kind) return c.json(err("not_found", "見つかりません"), 404);
  const subjectId = c.req.param("subjectId");
  const m = await canManage(db, kind, subjectId, meId);
  if (!m) return c.json(err("forbidden", "このものの共有は、持ち主（チームはリーダー）だけが設定できます"), 403);
  const setting = await getSetting(db, kind, subjectId);
  return c.json({ data: { ...setting, title: m.title, url: setting.linkToken ? shareUrl(c.env, setting.linkToken) : null, viewPath: sharedViewPath(kind, subjectId) } });
});

shareRoutes.put("/setting/:kind/:subjectId", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await me(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const kind = parseKind(c.req.param("kind"));
  if (!kind) return c.json(err("not_found", "見つかりません"), 404);
  const subjectId = c.req.param("subjectId");
  const m = await canManage(db, kind, subjectId, meId);
  if (!m) return c.json(err("forbidden", "このものの共有は、持ち主（チームはリーダー）だけが設定できます"), 403);

  const body = await c.req.json<ShareInput>().catch(() => null);
  if (!body || typeof body.scope !== "string") return c.json(err("invalid_input", "共有の範囲を選んでください"), 400);
  const result = await saveSetting(db, kind, subjectId, meId, body);
  if (!result.ok) return c.json(err("invalid_input", result.message), 400);

  // 個別に選ばれた人（あらたに見られるようになった人）には、アプリ内でお知らせする
  if (result.addedMemberIds.length > 0) {
    const sharer = await db.select({ name: schema.members.name }).from(schema.members).where(eq(schema.members.id, meId)).get();
    const path = sharedViewPath(kind, subjectId);
    const title = "共有されました";
    const text = `${sharer?.name ?? "メンバー"}さんが「${m.title}」を共有しました。見るだけで、編集はできません。`;
    const now = Math.floor(Date.now() / 1000);
    for (const id of result.addedMemberIds) {
      await db.insert(schema.memberNotifications).values({
        id: newId(), broadcastId: NOTICE_GROUP_ID, memberId: id, title, body: `${text}\n${getFrontendUrl(c.env)}${path}`, readAt: null, createdAt: now,
      }).run();
    }
    c.executionCtx.waitUntil(Promise.all(result.addedMemberIds.map((id) => sendPushToMember(db, c.env, id, { title, body: text, url: path }).catch(() => {}))));
  }

  const s = result.setting;
  return c.json({ data: { ...s, title: m.title, url: s.linkToken ? shareUrl(c.env, s.linkToken) : null, viewPath: sharedViewPath(kind, subjectId) } });
});

shareRoutes.get("/view/:kind/:subjectId", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await me(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const kind = parseKind(c.req.param("kind"));
  if (!kind) return c.json(err("not_found", "見つかりません"), 404);
  const view = await viewAsMember(db, kind, c.req.param("subjectId"), meId);
  // 共有されていない・共有をやめた・見る権限がないときは、区別せず「見つかりません」にする
  if (!view) return c.json(err("not_found", "この共有は、見つかりませんでした。共有が終わったか、あなたには共有されていません"), 404);
  return c.json({ data: view });
});
