// =============================================================
// ご縁さがし 検索ジョブ — 「私のご縁」「人脈をさがす」を、裏で実行して終わったら通知する
//
// 候補を小さな束（バッチ）に分けて、束ごとにAIで照合し、結果を合算する。1回の処理（ステップ）は
// waitUntil の制限（応答後およそ30秒）に収まる短さにして、終わったら自分自身を呼び直して続ける
// （会社概要の自動生成・所在地の調べと同じ自己連鎖方式）。
//   prepare → match（束ごと・3束ずつ並行）→ members（メンバー本人の検索）→ collab（協業イメージ）→ finalize
// 終わったら、検索履歴に保存し、アプリ内の通知・プッシュ通知・メールで知らせる。
// 途中で止まっても、ステップごとにやり直せる（束ごとに最大3回）。
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
  type JobParams, type JobCandidate, type JobMatch, type MemberHit,
} from "./enishi-search.ts";
import type { CollabIdeas } from "./member-collab.ts";
import { buildForMeTitle, buildContactSearchTitle, countResults, saveSearchHistory } from "./enishi-history.ts";
import type { Env } from "../types.ts";

type Db = ReturnType<typeof createDb>;
type Job = typeof schema.enishiSearchJobs.$inferSelect;

/** 処理中の目印の有効時間（秒）。これを過ぎた目印は、止まった処理のものとみなして取り直せる */
const LEASE_SECONDS = 60;
/** 同じ処理のやり直しの上限（束は束ごと、それ以外はステップごと） */
const MAX_ATTEMPTS = 3;
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
  const { candidates, truncated } = await selectJobCandidates(db, job.memberId, params);
  const batches: string[][] = [];
  for (let i = 0; i < candidates.length; i += JOB_BATCH_SIZE) {
    batches.push(candidates.slice(i, i + JOB_BATCH_SIZE).map((c) => c.candidateId));
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

async function countBatches(db: Db, jobId: string): Promise<{ done: number; failed: number; open: number }> {
  const rows = await db.select({ status: schema.enishiSearchJobBatches.status, attempts: schema.enishiSearchJobBatches.attempts, n: sql<number>`count(*)` })
    .from(schema.enishiSearchJobBatches).where(eq(schema.enishiSearchJobBatches.jobId, jobId))
    .groupBy(schema.enishiSearchJobBatches.status, schema.enishiSearchJobBatches.attempts).all();
  let done = 0, failed = 0, open = 0;
  for (const r of rows) {
    if (r.status === "done") done += r.n;
    else if (r.status === "failed" || r.attempts >= MAX_ATTEMPTS) failed += r.n;
    else open += r.n;
  }
  return { done, failed, open };
}

async function stageMatch(db: Db, env: Env, job: Job, params: JobParams): Promise<void> {
  const isDev = env.ENVIRONMENT === "development";
  const todo = await db.select().from(schema.enishiSearchJobBatches)
    .where(and(
      eq(schema.enishiSearchJobBatches.jobId, job.id),
      inArray(schema.enishiSearchJobBatches.status, ["pending", "processing"]),
      lt(schema.enishiSearchJobBatches.attempts, MAX_ATTEMPTS),
    ))
    .orderBy(asc(schema.enishiSearchJobBatches.idx)).limit(MATCH_PARALLEL).all();

  if (todo.length > 0) {
    const { candidates } = await selectJobCandidates(db, job.memberId, params);
    const byId = new Map<string, JobCandidate>(candidates.map((c) => [c.candidateId, c]));
    // 取りかかる前に、やり直しの回数を数えておく（途中で打ち切られても、回数は残る）
    await Promise.all(todo.map((b) => db.update(schema.enishiSearchJobBatches)
      .set({ status: "processing", attempts: b.attempts + 1 })
      .where(and(eq(schema.enishiSearchJobBatches.jobId, b.jobId), eq(schema.enishiSearchJobBatches.idx, b.idx))).run()));
    await Promise.all(todo.map(async (b) => {
      const ids = JSON.parse(b.candidateIdsJson) as string[];
      const batch = ids.map((id) => byId.get(id)).filter((c): c is JobCandidate => !!c);
      const matches = batch.length === 0 ? [] : await matchJobBatch(env.ANTHROPIC_API_KEY, isDev, params, batch);
      const key = and(eq(schema.enishiSearchJobBatches.jobId, b.jobId), eq(schema.enishiSearchJobBatches.idx, b.idx));
      if (matches) {
        await db.update(schema.enishiSearchJobBatches).set({ status: "done", matchesJson: JSON.stringify(matches) }).where(key).run();
      } else {
        await db.update(schema.enishiSearchJobBatches).set({ status: b.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending" }).where(key).run();
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
  const failedBatches = batches.filter((b) => b.status === "failed").length;
  if (batches.length > 0 && failedBatches === batches.length) {
    await failJob(db, env, job, params, "AIの照合がうまくいきませんでした。時間をおいて、もう一度お試しください。");
    return;
  }
  const matches: JobMatch[] = interleaveMatches(
    batches.filter((b) => b.status === "done").map((b) => JSON.parse(b.matchesJson ?? "[]") as JobMatch[]),
  );
  const { candidates, truncated } = await selectJobCandidates(db, job.memberId, params);
  const aiCallFailed = failedBatches > 0;
  // 最後の1回は、二次チェック（AI）を省いて確実に仕上げる
  const skipVerify = isDev || job.stageAttempts >= MAX_ATTEMPTS;
  const apiKey = env.ANTHROPIC_API_KEY;

  const created = nowSec();
  let result;
  let title: string;
  let historyParams: unknown;
  if (params.mode === "for-me") {
    result = await finalizeForMeResult({ apiKey, isDev: skipVerify, params, candidates, matches, aiCallFailed, truncated });
    title = buildForMeTitle(params.targets, created, countResults(result));
    historyParams = { targetIds: params.targetIds, maxHop: params.maxHop, count: params.count, includeOwnContacts: params.includeOwnContacts };
  } else {
    result = await finalizeContactSearchResult({
      db, params, candidates, matches, aiCallFailed, truncated,
      memberHits: JSON.parse(job.membersJson ?? "[]") as MemberHit[],
      memberCollab: job.collabJson ? JSON.parse(job.collabJson) as CollabIdeas : null,
    });
    title = buildContactSearchTitle(params.freeText, created, countResults(result));
    historyParams = { specialties: params.specialties, freeText: params.freeText, scope: params.scope, memberIds: params.memberIds, count: params.count };
  }
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
  const note = job.failedBatches > 0 || job.truncated ? "\n（一部の人脈は、うまく照合できなかった可能性があります。気になるときは、もう一度さがしてみてください）" : "";
  await notifyMember(db, env, job, {
    subject: "🔎 検索が終わりました",
    message: `「${jobLabel(params)}」の結果が出ました（${count}件）。${note}`,
    path: `/enishi/history/${historyId}`,
  }).catch((err) => console.error("[enishi-job] 完了の通知に失敗", job.id, err));
}

async function failJob(db: Db, env: Env, job: Job, params: JobParams, reason: string): Promise<void> {
  if (!await finishRunning(db, job.id, { status: "error", errorMessage: reason })) return;
  await notifyMember(db, env, job, {
    subject: "🔎 検索がうまくいきませんでした",
    message: `「${jobLabel(params)}」の検索を最後まで終えられませんでした。${reason}`,
    path: "/enishi",
  }).catch((err) => console.error("[enishi-job] 失敗の通知に失敗", job.id, err));
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
