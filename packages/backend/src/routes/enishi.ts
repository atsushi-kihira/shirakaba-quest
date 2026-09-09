// =============================================================
// ご縁さがし ルート
// GET/POST/PATCH/DELETE /api/enishi/eggs   → 金の卵（狙いたい案件・紹介先）CRUD
// GET/POST/PATCH/DELETE /api/enishi/geese  → 金のガチョウ（運んでくれそうな立場）CRUD
// GET  /api/enishi/member/:memberId → 指定メンバーの金の卵・ガチョウ概要（閲覧のみ）
// GET  /api/enishi/contributors   → 金の卵・ガチョウを登録しているメンバー一覧（貢献のご縁の対象選択用）
// POST /api/enishi/search/for-me  → 私のご縁（自分の卵/ガチョウ × なかまの人脈）
// POST /api/enishi/search/giver   → 貢献のご縁（自分の人脈 × 指定したメンバーの卵/ガチョウ）
// =============================================================
import { Hono } from "hono";
import { and, eq, desc, inArray, ne } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId } from "../services/auth.ts";
import { resolveEffectiveMemberId } from "../services/resolve-member.ts";
import { runEnishiSearch } from "../services/enishi-search.ts";
import type { EnishiResultCard, EnishiSearchResult, EnishiTarget, Hop } from "../services/enishi-search.ts";
import type { Env, Variables } from "../types.ts";

const MAX_EGGS = 8;
const MAX_GEESE = 8;
// 貢献のご縁で一度に指定できる貢献先メンバー数（登録者が増えてもAI消費量が際限なく増えないようにする上限）
const MAX_GIVER_TARGET_MEMBERS = 5;
// 検索履歴の一覧表示件数の上限
const HISTORY_LIST_LIMIT = 100;
// 「良いご縁だった」の過去実績をプロンプトに含める際、遡って調べる履歴件数・実際に含める件数の上限
const GOOD_MATCH_HISTORY_SCAN_LIMIT = 50;
const GOOD_MATCH_CONTEXT_LIMIT = 15;
// 検索で実際にAIへ依頼する件数の上限（常にこの上限まで検索し、履歴にはすべて保存する。
// 画面側の「表示件数」はこの結果を何件ずつページ分割して見せるかだけを制御する表示設定であり、
// 表示件数を変えるたびに再検索が走らないようにするため、検索自体は常にこの固定値で行う）。
const MAX_RESULTS = 30;

type HistoryCard = EnishiResultCard & { cardId: string; goodMatch: boolean; transacted: boolean; introduced: boolean };
type HistoryResult = Omit<EnishiSearchResult, "groups"> & { groups: { hop: Hop; label: string; results: HistoryCard[] }[] };

// 検索結果の各カードに、履歴保存用の識別子（cardId）・「良いご縁だった」フラグの初期値・
// 「このご縁で繋がりました」「紹介しました」フラグの現在値を付与する（いずれもcandidateId等の
// 組み合わせで判定するため、検索直後は既に除外済みのはずで常にfalseになる。履歴を後から見返す際は
// 「良いご縁だった」と違いresultJsonに固定保存せず、表示のたびにこの関数で最新の状態を計算し直す）。
function augmentResultWithCards(result: EnishiSearchResult, transactedIds: Set<string>, introducedKeys: Set<string>): HistoryResult {
  let counter = 0;
  return {
    ...result,
    groups: result.groups.map((g) => ({
      ...g,
      results: g.results.map((r) => ({
        ...r, cardId: `c${counter++}`, goodMatch: false,
        transacted: transactedIds.has(r.candidateId),
        introduced: r.myContactId ? introducedKeys.has(`${r.myContactId}|${r.candidateId}`) : false,
      })),
    })),
  };
}

async function fetchTransactedContactIds(db: ReturnType<typeof createDb>, meId: string): Promise<Set<string>> {
  const rows = await db.select({ contactId: schema.enishiTransactedContacts.contactId })
    .from(schema.enishiTransactedContacts)
    .where(eq(schema.enishiTransactedContacts.memberId, meId))
    .all();
  return new Set(rows.map((r) => r.contactId));
}

async function fetchIntroducedKeys(db: ReturnType<typeof createDb>, meId: string): Promise<Set<string>> {
  const rows = await db.select({
    myContactId: schema.enishiIntroducedContacts.myContactId,
    candidateId: schema.enishiIntroducedContacts.candidateId,
  }).from(schema.enishiIntroducedContacts).where(eq(schema.enishiIntroducedContacts.memberId, meId)).all();
  return new Set(rows.map((r) => `${r.myContactId}|${r.candidateId}`));
}

function formatHistoryDate(ts: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(ts * 1000));
}

// 検索結果として実際に見つかった件数（グループ横断の合計）。履歴タイトルに含めて一覧で見分けやすくする。
function countResults(result: EnishiSearchResult): number {
  return result.groups.reduce((sum, g) => sum + g.results.length, 0);
}

function buildForMeTitle(targets: EnishiTarget[], createdAt: number, resultCount: number): string {
  const first = targets[0]?.description ?? "";
  const firstShort = first.length > 18 ? `${first.slice(0, 18)}…` : first;
  const suffix = targets.length > 1 ? ` ほか${targets.length - 1}件` : "";
  return `${formatHistoryDate(createdAt)} 私のご縁：${firstShort}${suffix}（${resultCount}件ヒット）`;
}

function buildGiverTitle(targetMemberNames: string[], createdAt: number, resultCount: number): string {
  const shown = targetMemberNames.slice(0, 3).join("・");
  const suffix = targetMemberNames.length > 3 ? ` ほか${targetMemberNames.length - 3}名` : "";
  return `${formatHistoryDate(createdAt)} 貢献のご縁：${shown || "なかま"}${suffix}へ（${resultCount}件ヒット）`;
}

// 自分の過去の検索履歴から「良いご縁だった」とチェック済みのカードを集め、プロンプトに追記する
// 参考情報を組み立てる（本人の履歴のみを対象にするため、他のユーザーには影響しない）。
async function buildGoodMatchContext(
  db: ReturnType<typeof createDb>, meId: string, mode: "for-me" | "giver"
): Promise<string | undefined> {
  const rows = await db.select({ resultJson: schema.enishiSearchHistory.resultJson })
    .from(schema.enishiSearchHistory)
    .where(and(eq(schema.enishiSearchHistory.memberId, meId), eq(schema.enishiSearchHistory.mode, mode)))
    .orderBy(desc(schema.enishiSearchHistory.createdAt))
    .limit(GOOD_MATCH_HISTORY_SCAN_LIMIT)
    .all();

  const goodCards: { counterpartName: string; matchedTargetLabel: string; dealDescription: string }[] = [];
  for (const row of rows) {
    if (goodCards.length >= GOOD_MATCH_CONTEXT_LIMIT) break;
    try {
      const parsed = JSON.parse(row.resultJson) as HistoryResult;
      for (const g of parsed.groups ?? []) {
        for (const r of g.results ?? []) {
          if (r.goodMatch && r.counterpart?.name && r.matchedTargetLabel && r.dealDescription) {
            goodCards.push({ counterpartName: r.counterpart.name, matchedTargetLabel: r.matchedTargetLabel, dealDescription: r.dealDescription });
          }
        }
      }
    } catch {
      // 壊れたJSON（想定外）は無視して次の履歴へ
    }
  }
  if (goodCards.length === 0) return undefined;
  const lines = goodCards.slice(0, GOOD_MATCH_CONTEXT_LIMIT)
    .map((c) => `- ${c.counterpartName}さん / ${c.matchedTargetLabel} / ${c.dealDescription}`);
  return `

# 参考：あなたが過去に「良いご縁だった」と評価した組み合わせ（同じ組み合わせが再度候補に挙がる場合は積極的に採用し、似た傾向のパターンも参考にしてください）
${lines.join("\n")}`;
}

async function saveSearchHistory(
  db: ReturnType<typeof createDb>,
  meId: string,
  mode: "for-me" | "giver",
  title: string,
  params: unknown,
  result: EnishiSearchResult,
  now: number
): Promise<{ historyId: string; result: HistoryResult }> {
  // 検索直後の時点では、「このご縁で繋がりました」「紹介しました」済みのものはすでに候補から
  // 除外されているため常にfalseになる
  const augmented = augmentResultWithCards(result, new Set(), new Set());
  const historyId = newId();
  await db.insert(schema.enishiSearchHistory).values({
    id: historyId, memberId: meId, mode, title,
    paramsJson: JSON.stringify(params),
    resultJson: JSON.stringify(augmented),
    createdAt: now,
  });
  return { historyId, result: augmented };
}

export const enishiRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
enishiRoutes.use("*", authMiddleware);

// ---- GET /api/enishi/eggs ----
enishiRoutes.get("/eggs", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const rows = await db.select().from(schema.goldenEggs)
    .where(eq(schema.goldenEggs.memberId, meId))
    .orderBy(schema.goldenEggs.createdAt)
    .all();
  return c.json({ data: rows });
});

// ---- POST /api/enishi/eggs ----
enishiRoutes.post("/eggs", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const body = await c.req.json<{ description: string; issue?: string; priceRange?: string; region?: string }>();
  if (!body.description?.trim()) return c.json({ error: { code: "invalid_input", message: "「どんな企業か」を入力してください" } }, 400);

  const existing = await db.select({ id: schema.goldenEggs.id }).from(schema.goldenEggs)
    .where(eq(schema.goldenEggs.memberId, meId)).all();
  if (existing.length >= MAX_EGGS) {
    return c.json({ error: { code: "egg_limit_exceeded", message: `金の卵は最大${MAX_EGGS}件まで登録できます。すでに上限に達しています。` } }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const id = newId();
  await db.insert(schema.goldenEggs).values({
    id, memberId: meId,
    description: body.description.trim(),
    issue: body.issue?.trim() || null,
    priceRange: body.priceRange?.trim() || null,
    region: body.region?.trim() || null,
    createdAt: now, updatedAt: now,
  });
  return c.json({ data: { id } }, 201);
});

// ---- PATCH /api/enishi/eggs/:id ----
enishiRoutes.patch("/eggs/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);
  const id = c.req.param("id");

  const egg = await db.select().from(schema.goldenEggs).where(eq(schema.goldenEggs.id, id)).get();
  if (!egg || egg.memberId !== meId) return c.json({ error: { code: "not_found", message: "指定された金の卵が見つかりません" } }, 404);

  const body = await c.req.json<{ description?: string; issue?: string; priceRange?: string; region?: string }>();
  if (body.description !== undefined && !body.description.trim()) {
    return c.json({ error: { code: "invalid_input", message: "「どんな企業か」を入力してください" } }, 400);
  }

  await db.update(schema.goldenEggs).set({
    ...(body.description !== undefined ? { description: body.description.trim() } : {}),
    ...(body.issue !== undefined ? { issue: body.issue.trim() || null } : {}),
    ...(body.priceRange !== undefined ? { priceRange: body.priceRange.trim() || null } : {}),
    ...(body.region !== undefined ? { region: body.region.trim() || null } : {}),
    updatedAt: Math.floor(Date.now() / 1000),
  }).where(eq(schema.goldenEggs.id, id));
  return c.json({ ok: true });
});

// ---- DELETE /api/enishi/eggs/:id ----
enishiRoutes.delete("/eggs/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);
  const id = c.req.param("id");

  const egg = await db.select().from(schema.goldenEggs).where(eq(schema.goldenEggs.id, id)).get();
  if (!egg || egg.memberId !== meId) return c.json({ error: { code: "not_found", message: "指定された金の卵が見つかりません" } }, 404);

  await db.delete(schema.goldenEggs).where(eq(schema.goldenEggs.id, id));
  return c.json({ ok: true });
});

// ---- GET /api/enishi/geese ----
enishiRoutes.get("/geese", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const rows = await db.select().from(schema.goldenGeese)
    .where(eq(schema.goldenGeese.memberId, meId))
    .orderBy(schema.goldenGeese.createdAt)
    .all();
  return c.json({ data: rows });
});

// ---- POST /api/enishi/geese ----
enishiRoutes.post("/geese", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const body = await c.req.json<{ description: string; contactHypothesis?: string; priority?: string }>();
  if (!body.description?.trim()) return c.json({ error: { code: "invalid_input", message: "「どんな立場の人か」を入力してください" } }, 400);

  const existing = await db.select({ id: schema.goldenGeese.id }).from(schema.goldenGeese)
    .where(eq(schema.goldenGeese.memberId, meId)).all();
  if (existing.length >= MAX_GEESE) {
    return c.json({ error: { code: "goose_limit_exceeded", message: `金のガチョウは最大${MAX_GEESE}件まで登録できます。すでに上限に達しています。` } }, 400);
  }

  const priority = ["高", "中", "低"].includes(body.priority ?? "") ? body.priority : null;
  const now = Math.floor(Date.now() / 1000);
  const id = newId();
  await db.insert(schema.goldenGeese).values({
    id, memberId: meId,
    description: body.description.trim(),
    contactHypothesis: body.contactHypothesis?.trim() || null,
    priority,
    createdAt: now, updatedAt: now,
  });
  return c.json({ data: { id } }, 201);
});

// ---- PATCH /api/enishi/geese/:id ----
enishiRoutes.patch("/geese/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);
  const id = c.req.param("id");

  const goose = await db.select().from(schema.goldenGeese).where(eq(schema.goldenGeese.id, id)).get();
  if (!goose || goose.memberId !== meId) return c.json({ error: { code: "not_found", message: "指定された金のガチョウが見つかりません" } }, 404);

  const body = await c.req.json<{ description?: string; contactHypothesis?: string; priority?: string }>();
  if (body.description !== undefined && !body.description.trim()) {
    return c.json({ error: { code: "invalid_input", message: "「どんな立場の人か」を入力してください" } }, 400);
  }
  const priority = body.priority !== undefined
    ? (["高", "中", "低"].includes(body.priority) ? body.priority : null)
    : undefined;

  await db.update(schema.goldenGeese).set({
    ...(body.description !== undefined ? { description: body.description.trim() } : {}),
    ...(body.contactHypothesis !== undefined ? { contactHypothesis: body.contactHypothesis.trim() || null } : {}),
    ...(priority !== undefined ? { priority } : {}),
    updatedAt: Math.floor(Date.now() / 1000),
  }).where(eq(schema.goldenGeese.id, id));
  return c.json({ ok: true });
});

// ---- DELETE /api/enishi/geese/:id ----
enishiRoutes.delete("/geese/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);
  const id = c.req.param("id");

  const goose = await db.select().from(schema.goldenGeese).where(eq(schema.goldenGeese.id, id)).get();
  if (!goose || goose.memberId !== meId) return c.json({ error: { code: "not_found", message: "指定された金のガチョウが見つかりません" } }, 404);

  await db.delete(schema.goldenGeese).where(eq(schema.goldenGeese.id, id));
  return c.json({ ok: true });
});

// ---- GET /api/enishi/member/:memberId ---- 指定メンバーの金の卵・ガチョウ概要
enishiRoutes.get("/member/:memberId", async (c) => {
  const db = createDb(c.env.DB);
  const targetId = c.req.param("memberId");

  const eggs = await db.select().from(schema.goldenEggs)
    .where(eq(schema.goldenEggs.memberId, targetId))
    .orderBy(schema.goldenEggs.createdAt)
    .all();
  const geese = await db.select().from(schema.goldenGeese)
    .where(eq(schema.goldenGeese.memberId, targetId))
    .orderBy(schema.goldenGeese.createdAt)
    .all();

  return c.json({ data: { eggs, geese } });
});

// ---- GET /api/enishi/contributors ---- 金の卵・ガチョウを登録しているメンバー一覧（自分以外・貢献のご縁の対象選択用）
enishiRoutes.get("/contributors", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const [eggRows, gooseRows] = await Promise.all([
    db.select({ memberId: schema.goldenEggs.memberId }).from(schema.goldenEggs).where(ne(schema.goldenEggs.memberId, meId)).all(),
    db.select({ memberId: schema.goldenGeese.memberId }).from(schema.goldenGeese).where(ne(schema.goldenGeese.memberId, meId)).all(),
  ]);
  const eggCountMap = new Map<string, number>();
  for (const r of eggRows) eggCountMap.set(r.memberId, (eggCountMap.get(r.memberId) ?? 0) + 1);
  const gooseCountMap = new Map<string, number>();
  for (const r of gooseRows) gooseCountMap.set(r.memberId, (gooseCountMap.get(r.memberId) ?? 0) + 1);

  const memberIds = [...new Set([...eggCountMap.keys(), ...gooseCountMap.keys()])];
  if (memberIds.length === 0) return c.json({ data: [] });

  const members = await db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
    .from(schema.members).where(inArray(schema.members.id, memberIds)).all();
  const memberMap = new Map(members.map((m) => [m.id, m]));

  const data = memberIds
    .map((id) => {
      const m = memberMap.get(id);
      if (!m) return null;
      return { id: m.id, name: m.name, emoji: m.emoji, bgColor: m.bgColor, eggCount: eggCountMap.get(id) ?? 0, gooseCount: gooseCountMap.get(id) ?? 0 };
    })
    .filter((m): m is { id: string; name: string; emoji: string; bgColor: string; eggCount: number; gooseCount: number } => !!m)
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));

  return c.json({ data });
});

// ---- POST /api/enishi/search/for-me ---- 私のご縁：自分の卵/ガチョウ × なかまの人脈
enishiRoutes.post("/search/for-me", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const body = await c.req.json<{ targetIds: string[]; maxHop: "direct" | "2hop" | "3hop"; includeOwnContacts?: boolean }>();
  if (!Array.isArray(body.targetIds) || body.targetIds.length === 0) {
    return c.json({ error: { code: "invalid_input", message: "さがす対象の金の卵・金のガチョウを1つ以上選んでください" } }, 400);
  }
  if (!["direct", "2hop", "3hop"].includes(body.maxHop)) {
    return c.json({ error: { code: "invalid_input", message: "到達方法の指定が正しくありません" } }, 400);
  }
  const count = MAX_RESULTS;
  const includeOwnContacts = body.includeOwnContacts ?? true;

  const [myEggs, myGeese] = await Promise.all([
    db.select().from(schema.goldenEggs).where(eq(schema.goldenEggs.memberId, meId)).all(),
    db.select().from(schema.goldenGeese).where(eq(schema.goldenGeese.memberId, meId)).all(),
  ]);
  const targets = [
    ...myEggs.filter((e) => body.targetIds.includes(e.id)).map((e) => ({ kind: "egg" as const, id: e.id, description: e.description })),
    ...myGeese.filter((g) => body.targetIds.includes(g.id)).map((g) => ({ kind: "goose" as const, id: g.id, description: g.description })),
  ];
  if (targets.length === 0) {
    return c.json({ error: { code: "invalid_input", message: "指定された金の卵・金のガチョウが見つかりません" } }, 400);
  }

  const goodMatchContext = await buildGoodMatchContext(db, meId, "for-me");
  const result = await runEnishiSearch({
    db, apiKey: c.env.ANTHROPIC_API_KEY, isDev: c.env.ENVIRONMENT === "development",
    mode: "for-me", meId, targets, maxHop: body.maxHop, count, includeOwnContacts, goodMatchContext,
  });

  const now = Math.floor(Date.now() / 1000);
  const title = buildForMeTitle(targets, now, countResults(result));
  const { historyId, result: augmented } = await saveSearchHistory(
    db, meId, "for-me", title, { targetIds: body.targetIds, maxHop: body.maxHop, count, includeOwnContacts }, result, now
  );
  return c.json({ data: augmented, historyId });
});

// ---- POST /api/enishi/search/giver ---- 貢献のご縁：自分の人脈 × なかまの卵/ガチョウ
enishiRoutes.post("/search/giver", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const body = await c.req.json<{
    targetMemberIds?: string[];
    specialties?: string[]; relationships?: string[]; freeText?: string;
    maxHop: "direct" | "2hop" | "3hop";
  }>();
  if (!["direct", "2hop", "3hop"].includes(body.maxHop)) {
    return c.json({ error: { code: "invalid_input", message: "到達方法の指定が正しくありません" } }, 400);
  }
  const targetMemberIds = [...new Set(body.targetMemberIds ?? [])].filter((id) => id !== meId);
  if (targetMemberIds.length === 0) {
    return c.json({ error: { code: "invalid_input", message: "貢献先のメンバーを1人以上選んでください" } }, 400);
  }
  if (targetMemberIds.length > MAX_GIVER_TARGET_MEMBERS) {
    return c.json({ error: { code: "invalid_input", message: `貢献先のメンバーは最大${MAX_GIVER_TARGET_MEMBERS}名まで選べます` } }, 400);
  }
  const count = MAX_RESULTS;

  const myContacts = await db.select().from(schema.externalContacts)
    .where(and(eq(schema.externalContacts.ownerMemberId, meId), ne(schema.externalContacts.visibility, "private")))
    .all();
  if (myContacts.length === 0) {
    return c.json({ error: { code: "no_contacts", message: "貢献のご縁をさがすには、まず外部人脈を登録してください" } }, 400);
  }

  const goodMatchContext = await buildGoodMatchContext(db, meId, "giver");
  const result = await runEnishiSearch({
    db, apiKey: c.env.ANTHROPIC_API_KEY, isDev: c.env.ENVIRONMENT === "development",
    mode: "giver", meId, myContacts, targetMemberIds,
    specialties: body.specialties ?? [], relationships: body.relationships ?? [], freeText: body.freeText?.trim() ?? "",
    maxHop: body.maxHop, count, goodMatchContext,
  });

  const targetMembers = await db.select({ id: schema.members.id, name: schema.members.name })
    .from(schema.members).where(inArray(schema.members.id, targetMemberIds)).all();
  const targetMemberNames = targetMemberIds
    .map((id) => targetMembers.find((m) => m.id === id)?.name)
    .filter((n): n is string => !!n);

  const now = Math.floor(Date.now() / 1000);
  const title = buildGiverTitle(targetMemberNames, now, countResults(result));
  const params = {
    targetMemberIds, specialties: body.specialties ?? [], relationships: body.relationships ?? [],
    freeText: body.freeText?.trim() ?? "", maxHop: body.maxHop, count,
  };
  const { historyId, result: augmented } = await saveSearchHistory(db, meId, "giver", title, params, result, now);
  return c.json({ data: augmented, historyId });
});

// ---- GET /api/enishi/history ---- 検索履歴一覧（新しい順・自分の分のみ）
enishiRoutes.get("/history", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const rows = await db.select({
    id: schema.enishiSearchHistory.id,
    mode: schema.enishiSearchHistory.mode,
    title: schema.enishiSearchHistory.title,
    resultJson: schema.enishiSearchHistory.resultJson,
    createdAt: schema.enishiSearchHistory.createdAt,
  }).from(schema.enishiSearchHistory)
    .where(eq(schema.enishiSearchHistory.memberId, meId))
    .orderBy(desc(schema.enishiSearchHistory.createdAt))
    .limit(HISTORY_LIST_LIMIT)
    .all();

  const data = rows.map((r) => {
    let hasGoodMatch = false;
    try {
      const parsed = JSON.parse(r.resultJson) as HistoryResult;
      hasGoodMatch = parsed.groups?.some((g) => g.results?.some((res) => res.goodMatch)) ?? false;
    } catch {
      // 壊れたJSON（想定外）は無視
    }
    return { id: r.id, mode: r.mode as "for-me" | "giver", title: r.title, createdAt: r.createdAt, hasGoodMatch };
  });

  return c.json({ data });
});

// ---- GET /api/enishi/history/:id ---- 保存済みの検索結果をそのまま表示する（再検索しない）
enishiRoutes.get("/history/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const row = await db.select().from(schema.enishiSearchHistory).where(eq(schema.enishiSearchHistory.id, c.req.param("id"))).get();
  if (!row || row.memberId !== meId) return c.json({ error: { code: "not_found", message: "指定された検索履歴が見つかりません" } }, 404);

  let result: HistoryResult;
  try {
    result = JSON.parse(row.resultJson);
  } catch {
    return c.json({ error: { code: "internal_error", message: "検索結果の読み込みに失敗しました" } }, 500);
  }

  // 「このご縁で繋がりました」「紹介しました」は履歴保存時ではなく、表示のたびに最新の状態で計算し直す
  // （履歴保存後に別の検索・別の操作でチェックされた分も、この画面で正しく反映されるように）
  const [transactedIds, introducedKeys] = await Promise.all([
    fetchTransactedContactIds(db, meId),
    fetchIntroducedKeys(db, meId),
  ]);
  result = {
    ...result,
    groups: result.groups.map((g) => ({
      ...g,
      results: g.results.map((r) => ({
        ...r,
        transacted: transactedIds.has(r.candidateId),
        introduced: r.myContactId ? introducedKeys.has(`${r.myContactId}|${r.candidateId}`) : false,
      })),
    })),
  };

  return c.json({ data: { id: row.id, mode: row.mode, title: row.title, createdAt: row.createdAt, result } });
});

// ---- GET /api/enishi/transacted-contacts ---- 「このご縁で繋がりました」済みの人脈一覧（私のご縁タブ直下の「既に繋がった方」表示用）
enishiRoutes.get("/transacted-contacts", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const rows = await db.select().from(schema.enishiTransactedContacts)
    .where(eq(schema.enishiTransactedContacts.memberId, meId))
    .orderBy(desc(schema.enishiTransactedContacts.createdAt))
    .all();
  if (rows.length === 0) return c.json({ data: [] });

  const contacts = await db.select().from(schema.externalContacts)
    .where(inArray(schema.externalContacts.id, rows.map((r) => r.contactId))).all();
  const contactMap = new Map(contacts.map((ct) => [ct.id, ct]));

  // 誰の人脈（なかまの人脈か、自分自身の人脈か）かがわかるよう、登録者のメンバー情報も付加する
  const ownerIds = [...new Set(contacts.map((ct) => ct.ownerMemberId).filter((id) => id !== meId))];
  const owners = ownerIds.length > 0
    ? await db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
        .from(schema.members).where(inArray(schema.members.id, ownerIds)).all()
    : [];
  const ownerMap = new Map(owners.map((m) => [m.id, m]));

  const data = rows.map((r) => {
    const contact = contactMap.get(r.contactId);
    const isOwn = contact?.ownerMemberId === meId;
    const owner = contact && !isOwn ? ownerMap.get(contact.ownerMemberId) : null;
    return {
      contactId: r.contactId,
      name: contact?.name ?? "削除された人脈",
      company: contact?.company ?? null,
      specialty: contact?.specialty ?? null,
      markedAt: r.createdAt,
      ownerName: contact ? (isOwn ? "あなた自身" : (owner?.name ?? "不明なメンバー")) : null,
      ownerEmoji: contact ? (isOwn ? "👤" : (owner?.emoji ?? "❓")) : null,
      ownerBgColor: contact ? (isOwn ? "bg-stone-100" : (owner?.bgColor ?? "bg-stone-100")) : null,
    };
  });
  return c.json({ data });
});

// ---- POST /api/enishi/transacted-contacts ---- 「このご縁で繋がりました」を登録（本人のみ有効・私のご縁の検索から除外される）
enishiRoutes.post("/transacted-contacts", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const { contactId } = await c.req.json<{ contactId?: string }>();
  if (!contactId) return c.json({ error: { code: "invalid_input", message: "対象の人脈を指定してください" } }, 400);

  const existing = await db.select({ id: schema.enishiTransactedContacts.id }).from(schema.enishiTransactedContacts)
    .where(and(eq(schema.enishiTransactedContacts.memberId, meId), eq(schema.enishiTransactedContacts.contactId, contactId)))
    .get();
  if (!existing) {
    await db.insert(schema.enishiTransactedContacts).values({
      id: newId(), memberId: meId, contactId, createdAt: Math.floor(Date.now() / 1000),
    });
  }
  return c.json({ ok: true });
});

// ---- DELETE /api/enishi/transacted-contacts/bulk ---- 選択した「既に繋がった方」をまとめて解除（:contactId より先に登録し、"bulk" が:contactIdに食われないようにする）
enishiRoutes.delete("/transacted-contacts/bulk", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const { contactIds } = await c.req.json<{ contactIds?: string[] }>();
  const ids = [...new Set(contactIds ?? [])];
  if (ids.length === 0) return c.json({ error: { code: "invalid_input", message: "対象を選択してください" } }, 400);

  await db.delete(schema.enishiTransactedContacts).where(and(
    eq(schema.enishiTransactedContacts.memberId, meId),
    inArray(schema.enishiTransactedContacts.contactId, ids)
  ));
  return c.json({ ok: true });
});

// ---- DELETE /api/enishi/transacted-contacts/:contactId ---- 「このご縁で繋がりました」の解除
enishiRoutes.delete("/transacted-contacts/:contactId", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  await db.delete(schema.enishiTransactedContacts).where(and(
    eq(schema.enishiTransactedContacts.memberId, meId),
    eq(schema.enishiTransactedContacts.contactId, c.req.param("contactId"))
  ));
  return c.json({ ok: true });
});

// ---- GET /api/enishi/hidden-contacts ---- 「今後の表示は不要です」済みの人脈一覧（私のご縁タブ直下の「今後表示しない方」表示用）
enishiRoutes.get("/hidden-contacts", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const rows = await db.select().from(schema.enishiHiddenContacts)
    .where(eq(schema.enishiHiddenContacts.memberId, meId))
    .orderBy(desc(schema.enishiHiddenContacts.createdAt))
    .all();
  if (rows.length === 0) return c.json({ data: [] });

  const contacts = await db.select().from(schema.externalContacts)
    .where(inArray(schema.externalContacts.id, rows.map((r) => r.contactId))).all();
  const contactMap = new Map(contacts.map((ct) => [ct.id, ct]));

  const data = rows.map((r) => {
    const contact = contactMap.get(r.contactId);
    return {
      contactId: r.contactId,
      name: contact?.name ?? "削除された人脈",
      company: contact?.company ?? null,
      specialty: contact?.specialty ?? null,
      markedAt: r.createdAt,
    };
  });
  return c.json({ data });
});

// ---- POST /api/enishi/hidden-contacts ---- 「今後の表示は不要です」を登録（本人のみ有効・私のご縁の検索から除外される）
enishiRoutes.post("/hidden-contacts", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const { contactId } = await c.req.json<{ contactId?: string }>();
  if (!contactId) return c.json({ error: { code: "invalid_input", message: "対象の人脈を指定してください" } }, 400);

  const existing = await db.select({ id: schema.enishiHiddenContacts.id }).from(schema.enishiHiddenContacts)
    .where(and(eq(schema.enishiHiddenContacts.memberId, meId), eq(schema.enishiHiddenContacts.contactId, contactId)))
    .get();
  if (!existing) {
    await db.insert(schema.enishiHiddenContacts).values({
      id: newId(), memberId: meId, contactId, createdAt: Math.floor(Date.now() / 1000),
    });
  }
  return c.json({ ok: true });
});

// ---- DELETE /api/enishi/hidden-contacts/bulk ---- 選択した「今後表示しない方」をまとめて解除（:contactId より先に登録し、"bulk" が:contactIdに食われないようにする）
enishiRoutes.delete("/hidden-contacts/bulk", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const { contactIds } = await c.req.json<{ contactIds?: string[] }>();
  const ids = [...new Set(contactIds ?? [])];
  if (ids.length === 0) return c.json({ error: { code: "invalid_input", message: "対象を選択してください" } }, 400);

  await db.delete(schema.enishiHiddenContacts).where(and(
    eq(schema.enishiHiddenContacts.memberId, meId),
    inArray(schema.enishiHiddenContacts.contactId, ids)
  ));
  return c.json({ ok: true });
});

// ---- DELETE /api/enishi/hidden-contacts/:contactId ---- 「今後の表示は不要です」の解除
enishiRoutes.delete("/hidden-contacts/:contactId", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  await db.delete(schema.enishiHiddenContacts).where(and(
    eq(schema.enishiHiddenContacts.memberId, meId),
    eq(schema.enishiHiddenContacts.contactId, c.req.param("contactId"))
  ));
  return c.json({ ok: true });
});

// ---- GET /api/enishi/introduced-contacts ---- 「紹介しました」済みの組み合わせ一覧（貢献のご縁タブ直下の「既に紹介した方」表示用）
enishiRoutes.get("/introduced-contacts", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const rows = await db.select().from(schema.enishiIntroducedContacts)
    .where(eq(schema.enishiIntroducedContacts.memberId, meId))
    .orderBy(desc(schema.enishiIntroducedContacts.createdAt))
    .all();
  if (rows.length === 0) return c.json({ data: [] });

  const myContactIds = [...new Set(rows.map((r) => r.myContactId))];
  const myContacts = await db.select().from(schema.externalContacts).where(inArray(schema.externalContacts.id, myContactIds)).all();
  const myContactMap = new Map(myContacts.map((ct) => [ct.id, ct]));

  const candidateIds = [...new Set(rows.map((r) => r.candidateId))];
  const [eggs, geese] = await Promise.all([
    db.select().from(schema.goldenEggs).where(inArray(schema.goldenEggs.id, candidateIds)).all(),
    db.select().from(schema.goldenGeese).where(inArray(schema.goldenGeese.id, candidateIds)).all(),
  ]);
  const eggMap = new Map(eggs.map((e) => [e.id, e]));
  const gooseMap = new Map(geese.map((g) => [g.id, g]));
  const targetMemberIds = [...new Set([...eggs.map((e) => e.memberId), ...geese.map((g) => g.memberId)])];
  const targetMembers = targetMemberIds.length > 0
    ? await db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor })
        .from(schema.members).where(inArray(schema.members.id, targetMemberIds)).all()
    : [];
  const targetMemberMap = new Map(targetMembers.map((m) => [m.id, m]));

  const data = rows.map((r) => {
    const myContact = myContactMap.get(r.myContactId);
    const egg = eggMap.get(r.candidateId);
    const goose = egg ? undefined : gooseMap.get(r.candidateId);
    const targetMemberId = egg?.memberId ?? goose?.memberId ?? null;
    const targetMember = targetMemberId ? targetMemberMap.get(targetMemberId) : undefined;
    return {
      myContactId: r.myContactId,
      myContactName: myContact?.name ?? "削除された人脈",
      candidateId: r.candidateId,
      kind: egg ? "egg" as const : "goose" as const,
      targetMemberName: targetMember?.name ?? "不明なメンバー",
      targetMemberEmoji: targetMember?.emoji ?? "❓",
      markedAt: r.createdAt,
    };
  });
  return c.json({ data });
});

// ---- POST /api/enishi/introduced-contacts ---- 「紹介しました」を登録（本人のみ有効・同じ組み合わせが貢献のご縁の検索から除外される）
enishiRoutes.post("/introduced-contacts", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const { myContactId, candidateId } = await c.req.json<{ myContactId?: string; candidateId?: string }>();
  if (!myContactId || !candidateId) return c.json({ error: { code: "invalid_input", message: "対象を指定してください" } }, 400);

  const existing = await db.select({ id: schema.enishiIntroducedContacts.id }).from(schema.enishiIntroducedContacts)
    .where(and(
      eq(schema.enishiIntroducedContacts.memberId, meId),
      eq(schema.enishiIntroducedContacts.myContactId, myContactId),
      eq(schema.enishiIntroducedContacts.candidateId, candidateId)
    )).get();
  if (!existing) {
    await db.insert(schema.enishiIntroducedContacts).values({
      id: newId(), memberId: meId, myContactId, candidateId, createdAt: Math.floor(Date.now() / 1000),
    });
  }
  return c.json({ ok: true });
});

// ---- DELETE /api/enishi/introduced-contacts/bulk ---- 選択した「既に紹介した方」をまとめて解除
enishiRoutes.delete("/introduced-contacts/bulk", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const { items } = await c.req.json<{ items?: { myContactId: string; candidateId: string }[] }>();
  if (!items || items.length === 0) return c.json({ error: { code: "invalid_input", message: "対象を選択してください" } }, 400);

  // 複合キー（myContactId × candidateId）ごとに削除する（IN句1本では組み合わせを表現できないため）
  for (const item of items) {
    if (!item.myContactId || !item.candidateId) continue;
    await db.delete(schema.enishiIntroducedContacts).where(and(
      eq(schema.enishiIntroducedContacts.memberId, meId),
      eq(schema.enishiIntroducedContacts.myContactId, item.myContactId),
      eq(schema.enishiIntroducedContacts.candidateId, item.candidateId)
    ));
  }
  return c.json({ ok: true });
});

// ---- DELETE /api/enishi/introduced-contacts/:myContactId/:candidateId ---- 「紹介しました」の解除
enishiRoutes.delete("/introduced-contacts/:myContactId/:candidateId", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  await db.delete(schema.enishiIntroducedContacts).where(and(
    eq(schema.enishiIntroducedContacts.memberId, meId),
    eq(schema.enishiIntroducedContacts.myContactId, c.req.param("myContactId")),
    eq(schema.enishiIntroducedContacts.candidateId, c.req.param("candidateId"))
  ));
  return c.json({ ok: true });
});

// ---- GET /api/enishi/contacts/:id/card ---- 人脈の名刺情報（visibilityに応じてマスク。結果カードのホバー/タップ表示用）
enishiRoutes.get("/contacts/:id/card", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const contact = await db.select().from(schema.externalContacts).where(eq(schema.externalContacts.id, c.req.param("id"))).get();
  if (!contact) return c.json({ error: { code: "not_found", message: "指定された人脈が見つかりません" } }, 404);

  const isOwn = contact.ownerMemberId === meId;
  if (contact.visibility === "private" && !isOwn) {
    return c.json({ error: { code: "not_found", message: "指定された人脈が見つかりません" } }, 404);
  }
  // 本人（登録者）には公開範囲に関わらず常に詳細を見せる。他人には visibility === "full" の場合のみ
  const showDetail = isOwn || contact.visibility === "full";

  const relRows = await db.select().from(schema.externalContactRelationships)
    .where(eq(schema.externalContactRelationships.contactId, contact.id)).all();

  return c.json({ data: {
    id: contact.id,
    name: showDetail ? contact.name : null,
    company: showDetail ? contact.company : null,
    note: showDetail ? contact.note : null,
    specialty: contact.specialty,
    relationships: relRows.map((r) => r.relationship),
    businessSummary: contact.businessSummaryStatus === "done" ? contact.businessSummary : null,
    isOwn,
  } });
});

// ---- DELETE /api/enishi/history/bulk ---- 選択した検索履歴をまとめて削除（:id より先に登録し、"bulk" が:idに食われないようにする）
enishiRoutes.delete("/history/bulk", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const body = await c.req.json<{ ids: string[] }>();
  const ids = [...new Set(body.ids ?? [])];
  if (ids.length === 0) return c.json({ error: { code: "invalid_input", message: "対象を選択してください" } }, 400);

  // 自分の所有分だけに絞り込んでから削除する（他人の履歴IDが紛れ込んでいても無視される）
  const ownRows = await db.select({ id: schema.enishiSearchHistory.id }).from(schema.enishiSearchHistory)
    .where(and(eq(schema.enishiSearchHistory.memberId, meId), inArray(schema.enishiSearchHistory.id, ids)))
    .all();
  const ownIds = ownRows.map((r) => r.id);
  if (ownIds.length > 0) {
    await db.delete(schema.enishiSearchHistory).where(inArray(schema.enishiSearchHistory.id, ownIds));
  }

  return c.json({ data: { deleted: ownIds.length } });
});

// ---- DELETE /api/enishi/history/:id ----
enishiRoutes.delete("/history/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const historyId = c.req.param("id");
  const row = await db.select({ memberId: schema.enishiSearchHistory.memberId }).from(schema.enishiSearchHistory)
    .where(eq(schema.enishiSearchHistory.id, historyId)).get();
  if (!row || row.memberId !== meId) return c.json({ error: { code: "not_found", message: "指定された検索履歴が見つかりません" } }, 404);

  await db.delete(schema.enishiSearchHistory).where(eq(schema.enishiSearchHistory.id, historyId));
  return c.json({ ok: true });
});

// ---- PATCH /api/enishi/history/:id/cards/:cardId ---- 「良いご縁だった」フラグの切替（本人の履歴のみ操作可能）
enishiRoutes.patch("/history/:id/cards/:cardId", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveEffectiveMemberId(db, c.get("userId"), c.get("userType"));
  if (!meId) return c.json({ error: { code: "no_member", message: "メンバーとして登録されていないためご利用いただけません" } }, 403);

  const historyId = c.req.param("id");
  const cardId = c.req.param("cardId");
  const row = await db.select().from(schema.enishiSearchHistory).where(eq(schema.enishiSearchHistory.id, historyId)).get();
  if (!row || row.memberId !== meId) return c.json({ error: { code: "not_found", message: "指定された検索履歴が見つかりません" } }, 404);

  const body = await c.req.json<{ goodMatch: boolean }>();

  let result: HistoryResult;
  try {
    result = JSON.parse(row.resultJson);
  } catch {
    return c.json({ error: { code: "internal_error", message: "検索結果の読み込みに失敗しました" } }, 500);
  }

  let found = false;
  for (const g of result.groups) {
    for (const r of g.results) {
      if (r.cardId === cardId) { r.goodMatch = !!body.goodMatch; found = true; }
    }
  }
  if (!found) return c.json({ error: { code: "not_found", message: "指定された結果が見つかりません" } }, 404);

  await db.update(schema.enishiSearchHistory).set({ resultJson: JSON.stringify(result) }).where(eq(schema.enishiSearchHistory.id, historyId));
  return c.json({ data: result });
});
