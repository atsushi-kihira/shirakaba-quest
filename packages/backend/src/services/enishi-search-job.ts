// =============================================================
// ご縁さがし 検索ジョブ — 「私のご縁」「人脈をさがす」を、裏で実行して終わったら通知する
//
// 候補を小さな束（バッチ）に分けて、束ごとにAIで照合し、結果を合算する。1回の処理（ステップ）は
// waitUntil の制限（応答後およそ30秒）に収まる短さにして、終わったら自分自身を呼び直して続ける
// （会社概要の自動生成・所在地の調べと同じ自己連鎖方式）。
//   prepare → match（束ごと・3束ずつ並行）→ members（メンバー本人の検索）→ collab（協業イメージ）→ finalize
// 終わったら、検索履歴に保存し、アプリ内の通知・プッシュ通知・メールで知らせる。
// 失敗した束は、1回だけ自動でやり直す（無限に繰り返さない）。それでも失敗した束が多いときは、システム管理者にメールで知らせる。
// 途中の結果は、照合が終わった束の分だけで、いつでも組み立てて見られる（buildPartialResult）。
// =============================================================
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { newId } from "./auth.ts";
import { MailService } from "./mailer.ts";
import { sendPushToMember } from "./push.ts";
import { getFrontendUrl } from "./frontendUrl.ts";
import { waitUpTo } from "./sweep-util.ts";
import {
  JOB_BATCH_SIZE, selectJobCandidates, matchJobBatch, interleaveMatches, searchMemberHits, buildMemberCollab,
  finalizeForMeResult, finalizeContactSearchResult,
  loadGiverContext, buildGiverBatches, matchGiverBatch, finalizeGiverResult,
  type JobParams, type JobCandidate, type JobMatch, type MemberHit, type MatchCoverage,
} from "./enishi-search.ts";
import type { CollabIdeas } from "./member-collab.ts";
import { augmentResultWithCards, buildForMeTitle, buildContactSearchTitle, buildGiverTitle, countResults, saveSearchHistory, type HistoryResult } from "./enishi-history.ts";
import type { Env } from "../types.ts";

type Db = ReturnType<typeof createDb>;
type Job = typeof schema.enishiSearchJobs.$inferSelect;

/** 処理中の目印の有効時間（秒）。これを過ぎた目印は、止まった処理のものとみなして取り直せる */
const LEASE_SECONDS = 60;
/** 同じ処理のやり直しの上限（束の照合以外のステップごと） */
const MAX_ATTEMPTS = 3;
/** 束の照合の試行の上限。最初の1回＋やり直し1回（失敗した束を、無限に繰り返さない） */
const BATCH_MAX_ATTEMPTS = 2;
/** 失敗した束が「多い」とみなして、システム管理者に知らせる目安 */
const ALERT_MIN_FAILED = 3;
const ALERT_FAILED_RATIO = 0.3;
/** 一度に並行して照合する束の数 */
const MATCH_PARALLEL = 4;
/** 自己連鎖の安全弁 */
const MAX_HOPS = 200;
/** 進みが止まっているとみなす時間（秒）。画面から状況を見に来たときに、止まっていれば再開する */
export const STALE_JOB_SECONDS = 75;
/** アプリ内通知に使う、お知らせ配信とは別の分類 */
const NOTICE_GROUP_ID = "enishi-search";

function nowSec(): number { return Math.floor(Date.now() / 1000); }

function parseParams(job: Job): JobParams { return JSON.parse(job.paramsJson) as JobParams; }

/** 画面・通知に出す、検索の名前（短く） */
export function jobLabel(params: JobParams): string {
  if (params.mode === "for-me") {
    const first = params.targets[0]?.description ?? "";
    const short = first.length > 18 ? `${first.slice(0, 18)}…` : first;
    return `私のご縁：${short}${params.targets.length > 1 ? ` ほか${params.targets.length - 1}件` : ""}`;
  }
  if (params.mode === "giver") {
    const shown = params.targetMemberNames.slice(0, 3).join("・") || "なかま";
    return `貢献のご縁：${shown}${params.targetMemberNames.length > 3 ? ` ほか${params.targetMemberNames.length - 3}名` : ""}へ`;
  }
  const short = params.freeText.length > 20 ? `${params.freeText.slice(0, 20)}…` : params.freeText;
  return `人脈検索：${short}`;
}

export async function createSearchJob(db: Db, memberId: string, params: JobParams): Promise<string> {
  const id = newId();
  const now = nowSec();
  await db.insert(schema.enishiSearchJobs).values({
    id, memberId, mode: params.mode, paramsJson: JSON.stringify(params), stage: "prepare", status: "running",
    createdAt: now, updatedAt: now,
  });
  return id;
}

async function patchJob(db: Db, id: string, patch: Partial<typeof schema.enishiSearchJobs.$inferInsert>): Promise<void> {
  await db.update(schema.enishiSearchJobs).set({ ...patch, updatedAt: nowSec() }).where(eq(schema.enishiSearchJobs.id, id)).run();
}

/** 次の処理に進む（やり直しの回数を戻す） */
async function advance(db: Db, id: string, stage: Job["stage"], extra: Partial<typeof schema.enishiSearchJobs.$inferInsert> = {}): Promise<void> {
  await patchJob(db, id, { stage, stageAttempts: 0, ...extra });
}

function needsMembers(params: JobParams): boolean { return params.mode === "contact-search" && params.scope === "all"; }

// ---- 各ステップ ----

async function stagePrepare(db: Db, job: Job, params: JobParams): Promise<void> {
  let batches: string[][] = [];
  let truncated: boolean;
  if (params.mode === "giver") {
    // 貢献のご縁：自分の人脈を、貢献先ごとに小さな束に分ける（人脈の一部を抜粋することはしない）
    const ctx = await loadGiverContext(db, job.memberId, params);
    batches = buildGiverBatches(params, ctx);
    truncated = ctx.truncated;
  } else {
    const found = await selectJobCandidates(db, job.memberId, params);
    for (let i = 0; i < found.candidates.length; i += JOB_BATCH_SIZE) {
      batches.push(found.candidates.slice(i, i + JOB_BATCH_SIZE).map((c) => c.candidateId));
    }
    truncated = found.truncated;
  }
  await db.delete(schema.enishiSearchJobBatches).where(eq(schema.enishiSearchJobBatches.jobId, job.id)).run();
  const INSERT_CHUNK = 10; // D1のバインド変数の上限（1行6個）に収める
  for (let i = 0; i < batches.length; i += INSERT_CHUNK) {
    await db.insert(schema.enishiSearchJobBatches).values(
      batches.slice(i, i + INSERT_CHUNK).map((ids, k) => ({
        jobId: job.id, idx: i + k, candidateIdsJson: JSON.stringify(ids), status: "pending", attempts: 0,
      })),
    ).run();
  }
  const next = batches.length > 0 ? "match" : needsMembers(params) ? "members" : "finalize";
  await advance(db, job.id, next, { totalBatches: batches.length, doneBatches: 0, failedBatches: 0, truncated: truncated ? 1 : 0 });
}

// ---- 束の数え方 ----
// 1回目に失敗した束は、やり直しのときだけ、半分に分けた2つの束（半分の束）に置き換える。
// 元の束の行は status='split' にして残し、半分の束には、HALF_BASE 以上の番号をつける（元の束の番号は、HALF_BASE 未満）。
// 進み具合・失敗の数は、元の束の単位で数える（半分の束は、元の束にまとめる）。

/** 半分の束の番号の始まり（元の束の番号は、これより小さい） */
const HALF_BASE = 1000;
const halfIdx = (parent: number, k: 0 | 1): number => HALF_BASE + parent * 2 + k;
const parentIdx = (idx: number): number => (idx >= HALF_BASE ? (idx - HALF_BASE) >> 1 : idx);

type BatchRowLite = { idx: number; status: string; attempts: number; lastError: string | null; candidateIdsJson: string };

/** 元の束ごとの状態。done=すべて照合できた／failed=照合できなかった分がある／open=まだ途中 */
export function summarizeOriginals(rows: BatchRowLite[]): {
  total: number; done: number; failed: number; open: number; failedErrors: (string | null)[]; retriedOk: number;
} {
  const groups = new Map<number, BatchRowLite[]>();
  for (const r of rows) {
    if (r.status === "split") continue; // 半分に分けた元の束は、半分の束のほうで数える
    groups.set(parentIdx(r.idx), [...(groups.get(parentIdx(r.idx)) ?? []), r]);
  }
  const hasSplit = new Set(rows.filter((r) => r.status === "split").map((r) => r.idx));
  let done = 0, failed = 0, open = 0, retriedOk = 0;
  const failedErrors: (string | null)[] = [];
  for (const [p, g] of groups) {
    const isFailedRow = (r: BatchRowLite) => r.status === "failed" || (r.status !== "done" && r.attempts >= BATCH_MAX_ATTEMPTS);
    if (g.some((r) => r.status !== "done" && !isFailedRow(r))) open++;
    else if (g.some(isFailedRow)) { failed++; failedErrors.push(g.find((r) => isFailedRow(r) && r.lastError)?.lastError ?? null); }
    else { done++; if (hasSplit.has(p) || g.some((r) => r.attempts >= 2)) retriedOk++; }
  }
  return { total: groups.size, done, failed, open, failedErrors, retriedOk };
}

async function countBatches(db: Db, jobId: string): Promise<{ done: number; failed: number; open: number }> {
  const rows = await db.select().from(schema.enishiSearchJobBatches).where(eq(schema.enishiSearchJobBatches.jobId, jobId)).all();
  const { done, failed, open } = summarizeOriginals(rows);
  return { done, failed, open };
}

/** 1回目に失敗した束を、半分に分けた2つの束に置き換える（やり直しは、この半分の束それぞれに1回ずつ）。2件未満なら、そのまま1回やり直す */
async function splitForRetry(db: Db, b: typeof schema.enishiSearchJobBatches.$inferSelect, ids: string[], error: string): Promise<void> {
  const key = and(eq(schema.enishiSearchJobBatches.jobId, b.jobId), eq(schema.enishiSearchJobBatches.idx, b.idx));
  if (b.idx >= HALF_BASE || ids.length < 2) {
    await db.update(schema.enishiSearchJobBatches).set({ status: "pending", lastError: error }).where(key).run();
    return;
  }
  const mid = Math.ceil(ids.length / 2);
  // 2つの半分の束を作るのと、元の束を「分けた」に変えるのは、一度に行う（途中で止まっても、二重に処理しない）
  await db.batch([
    db.insert(schema.enishiSearchJobBatches).values([
      { jobId: b.jobId, idx: halfIdx(b.idx, 0), candidateIdsJson: JSON.stringify(ids.slice(0, mid)), status: "pending", attempts: 1 },
      { jobId: b.jobId, idx: halfIdx(b.idx, 1), candidateIdsJson: JSON.stringify(ids.slice(mid)), status: "pending", attempts: 1 },
    ]),
    db.update(schema.enishiSearchJobBatches).set({ status: "split", lastError: error }).where(key),
  ]);
}

async function stageMatch(db: Db, env: Env, job: Job, params: JobParams): Promise<void> {
  const isDev = env.ENVIRONMENT === "development";
  const todo = await db.select().from(schema.enishiSearchJobBatches)
    .where(and(
      eq(schema.enishiSearchJobBatches.jobId, job.id),
      inArray(schema.enishiSearchJobBatches.status, ["pending", "processing"]),
      lt(schema.enishiSearchJobBatches.attempts, BATCH_MAX_ATTEMPTS),
    ))
    // まだ1回も試していない束を先に進め、やり直しの束は後回しにする（失敗の直後に、すぐ同じ条件で重ねて失敗するのを避ける）
    .orderBy(asc(schema.enishiSearchJobBatches.attempts), asc(schema.enishiSearchJobBatches.idx)).limit(MATCH_PARALLEL).all();

  if (todo.length > 0) {
    const giverCtx = params.mode === "giver" ? await loadGiverContext(db, job.memberId, params) : null;
    const candidates = params.mode === "giver" ? [] : (await selectJobCandidates(db, job.memberId, params)).candidates;
    const byId = new Map<string, JobCandidate>(candidates.map((c) => [c.candidateId, c]));
    // 取りかかる前に、やり直しの回数を数えておく（途中で打ち切られても、回数は残る）
    await Promise.all(todo.map((b) => db.update(schema.enishiSearchJobBatches)
      .set({ status: "processing", attempts: b.attempts + 1 })
      .where(and(eq(schema.enishiSearchJobBatches.jobId, b.jobId), eq(schema.enishiSearchJobBatches.idx, b.idx))).run()));
    await Promise.all(todo.map(async (b) => {
      const ids = JSON.parse(b.candidateIdsJson) as string[];
      const batch = ids.map((id) => byId.get(id)).filter((c): c is JobCandidate => !!c);
      const outcome = params.mode === "giver" && giverCtx
        ? await matchGiverBatch(env.ANTHROPIC_API_KEY, isDev, params, giverCtx, ids)
        : params.mode === "giver" || batch.length === 0 ? { ok: true as const, matches: [] } : await matchJobBatch(env.ANTHROPIC_API_KEY, isDev, params, batch);
      const key = and(eq(schema.enishiSearchJobBatches.jobId, b.jobId), eq(schema.enishiSearchJobBatches.idx, b.idx));
      if (outcome.ok) {
        await db.update(schema.enishiSearchJobBatches).set({ status: "done", matchesJson: JSON.stringify(outcome.matches), lastError: null }).where(key).run();
      } else if (b.attempts + 1 >= BATCH_MAX_ATTEMPTS) {
        // 2回目（やり直し）の失敗は、確定する
        await db.update(schema.enishiSearchJobBatches).set({ status: "failed", lastError: outcome.error }).where(key).run();
      } else {
        // 1回目の失敗は、半分に分けて、1回だけやり直す
        await splitForRetry(db, b, ids, outcome.error);
      }
    }));
  }

  const { done, failed, open } = await countBatches(db, job.id);
  // 打ち切られたまま回数を使い切った束は、失敗として確定する
  if (open === 0 && failed > 0) {
    await db.update(schema.enishiSearchJobBatches).set({ status: "failed" })
      .where(and(eq(schema.enishiSearchJobBatches.jobId, job.id), inArray(schema.enishiSearchJobBatches.status, ["pending", "processing"]))).run();
  }
  if (open === 0) {
    await advance(db, job.id, needsMembers(params) ? "members" : "finalize", { doneBatches: done, failedBatches: failed });
  } else {
    await patchJob(db, job.id, { doneBatches: done, failedBatches: failed });
  }
}

async function stageMembers(db: Db, env: Env, job: Job, params: JobParams): Promise<void> {
  if (params.mode !== "contact-search") return advance(db, job.id, "finalize");
  const isDev = env.ENVIRONMENT === "development";
  let hits: MemberHit[] = [];
  if (job.stageAttempts <= MAX_ATTEMPTS) {
    hits = await searchMemberHits(db, env.ANTHROPIC_API_KEY, isDev, job.memberId, params.freeText, params.specialties);
  } // やり直しの回数を使い切ったら、メンバー本人の結果なしで先に進む
  await advance(db, job.id, hits.length >= 2 ? "collab" : "finalize", { membersJson: JSON.stringify(hits) });
}

async function stageCollab(db: Db, env: Env, job: Job, params: JobParams): Promise<void> {
  if (params.mode !== "contact-search") return advance(db, job.id, "finalize");
  const isDev = env.ENVIRONMENT === "development";
  const hits = JSON.parse(job.membersJson ?? "[]") as MemberHit[];
  let collab: CollabIdeas | null = null;
  if (job.stageAttempts <= MAX_ATTEMPTS) collab = await buildMemberCollab(db, env.ANTHROPIC_API_KEY, isDev, params.freeText, hits);
  await advance(db, job.id, "finalize", { collabJson: collab ? JSON.stringify(collab) : null });
}

async function stageFinalize(db: Db, env: Env, job: Job, params: JobParams): Promise<void> {
  const isDev = env.ENVIRONMENT === "development";
  // 履歴の保存まで終わっていれば（保存のあとで打ち切られた場合）、通知だけやり直す。保存されていなければ、やり直す
  if (job.historyId) {
    const saved = await db.select({ id: schema.enishiSearchHistory.id }).from(schema.enishiSearchHistory)
      .where(eq(schema.enishiSearchHistory.id, job.historyId)).get();
    if (saved) {
      await completeJob(db, env, job, params, job.historyId, job.resultCount ?? 0);
      return;
    }
    await db.update(schema.enishiSearchJobs).set({ historyId: null }).where(eq(schema.enishiSearchJobs.id, job.id)).run();
  }
  const batches = await db.select().from(schema.enishiSearchJobBatches)
    .where(eq(schema.enishiSearchJobBatches.jobId, job.id)).orderBy(asc(schema.enishiSearchJobBatches.idx)).all();
  const summary = summarizeOriginals(batches);
  const failedBatches = summary.failed;
  const countIds = (b: { candidateIdsJson: string }) => (JSON.parse(b.candidateIdsJson) as string[]).length;
  const countable = batches.filter((b) => b.status !== "split");
  // 貢献のご縁は、「自分の人脈」の人数で数える（同じ人脈が、貢献先ごとの束に入っているので、重ねて数えない）
  const contactIdsOf = (b: { candidateIdsJson: string }) => (JSON.parse(b.candidateIdsJson) as string[]).map((id) => id.slice(id.indexOf("|") + 1));
  const coverage: MatchCoverage = params.mode === "giver"
    ? {
        totalCandidates: new Set(countable.flatMap(contactIdsOf)).size,
        unmatchedCandidates: new Set(countable.filter((b) => b.status === "failed").flatMap(contactIdsOf)).size,
        totalBatches: summary.total, failedBatches,
        retriedOkBatches: summary.retriedOk,
      }
    : {
        totalCandidates: countable.reduce((n, b) => n + countIds(b), 0),
        unmatchedCandidates: countable.filter((b) => b.status === "failed").reduce((n, b) => n + countIds(b), 0),
        totalBatches: summary.total, failedBatches,
        retriedOkBatches: summary.retriedOk,
      };
  if (summary.total > 0 && failedBatches === summary.total) {
    await failJob(db, env, job, params, "AIの検索に時間がかかり、今回は結果を出せませんでした。時間をおいて、もう一度お試しください。");
    return;
  }
  const matches: JobMatch[] = interleaveMatches(
    batches.filter((b) => b.status === "done").map((b) => JSON.parse(b.matchesJson ?? "[]") as JobMatch[]),
  );
  const aiCallFailed = failedBatches > 0;
  // 最後の1回は、二次チェック（AI）を省いて確実に仕上げる
  const skipVerify = isDev || job.stageAttempts >= MAX_ATTEMPTS;
  const apiKey = env.ANTHROPIC_API_KEY;

  const created = nowSec();
  let result;
  let title: string;
  let historyParams: unknown;
  if (params.mode === "giver") {
    const ctx = await loadGiverContext(db, job.memberId, params);
    result = await finalizeGiverResult({ apiKey, isDev: skipVerify, params, ctx, matches, aiCallFailed });
    title = buildGiverTitle(params.targetMemberNames, created, countResults(result));
    historyParams = {
      targetMemberIds: params.targetMemberIds, specialties: params.specialties, relationships: params.relationships,
      freeText: params.freeText, maxHop: params.maxHop, count: params.count,
    };
  } else if (params.mode === "for-me") {
    const { candidates, truncated } = await selectJobCandidates(db, job.memberId, params);
    result = await finalizeForMeResult({ apiKey, isDev: skipVerify, params, candidates, matches, aiCallFailed, truncated });
    title = buildForMeTitle(params.targets, created, countResults(result));
    historyParams = { targetIds: params.targetIds, maxHop: params.maxHop, count: params.count, includeOwnContacts: params.includeOwnContacts };
  } else {
    const { candidates, truncated } = await selectJobCandidates(db, job.memberId, params);
    result = await finalizeContactSearchResult({
      db, params, candidates, matches, aiCallFailed, truncated,
      memberHits: JSON.parse(job.membersJson ?? "[]") as MemberHit[],
      memberCollab: job.collabJson ? JSON.parse(job.collabJson) as CollabIdeas : null,
    });
    title = buildContactSearchTitle(params.freeText, created, countResults(result));
    historyParams = { specialties: params.specialties, freeText: params.freeText, scope: params.scope, memberIds: params.memberIds, count: params.count };
  }
  result = { ...result, coverage };
  // 履歴の保存は、1つのジョブにつき1回だけ（処理が重なっても、先に目印を取れた方だけが保存する）
  const historyId = newId();
  const won = await db.update(schema.enishiSearchJobs)
    .set({ historyId, resultCount: countResults(result), updatedAt: nowSec() })
    .where(and(eq(schema.enishiSearchJobs.id, job.id), isNull(schema.enishiSearchJobs.historyId))).returning({ id: schema.enishiSearchJobs.id }).all();
  if (won.length === 0) return;
  await saveSearchHistory(db, job.memberId, params.mode, title, historyParams, result, created, historyId);
  await completeJob(db, env, { ...job, historyId, resultCount: countResults(result) }, params, historyId, countResults(result));
}

// ---- 完了・失敗の通知 ----

async function notifyMember(db: Db, env: Env, job: Job, notice: { subject: string; message: string; path: string }): Promise<void> {
  const member = await db.select({ name: schema.members.name, email: schema.members.email }).from(schema.members)
    .where(eq(schema.members.id, job.memberId)).get();
  if (!member) return;
  const design = await db.select({ appTitle: schema.cardDesigns.appTitle }).from(schema.cardDesigns).get();
  const appTitle = design?.appTitle ?? "白樺クエスト";
  const url = `${getFrontendUrl(env)}${notice.path}`;
  const now = nowSec();

  // アプリ内の通知（通知画面に並ぶ。本文のURLは、押すとそのまま開ける）
  await db.insert(schema.memberNotifications).values({
    id: newId(), broadcastId: NOTICE_GROUP_ID, memberId: job.memberId,
    title: notice.subject, body: `${notice.message}\n${url}`, readAt: null, createdAt: now,
  }).run();

  // メール（あわせて、プッシュ通知も届く）。メールアドレスがなければ、プッシュ通知だけ送る
  const pushBody = notice.message.replace(/\s+/g, " ").slice(0, 120);
  if (member.email) {
    await new MailService(db, env).send("enishi_search_notice", member.email, {
      appTitle, memberName: member.name, subject: notice.subject, message: notice.message, resultUrl: url,
    }, { push: { body: pushBody, url: notice.path } });
  } else {
    await sendPushToMember(db, env, job.memberId, { title: notice.subject, body: pushBody, url: notice.path });
  }
}

/** 実行中から終わりに変える。変えられた（＝先に終えたのが自分の）ときだけ true。通知が重ならないようにする */
async function finishRunning(db: Db, id: string, patch: Partial<typeof schema.enishiSearchJobs.$inferInsert>): Promise<boolean> {
  const rows = await db.update(schema.enishiSearchJobs).set({ ...patch, claimedAt: null, updatedAt: nowSec() })
    .where(and(eq(schema.enishiSearchJobs.id, id), eq(schema.enishiSearchJobs.status, "running")))
    .returning({ id: schema.enishiSearchJobs.id }).all();
  return rows.length > 0;
}

async function completeJob(db: Db, env: Env, job: Job, params: JobParams, historyId: string, count: number): Promise<void> {
  if (!await finishRunning(db, job.id, { status: "done", stage: "finalize" })) return;
  // 照合できなかった人数は、保存した結果の「照合のできた範囲」から読む（件数をはっきり伝える）
  const row = await db.select({ resultJson: schema.enishiSearchHistory.resultJson }).from(schema.enishiSearchHistory)
    .where(eq(schema.enishiSearchHistory.id, historyId)).get().catch(() => undefined);
  let coverage: MatchCoverage | undefined;
  try { coverage = row ? (JSON.parse(row.resultJson) as { coverage?: MatchCoverage }).coverage : undefined; } catch { coverage = undefined; }
  const subject = params.mode === "giver" ? "あなたの人脈" : "候補";
  const note = coverage && coverage.unmatchedCandidates > 0
    ? `\n（${subject}${coverage.totalCandidates}人のうち、${coverage.unmatchedCandidates}人分は、AIの検索に時間がかかり、時間内に照合できませんでした。時間をおいて、もう一度さがすと、見つかることがあります）`
    : job.failedBatches > 0 || job.truncated ? "\n（AIの検索に時間がかかり、一部の人脈は照合できていない可能性があります。気になるときは、時間をおいて、もう一度さがしてみてください）" : "";
  await notifyMember(db, env, job, {
    subject: "🔎 検索が終わりました",
    message: `「${jobLabel(params)}」の結果が出ました（${count}件）。${note}`,
    path: `/enishi/history/${historyId}`,
  }).catch((err) => console.error("[enishi-job] 完了の通知に失敗", job.id, err));
  if (job.failedBatches > 0) {
    await alertAdminsIfManyFailures(db, env, job, params, "一部の候補が照合されないまま、結果を出しました")
      .catch((err) => console.error("[enishi-job] 管理者への連絡に失敗", job.id, err));
  }
}

async function failJob(db: Db, env: Env, job: Job, params: JobParams, reason: string): Promise<void> {
  if (!await finishRunning(db, job.id, { status: "error", errorMessage: reason })) return;
  await notifyMember(db, env, job, {
    subject: "🔎 検索がうまくいきませんでした",
    message: `「${jobLabel(params)}」の検索を最後まで終えられませんでした。${reason}`,
    path: "/enishi",
  }).catch((err) => console.error("[enishi-job] 失敗の通知に失敗", job.id, err));
  await alertAdminsIfManyFailures(db, env, job, params, "最後まで終えられませんでした").catch((err) => console.error("[enishi-job] 管理者への連絡に失敗", job.id, err));
}

// ---- 失敗が多いときの、システム管理者へのお知らせ ----

/** 失敗した束が「多い」か。全部が失敗したとき・3束以上・全体の3割以上（2束以上）のとき */
export function isManyFailures(failed: number, total: number): boolean {
  if (failed <= 0 || total <= 0) return false;
  return failed === total || failed >= ALERT_MIN_FAILED || (failed >= 2 && failed / total >= ALERT_FAILED_RATIO);
}

/** 失敗の理由を、数つきでまとめる（例：時間切れ（AIの応答が遅い）：3束／AIの利用回数の上限（429）：1束） */
export function summarizeCauses(errors: (string | null)[]): string {
  const count = new Map<string, number>();
  for (const e of errors) count.set(e ?? "処理が途中で打ち切られた", (count.get(e ?? "処理が途中で打ち切られた") ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([e, n]) => `${e}：${n}束`).join("／");
}

/**
 * 失敗した束（やり直しても失敗した束）が多いときに、システム管理者へメールで知らせる。
 * 1回の検索につき1通（検索の終わりを確定できた処理だけが呼ぶので、重ならない）。
 * 宛先は、システム管理者（super_admin）。いなければ、管理者全員。
 */
async function alertAdminsIfManyFailures(db: Db, env: Env, job: Job, params: JobParams, outcome: string): Promise<void> {
  const rows = await db.select().from(schema.enishiSearchJobBatches).where(eq(schema.enishiSearchJobBatches.jobId, job.id)).all();
  const summary = summarizeOriginals(rows);
  if (!isManyFailures(summary.failed, summary.total)) return;

  const supers = await db.select({ email: schema.admins.email, name: schema.admins.name }).from(schema.admins).where(eq(schema.admins.role, "super_admin")).all();
  const admins = supers.length > 0 ? supers : await db.select({ email: schema.admins.email, name: schema.admins.name }).from(schema.admins).all();
  if (admins.length === 0) return;

  const [member, design] = await Promise.all([
    db.select({ name: schema.members.name }).from(schema.members).where(eq(schema.members.id, job.memberId)).get(),
    db.select({ appTitle: schema.cardDesigns.appTitle }).from(schema.cardDesigns).get(),
  ]);
  const vars = {
    appTitle: design?.appTitle ?? "白樺クエスト",
    searchMode: params.mode === "for-me" ? "私のご縁" : params.mode === "giver" ? "貢献のご縁" : "人脈をさがす",
    memberName: member?.name ?? "（不明）",
    failedBatches: String(summary.failed), totalBatches: String(summary.total),
    outcome, causes: summarizeCauses(summary.failedErrors),
    occurredAt: new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date()),
    jobId: job.id,
  };
  const mailer = new MailService(db, env);
  await Promise.all(admins.map((a) => mailer.send("enishi_search_admin_alert", a.email, { ...vars, adminName: a.name })
    .catch((err) => console.error("[enishi-job] 管理者へのメールに失敗", a.email, err))));
}

// ---- 途中の結果 ----

export type PartialJobView =
  | { status: "running"; mode: JobParams["mode"]; label: string; stage: Job["stage"]; totalBatches: number; doneBatches: number; failedBatches: number; result: HistoryResult | null }
  | { status: "done"; historyId: string | null }
  | { status: "error"; message: string };

/**
 * 実行中の検索の「途中の結果」を、照合が終わった束の分だけで組み立てる（AIは呼ばない）。
 * 最終の結果とは、次の点が違う：直接の候補の二次チェック（AI）をしていない／協業イメージがない／まだ増える・順番が変わることがある。
 */
export async function buildPartialJobView(db: Db, job: Job): Promise<PartialJobView> {
  if (job.status === "done") return { status: "done", historyId: job.historyId };
  if (job.status === "error") return { status: "error", message: job.errorMessage ?? "検索を最後まで終えられませんでした" };
  const params = parseParams(job);
  const base = { status: "running" as const, mode: params.mode, label: jobLabel(params), stage: job.stage, totalBatches: job.totalBatches, doneBatches: job.doneBatches, failedBatches: job.failedBatches };
  const batches = await db.select().from(schema.enishiSearchJobBatches)
    .where(and(eq(schema.enishiSearchJobBatches.jobId, job.id), eq(schema.enishiSearchJobBatches.status, "done")))
    .orderBy(asc(schema.enishiSearchJobBatches.idx)).all();
  if (batches.length === 0 && !job.membersJson) return { ...base, result: null };

  const matches: JobMatch[] = interleaveMatches(batches.map((b) => JSON.parse(b.matchesJson ?? "[]") as JobMatch[]));
  if (params.mode === "giver") {
    const ctx = await loadGiverContext(db, job.memberId, params);
    const giverResult = await finalizeGiverResult({ apiKey: undefined, isDev: true, params, ctx, matches, aiCallFailed: false });
    return { ...base, result: augmentResultWithCards(giverResult, new Set(), new Set()) };
  }
  const { candidates, truncated } = await selectJobCandidates(db, job.memberId, params);
  const result = params.mode === "for-me"
    ? await finalizeForMeResult({ apiKey: undefined, isDev: true, params, candidates, matches, aiCallFailed: false, truncated })
    : await finalizeContactSearchResult({
        db, params, candidates, matches, aiCallFailed: false, truncated,
        memberHits: JSON.parse(job.membersJson ?? "[]") as MemberHit[], memberCollab: null,
      });
  return { ...base, result: augmentResultWithCards(result, new Set(), new Set()) };
}

// ---- 1ステップの実行と、自己連鎖 ----

async function runStage(db: Db, env: Env, job: Job): Promise<void> {
  const params = parseParams(job);
  switch (job.stage) {
    case "prepare": return stagePrepare(db, job, params);
    case "match": return stageMatch(db, env, job, params);
    case "members": return stageMembers(db, env, job, params);
    case "collab": return stageCollab(db, env, job, params);
    case "finalize": return stageFinalize(db, env, job, params);
  }
}

/**
 * 検索ジョブを1ステップ進める。終わったら、まだ続きがあれば自分自身を呼び直す。
 * 処理の完了は一定時間だけ待ち、間に合わなくても連鎖は止めない（打ち切られた分は、次のステップでやり直す）。
 */
export async function runSearchJobStep(db: Db, env: Env, jobId: string, origin: string | null, hop: number): Promise<void> {
  const now = nowSec();
  // 処理中の目印を取る（二重に処理しないため）。取れなければ、別の処理が進めているので何もしない
  const claimed = await db.update(schema.enishiSearchJobs)
    .set({ claimedAt: now, updatedAt: now, stageAttempts: sql`${schema.enishiSearchJobs.stageAttempts} + 1` })
    .where(and(
      eq(schema.enishiSearchJobs.id, jobId), eq(schema.enishiSearchJobs.status, "running"),
      or(isNull(schema.enishiSearchJobs.claimedAt), lt(schema.enishiSearchJobs.claimedAt, now - LEASE_SECONDS)),
    )).returning().all();
  const job = claimed[0];
  if (!job) return;

  try {
    await waitUpTo(runStage(db, env, job).catch(async (err) => {
      console.error("[enishi-job] ステップの実行に失敗", jobId, job.stage, err);
      // 束の照合以外の処理が、続けて失敗するときは、検索自体を失敗として終える
      // （束の照合は、ステップごとに進むため、ステップの回数では数えない。回数の上限は連鎖の上限で止める）
      if (job.stage !== "match" && job.stageAttempts > MAX_ATTEMPTS + 1) {
        await failJob(db, env, job, parseParams(job), "一時的な不具合で、最後まで進められませんでした。時間をおいて、もう一度お試しください。");
      }
    }));
  } finally {
    await db.update(schema.enishiSearchJobs).set({ claimedAt: null })
      .where(and(eq(schema.enishiSearchJobs.id, jobId), eq(schema.enishiSearchJobs.status, "running"))).run().catch(() => {});
  }

  const after = await db.select({ status: schema.enishiSearchJobs.status }).from(schema.enishiSearchJobs)
    .where(eq(schema.enishiSearchJobs.id, jobId)).get();
  if (after?.status === "running" && hop >= MAX_HOPS) {
    await failJob(db, env, job, parseParams(job), "時間がかかりすぎたため、途中で終了しました。条件をしぼって、もう一度お試しください。");
    return;
  }
  if (after?.status === "running" && origin) {
    await fetch(`${origin}/api/internal/run-enishi-search-job`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-task-secret": env.INTERNAL_TASK_SECRET },
      body: JSON.stringify({ jobId, hop: hop + 1 }),
    }).catch((err) => console.error("[enishi-job] 自己連鎖の呼び出しに失敗", jobId, err));
  }
}
