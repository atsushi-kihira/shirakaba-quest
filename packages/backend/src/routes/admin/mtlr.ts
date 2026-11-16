// =============================================================
// 管理者向け 統計レポート（メンバー・トラフィック・ライト・レポート = MTLR）
// GET    /api/admin/mtlr/all                — 取り込み済みのレポート（月ごと）と、全員の行・メンバー一覧
// POST   /api/admin/mtlr/preview            — 取り込む前の確認（メンバーへの当てはめ・同じ月のレポートがすでにあるか）
// POST   /api/admin/mtlr/import             — 取り込み（同じ月がすでにあるときは overwrite: true で置き換え）
// DELETE /api/admin/mtlr/reports/:ym        — その月のレポートを削除
// PUT    /api/admin/mtlr/links              — 名前とメンバーを手でひも付ける（memberId: null は「メンバーではない」）
// DELETE /api/admin/mtlr/links/:personKey   — 手でのひも付けを取り消す（自動の当てはめに戻す）
//
// 当面は管理者だけの機能。一般メンバー向けに開くときは、本人の行だけを返す専用のAPIを別に作ること
// （ここの /all は全員の数字を返すので、そのまま開放しない）。
// =============================================================
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { createDb, schema } from "../../db/index.ts";
import { newId } from "../../services/auth.ts";
import { autoLinkUnmatchedRows, resolvePeople, validateImportRows } from "../../services/mtlr.ts";
import { MTLR_STANDARD, mtlrDisplayName, mtlrPersonKey, mtlrYmOf } from "@shared/mtlr";
import type { Env, Variables } from "../../types.ts";

export const adminMtlrRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const err = (code: string, message: string) => ({ error: { code, message } });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BATCH_SIZE = 25;

function validDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

// ---- GET /all ----
adminMtlrRoutes.get("/all", async (c) => {
  const db = createDb(c.env.DB);
  // 取り込み後に登録・承認されたメンバーがいれば、名前が同じ行を自動で結びつける
  await autoLinkUnmatchedRows(db).catch(() => 0);
  const [reports, rows, links, members] = await Promise.all([
    db.select().from(schema.mtlrReports).all(),
    db.select().from(schema.mtlrRows).all(),
    db.select({ personKey: schema.mtlrPersonLinks.personKey, memberId: schema.mtlrPersonLinks.memberId }).from(schema.mtlrPersonLinks).all(),
    db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor, status: schema.members.status })
      .from(schema.members).where(inArray(schema.members.status, ["active", "on_leave"])).all(),
  ]);
  const byReport = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byReport.get(r.reportId) ?? [];
    list.push(r);
    byReport.set(r.reportId, list);
  }
  const data = reports
    .sort((a, b) => a.ym.localeCompare(b.ym))
    .map((rep) => ({
      id: rep.id,
      ym: rep.ym,
      periodFrom: rep.periodFrom,
      periodTo: rep.periodTo,
      createdOn: rep.createdOn,
      standard: rep.standard,
      sourceFilename: rep.sourceFilename,
      importedAt: rep.importedAt,
      rows: (byReport.get(rep.id) ?? [])
        .sort((a, b) => a.sortIndex - b.sortIndex)
        .map((r) => ({
          personKey: r.personKey,
          displayName: r.displayName,
          rawName: r.rawName,
          memberId: r.memberId,
          raw: {
            attended: r.attended, absent: r.absent, late: r.late, medical: r.medical, substitute: r.substitute,
            refInGiven: r.refInGiven, refOutGiven: r.refOutGiven, refOutRate: r.refOutRate,
            refInReceived: r.refInReceived, refOutReceived: r.refOutReceived,
            visitors: r.visitors, oneToOne: r.oneToOne, tyfcb: r.tyfcb, ceu: r.ceu,
            recommend: r.recommend, sponsor: r.sponsor, score: r.score,
          },
        })),
    }));
  return c.json({ data: { reports: data, members, links } });
});

// ---- POST /preview ----
adminMtlrRoutes.post("/preview", async (c) => {
  const db = createDb(c.env.DB);
  const body = await c.req.json<{ rows?: unknown; periodTo?: unknown }>().catch(() => ({} as { rows?: unknown; periodTo?: unknown }));
  const checked = validateImportRows(body.rows);
  if ("error" in checked) return c.json(err("invalid_rows", checked.error), 400);
  const people = await resolvePeople(db, checked.rows.map((r) => r.rawName));
  let existing: { ym: string; rowCount: number; importedAt: number } | null = null;
  if (validDate(body.periodTo)) {
    const ym = mtlrYmOf(body.periodTo);
    const rep = await db.select().from(schema.mtlrReports).where(eq(schema.mtlrReports.ym, ym)).get();
    if (rep) {
      const old = await db.select({ id: schema.mtlrRows.id }).from(schema.mtlrRows).where(eq(schema.mtlrRows.reportId, rep.id)).all();
      existing = { ym, rowCount: old.length, importedAt: rep.importedAt };
    }
  }
  return c.json({ data: { people, existing } });
});

// ---- POST /import ----
adminMtlrRoutes.post("/import", async (c) => {
  const db = createDb(c.env.DB);
  const body = await c.req.json<{
    periodFrom?: unknown; periodTo?: unknown; createdOn?: unknown; sourceFilename?: unknown; overwrite?: unknown; rows?: unknown;
  }>().catch(() => ({} as Record<string, unknown>));

  if (!validDate(body.periodFrom) || !validDate(body.periodTo)) {
    return c.json(err("invalid_period", "レポートの期間（From と To の日付）を入力してください。"), 400);
  }
  if (body.periodFrom > body.periodTo) return c.json(err("invalid_period", "期間の始まりが、終わりより後になっています。"), 400);
  const createdOn = validDate(body.createdOn) ? body.createdOn : "";
  const checked = validateImportRows(body.rows);
  if ("error" in checked) return c.json(err("invalid_rows", checked.error), 400);

  const ym = mtlrYmOf(body.periodTo);
  const existing = await db.select().from(schema.mtlrReports).where(eq(schema.mtlrReports.ym, ym)).get();
  if (existing && body.overwrite !== true) {
    return c.json(err("already_exists", `${ym.replace("-", "年")}月のレポートは、すでに取り込まれています。置き換える場合は、確認のうえもう一度お試しください。`), 409);
  }

  const people = await resolvePeople(db, checked.rows.map((r) => r.rawName));
  const now = Math.floor(Date.now() / 1000);
  const reportId = newId();

  if (existing) {
    await db.batch([
      db.delete(schema.mtlrRows).where(eq(schema.mtlrRows.reportId, existing.id)),
      db.delete(schema.mtlrReports).where(eq(schema.mtlrReports.id, existing.id)),
    ]);
  }
  await db.insert(schema.mtlrReports).values({
    id: reportId,
    ym,
    periodFrom: body.periodFrom,
    periodTo: body.periodTo,
    createdOn,
    standard: MTLR_STANDARD,
    sourceFilename: typeof body.sourceFilename === "string" ? body.sourceFilename.slice(0, 200) : "",
    importedBy: c.get("userId") ?? "",
    importedAt: now,
  });

  const inserts = checked.rows.map((r, i) =>
    db.insert(schema.mtlrRows).values({
      id: newId(),
      reportId,
      sortIndex: i,
      personKey: mtlrPersonKey(r.rawName),
      displayName: mtlrDisplayName(r.rawName),
      rawName: r.rawName,
      memberId: people[i].memberId,
      ...r.raw,
    }),
  );
  for (let i = 0; i < inserts.length; i += BATCH_SIZE) {
    const chunk = inserts.slice(i, i + BATCH_SIZE);
    await db.batch(chunk as [typeof chunk[number], ...typeof chunk]);
  }

  return c.json({
    data: {
      ym,
      rowCount: inserts.length,
      replaced: Boolean(existing),
      unmatched: people.filter((p) => p.via === "none").map((p) => p.displayName),
    },
  });
});

// ---- DELETE /reports/:ym ----
adminMtlrRoutes.delete("/reports/:ym", async (c) => {
  const db = createDb(c.env.DB);
  const ym = c.req.param("ym");
  const rep = await db.select().from(schema.mtlrReports).where(eq(schema.mtlrReports.ym, ym)).get();
  if (!rep) return c.json(err("not_found", "そのレポートは見つかりません。"), 404);
  await db.batch([
    db.delete(schema.mtlrRows).where(eq(schema.mtlrRows.reportId, rep.id)),
    db.delete(schema.mtlrReports).where(eq(schema.mtlrReports.id, rep.id)),
  ]);
  return c.json({ data: { ok: true } });
});

// ---- PUT /links ----
adminMtlrRoutes.put("/links", async (c) => {
  const db = createDb(c.env.DB);
  const body = await c.req.json<{ personKey?: unknown; memberId?: unknown }>().catch(() => ({} as { personKey?: unknown; memberId?: unknown }));
  const personKey = typeof body.personKey === "string" ? body.personKey : "";
  if (!personKey) return c.json(err("invalid_request", "対象の名前が指定されていません。"), 400);
  let memberId: string | null = null;
  if (body.memberId !== null && body.memberId !== undefined) {
    if (typeof body.memberId !== "string") return c.json(err("invalid_request", "メンバーの指定が正しくありません。"), 400);
    const m = await db.select({ id: schema.members.id }).from(schema.members).where(eq(schema.members.id, body.memberId)).get();
    if (!m) return c.json(err("member_not_found", "そのメンバーは見つかりません。"), 404);
    memberId = m.id;
  }
  const now = Math.floor(Date.now() / 1000);
  await db.batch([
    db.insert(schema.mtlrPersonLinks).values({ personKey, memberId, updatedAt: now })
      .onConflictDoUpdate({ target: schema.mtlrPersonLinks.personKey, set: { memberId, updatedAt: now } }),
    db.update(schema.mtlrRows).set({ memberId }).where(eq(schema.mtlrRows.personKey, personKey)),
  ]);
  return c.json({ data: { ok: true } });
});

// ---- DELETE /links/:personKey ----
adminMtlrRoutes.delete("/links/:personKey", async (c) => {
  const db = createDb(c.env.DB);
  const personKey = c.req.param("personKey");
  await db.delete(schema.mtlrPersonLinks).where(eq(schema.mtlrPersonLinks.personKey, personKey));
  // 自動の当てはめをやり直す
  const rows = await db.select({ id: schema.mtlrRows.id, rawName: schema.mtlrRows.rawName }).from(schema.mtlrRows)
    .where(eq(schema.mtlrRows.personKey, personKey)).all();
  if (rows.length > 0) {
    const [match] = await resolvePeople(db, [rows[0].rawName]);
    await db.update(schema.mtlrRows).set({ memberId: match.memberId }).where(eq(schema.mtlrRows.personKey, personKey));
  }
  return c.json({ data: { ok: true } });
});
