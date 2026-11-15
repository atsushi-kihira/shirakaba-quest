// =============================================================
// 相手の紹介シート（認証必要）。登録した本人だけが読み書きできる。
// GET    /api/profile-sheets/search-index?subjectType — 一覧の検索用：相手のIDごとの、自分のメモの検索用テキスト（連絡手段は含めない）
// GET    /api/profile-sheets?subjectType&subjectId  — 自分が登録したシート（なければ null）
// GET    /api/profile-sheets/index?subjectType      — シートを登録済みの相手のID一覧（一覧の印用）
// PUT    /api/profile-sheets                        — 登録・編集（上書き）
// DELETE /api/profile-sheets?subjectType&subjectId  — 削除
// POST   /api/profile-sheets/extract                — もらった資料（PDF・画像・テキスト）をAIで項目に読み取る（保存はしない）
// POST   /api/profile-sheets/import-csv             — CSVの行をまとめて登録（dryRun:true で、結果の確認だけ）
// =============================================================
import { Hono } from "hono";
import { and, eq, ne } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId } from "../services/auth.ts";
import { resolveEffectiveMemberId } from "../services/resolve-member.ts";
import {
  MAX_SHEET_FILE_BYTES, classifySheetFile, extractSheetFromFile, ExtractionError, getSheet, hasAnyContent,
  loadOwnSheetMap, normalizeFields, saveSheet, sheetSearchText, takeExtractionSlot,
} from "../services/profile-sheet.ts";
import { EXTERNAL_CONTACTS_LIMIT, sweepPendingCompanySummaries } from "./collab.ts";
import { sweepPendingPrefectures } from "../services/prefecture.ts";
import type { ProfileSheetFields, ProfileSheetSubjectType } from "@shared/types";
import type { Env, Variables } from "../types.ts";

export const profileSheetRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
profileSheetRoutes.use("*", authMiddleware);

const NO_MEMBER = { error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } } as const;
const SUBJECT_NG = { error: { code: "not_found", message: "相手が見つかりません。画面を開き直して、もう一度お試しください" } } as const;
const MAX_CSV_ROWS = 500;

type Db = ReturnType<typeof createDb>;

function parseType(v: unknown): ProfileSheetSubjectType | null {
  return v === "member" || v === "contact" ? v : null;
}

/** 名前の比較用：空白（全角含む）をなくし、大文字小文字をそろえる */
function normName(s: string): string {
  return s.normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();
}

/** シートを付けてよい相手か（メンバー＝自分以外の在籍メンバー、外部人脈＝自分の人脈）。相手の名前を返す */
async function checkSubject(db: Db, meId: string, type: ProfileSheetSubjectType, id: string): Promise<{ name: string } | null> {
  if (type === "member") {
    if (id === meId) return null;
    const m = await db.select({ name: schema.members.name, status: schema.members.status }).from(schema.members).where(eq(schema.members.id, id)).get();
    return m && m.status === "active" ? { name: m.name } : null;
  }
  const ct = await db.select({ name: schema.externalContacts.name, owner: schema.externalContacts.ownerMemberId })
    .from(schema.externalContacts).where(eq(schema.externalContacts.id, id)).get();
  return ct && ct.owner === meId ? { name: ct.name } : null;
}

profileSheetRoutes.get("/index", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json(NO_MEMBER, 403);
  const type = parseType(c.req.query("subjectType"));
  if (!type) return c.json({ error: { code: "bad_request", message: "種類を指定してください" } }, 400);
  const rows = await db.select({ id: schema.profileSheets.subjectId }).from(schema.profileSheets)
    .where(and(eq(schema.profileSheets.ownerMemberId, meId), eq(schema.profileSheets.subjectType, type))).all();
  return c.json({ data: rows.map((r) => r.id) });
});

profileSheetRoutes.get("/search-index", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json(NO_MEMBER, 403);
  const type = parseType(c.req.query("subjectType"));
  if (!type) return c.json({ error: { code: "bad_request", message: "種類を指定してください" } }, 400);
  const map = await loadOwnSheetMap(db, meId, type);
  const out: Record<string, string> = {};
  for (const [id, sheet] of map) {
    const text = sheetSearchText(sheet);
    if (text) out[id] = text;
  }
  return c.json({ data: out });
});

profileSheetRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json(NO_MEMBER, 403);
  const type = parseType(c.req.query("subjectType"));
  const id = c.req.query("subjectId") ?? "";
  if (!type || !id) return c.json({ error: { code: "bad_request", message: "相手を指定してください" } }, 400);
  return c.json({ data: await getSheet(db, meId, type, id) });
});

profileSheetRoutes.put("/", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json(NO_MEMBER, 403);
  const body = await c.req.json<{ subjectType?: string; subjectId?: string; fields?: unknown }>().catch(() => null);
  const type = parseType(body?.subjectType);
  if (!body || !type || !body.subjectId) return c.json({ error: { code: "bad_request", message: "相手を指定してください" } }, 400);
  if (!(await checkSubject(db, meId, type, body.subjectId))) return c.json(SUBJECT_NG, 404);
  const fields = normalizeFields(body.fields);
  if (!hasAnyContent(fields)) {
    return c.json({ error: { code: "invalid_input", message: "入力された内容がありません。どれか1つ以上の項目を入力してください" } }, 400);
  }
  const sheet = await saveSheet(db, meId, type, body.subjectId, fields, Math.floor(Date.now() / 1000));
  return c.json({ data: sheet });
});

profileSheetRoutes.delete("/", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json(NO_MEMBER, 403);
  const type = parseType(c.req.query("subjectType"));
  const id = c.req.query("subjectId") ?? "";
  if (!type || !id) return c.json({ error: { code: "bad_request", message: "相手を指定してください" } }, 400);
  await db.delete(schema.profileSheets).where(and(
    eq(schema.profileSheets.ownerMemberId, meId), eq(schema.profileSheets.subjectType, type), eq(schema.profileSheets.subjectId, id),
  ));
  return c.json({ ok: true });
});

profileSheetRoutes.post("/extract", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json(NO_MEMBER, 403);

  const form = await c.req.parseBody().catch(() => null);
  const file = form?.["file"];
  if (!form || !(file instanceof File)) return c.json({ error: { code: "bad_request", message: "資料のファイルを選んでください" } }, 400);
  if (file.size === 0) return c.json({ error: { code: "bad_request", message: "中身のないファイルです。別のファイルをお試しください" } }, 400);
  if (file.size > MAX_SHEET_FILE_BYTES) {
    return c.json({ error: { code: "too_large", message: `ファイルが大きすぎます。${MAX_SHEET_FILE_BYTES / 1024 / 1024}MBまでです` } }, 400);
  }
  const kind = classifySheetFile(file.name);
  if (!kind) {
    return c.json({ error: { code: "bad_type", message: "このファイルは読み取れません。PDF・画像（JPG・PNG・WebP・GIF）・テキストが使えます。WordやPowerPointの資料は、PDFに書き出してからお試しください" } }, 400);
  }
  const subjectType = parseType(form["subjectType"]);
  const subjectId = typeof form["subjectId"] === "string" ? form["subjectId"] : "";
  let hintName: string | undefined;
  if (subjectType && subjectId) {
    const s = await checkSubject(db, meId, subjectType, subjectId);
    if (!s) return c.json(SUBJECT_NG, 404);
    hintName = s.name;
  } else if (typeof form["hintName"] === "string" && form["hintName"].trim()) {
    hintName = form["hintName"].trim().slice(0, 100);
  }

  const now = Math.floor(Date.now() / 1000);
  if (!(await takeExtractionSlot(db, meId, now))) {
    return c.json({ error: { code: "rate_limited", message: "今日は、資料の読み取りを使いすぎています。明日また、お試しください（手で入力することはできます）" } }, 429);
  }
  try {
    const fields = await extractSheetFromFile({
      apiKey: c.env.ANTHROPIC_API_KEY, isDev: c.env.ENVIRONMENT === "development",
      bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name, kind, hintName,
    });
    return c.json({ data: fields });
  } catch (e) {
    console.error("profile sheet extract failed", e instanceof Error ? e.message : e);
    const msg = e instanceof ExtractionError && e.message.includes("解釈")
      ? "資料から項目を読み取れませんでした。別のファイルをお試しいただくか、手で入力してください"
      : "資料の読み取りに失敗しました。少し待ってから、もう一度お試しください";
    return c.json({ error: { code: "extract_failed", message: msg } }, 502);
  }
});

// ---- CSV一括登録 ----
type CsvRowResult = {
  line: number;                 // CSVの行番号の目安（1始まり。見出しの次の行が1）
  name: string;
  status: "update" | "create" | "skip";
  reason?: string;
  subjectId?: string;
};

profileSheetRoutes.post("/import-csv", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json(NO_MEMBER, 403);
  const body = await c.req.json<{ subjectType?: string; rows?: unknown[]; dryRun?: boolean; createVisibility?: string }>().catch(() => null);
  const type = parseType(body?.subjectType);
  if (!body || !type || !Array.isArray(body.rows)) return c.json({ error: { code: "bad_request", message: "取り込む内容がありません" } }, 400);
  if (body.rows.length === 0) return c.json({ error: { code: "invalid_input", message: "取り込める行がありません" } }, 400);
  if (body.rows.length > MAX_CSV_ROWS) {
    return c.json({ error: { code: "too_many", message: `一度に取り込めるのは${MAX_CSV_ROWS}行までです。ファイルを分けてお試しください` } }, 400);
  }
  const dryRun = body.dryRun === true;
  const createVisibility = ["private", "existence", "full"].includes(body.createVisibility ?? "") ? body.createVisibility! : "existence";

  const parsed = body.rows.map((r, i) => ({ line: i + 1, fields: normalizeFields(r) }));

  // 相手の候補：メンバー＝自分以外の在籍メンバー、外部人脈＝自分の人脈
  type Cand = { id: string; name: string; company: string; furigana: string };
  let cands: Cand[];
  if (type === "member") {
    const rows = await db.select({ id: schema.members.id, name: schema.members.name, company: schema.members.company, furigana: schema.members.furigana })
      .from(schema.members).where(and(eq(schema.members.status, "active"), ne(schema.members.id, meId))).all();
    cands = rows.map((r) => ({ id: r.id, name: r.name, company: r.company ?? "", furigana: r.furigana }));
  } else {
    const rows = await db.select({ id: schema.externalContacts.id, name: schema.externalContacts.name, company: schema.externalContacts.company })
      .from(schema.externalContacts).where(eq(schema.externalContacts.ownerMemberId, meId)).all();
    cands = rows.map((r) => ({ id: r.id, name: r.name, company: r.company ?? "", furigana: "" }));
  }

  const results: CsvRowResult[] = [];
  const toSave: { subjectId: string; fields: ProfileSheetFields }[] = [];
  const toCreate: { line: number; fields: ProfileSheetFields }[] = [];
  const seenSubjects = new Set<string>();
  const seenNewNames = new Set<string>();

  for (const { line, fields } of parsed) {
    if (!fields.name) { results.push({ line, name: "", status: "skip", reason: "名前が空です" }); continue; }
    const key = normName(fields.name);
    let hits = cands.filter((cd) => normName(cd.name) === key);
    if (hits.length === 0 && type === "member" && fields.furigana) {
      const fk = normName(fields.furigana);
      hits = cands.filter((cd) => cd.furigana && normName(cd.furigana) === fk);
    }
    if (hits.length > 1 && fields.company) {
      const narrowed = hits.filter((cd) => cd.company && normName(cd.company) === normName(fields.company));
      if (narrowed.length > 0) hits = narrowed;
    }
    if (hits.length > 1) {
      results.push({ line, name: fields.name, status: "skip", reason: "同じ名前の人が複数いて、決められません（会社・屋号を入れると、選べます）" });
    } else if (hits.length === 1) {
      const subjectId = hits[0]!.id;
      if (seenSubjects.has(subjectId)) {
        results.push({ line, name: fields.name, status: "skip", reason: "同じ人の行が、ファイルの中に複数あります（最初の行だけ取り込みます）" });
        continue;
      }
      seenSubjects.add(subjectId);
      results.push({ line, name: fields.name, status: "update", subjectId });
      toSave.push({ subjectId, fields });
    } else if (type === "member") {
      results.push({ line, name: fields.name, status: "skip", reason: "白樺クエストに登録されているメンバーに、見つかりません" });
    } else {
      if (seenNewNames.has(key)) {
        results.push({ line, name: fields.name, status: "skip", reason: "同じ名前の行が、ファイルの中に複数あります（最初の行だけ取り込みます）" });
        continue;
      }
      seenNewNames.add(key);
      results.push({ line, name: fields.name, status: "create" });
      toCreate.push({ line, fields });
    }
  }

  // 新しく人脈を作る分は、人脈の上限（非公開をのぞく）を超えないか確かめる
  if (toCreate.length > 0 && createVisibility !== "private") {
    const existing = await db.select({ id: schema.externalContacts.id }).from(schema.externalContacts)
      .where(and(eq(schema.externalContacts.ownerMemberId, meId), ne(schema.externalContacts.visibility, "private"))).all();
    const remaining = EXTERNAL_CONTACTS_LIMIT - existing.length;
    if (toCreate.length > remaining) {
      return c.json({ error: { code: "contact_limit_exceeded", message: `外部人脈は非公開を除いて合計${EXTERNAL_CONTACTS_LIMIT}件まで登録できます。あと${Math.max(remaining, 0)}件ぶんしか、新しく作れません（新しく作る人が${toCreate.length}人います）。` } }, 400);
    }
  }

  const summary = {
    update: results.filter((r) => r.status === "update").length,
    create: results.filter((r) => r.status === "create").length,
    skip: results.filter((r) => r.status === "skip").length,
  };
  if (dryRun) return c.json({ data: { results, summary } });

  const now = Math.floor(Date.now() / 1000);
  for (const s of toSave) await saveSheet(db, meId, type, s.subjectId, s.fields, now);

  if (toCreate.length > 0) {
    for (const t of toCreate) {
      const id = newId();
      const company = t.fields.company || null;
      await db.insert(schema.externalContacts).values({
        id, ownerMemberId: meId, name: t.fields.name, specialty: null, company, note: null, email: null,
        visibility: createVisibility, source: "manual", createdAt: now, updatedAt: now,
        businessSummaryStatus: company && createVisibility !== "private" ? "pending" : "skipped",
      });
      await saveSheet(db, meId, "contact", id, t.fields, now);
      const r = results.find((x) => x.line === t.line);
      if (r) r.subjectId = id;
    }
    const origin = new URL(c.req.url).origin;
    c.executionCtx.waitUntil(sweepPendingPrefectures(db, c.env, origin, 0));
    if (createVisibility !== "private") c.executionCtx.waitUntil(sweepPendingCompanySummaries(db, c.env, origin, 0));
  }
  return c.json({ data: { results, summary } });
});
