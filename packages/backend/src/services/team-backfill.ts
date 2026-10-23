// =============================================================
// 既存の緩い／パワーチームの「仮のプロフィール」と「メンバーの仮の役割分担」を、AIで一括して作る
//   ・プロフィールの行がまだない（＝この機能ができる前から存在する）チームが対象
//   ・リーダーの確認待ち（is_provisional=1）の状態で保存する。ホームの「やること」で、リーダーに確認を促す
//   ・Cloudflare の実行時間の制限があるため、1回に数チームずつ処理して、内部のAPIを呼んで次の回へつなぐ（会社概要の生成と同じ方式）
//   ・起動のきっかけ：公開後、誰かがアプリを開いたとき（/api/auth/me）、または管理者が管理画面から押したとき
// =============================================================
import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { newId } from "./auth.ts";
import { generateTeamDraftIdeas } from "./team-draft-ideas.ts";
import { buildAiPeople, loadRoster, parseRoles, saveProfile, type Subject } from "./team-workspace.ts";
import type { Env } from "../types.ts";

const ROUND_SIZE = 2;
const MAX_HOPS = 40;
const STALE_SECONDS = 10 * 60;
const nowSec = () => Math.floor(Date.now() / 1000);

const MISSING_PROFILE = sql`NOT EXISTS (SELECT 1 FROM team_profiles p WHERE p.subject_type = 'team' AND p.subject_id = ${schema.collabTeams.id})`;

/** 仮のプロフィールを作る対象が残っているか（軽い確認） */
export async function hasBackfillWork(db: Db): Promise<boolean> {
  const missing = await db.select({ id: schema.collabTeams.id }).from(schema.collabTeams).where(MISSING_PROFILE).limit(1).get();
  if (missing) return true;
  const stale = await db.select({ id: schema.teamProfiles.id }).from(schema.teamProfiles)
    .where(and(eq(schema.teamProfiles.subjectType, "team"), eq(schema.teamProfiles.backfillStatus, "generating"), lt(schema.teamProfiles.backfillAt, nowSec() - STALE_SECONDS))).limit(1).get();
  return !!stale;
}

/** 生成する対象を、ほかの処理と重ならないように確保（claim）する */
async function claim(db: Db, retryFailed: boolean): Promise<{ id: string; name: string }[]> {
  const now = nowSec();
  const claimed: { id: string; name: string }[] = [];

  const missing = await db.select({ id: schema.collabTeams.id, name: schema.collabTeams.name }).from(schema.collabTeams).where(MISSING_PROFILE).limit(ROUND_SIZE).all();
  for (const t of missing) {
    const inserted = await db.insert(schema.teamProfiles).values({
      id: newId(), subjectType: "team", subjectId: t.id, backfillStatus: "generating", backfillAt: now, createdAt: now, updatedAt: now,
    }).onConflictDoNothing().returning({ id: schema.teamProfiles.id }).all();
    if (inserted.length > 0) claimed.push(t);
  }

  // 途中で止まったまま（一定時間たった）もの、管理者が再試行を指示したときの失敗したものを、もう一度対象にする
  if (claimed.length < ROUND_SIZE) {
    const retryable = retryFailed
      ? sql`(${schema.teamProfiles.backfillStatus} = 'failed' OR (${schema.teamProfiles.backfillStatus} = 'generating' AND ${schema.teamProfiles.backfillAt} < ${now - STALE_SECONDS}))`
      : sql`(${schema.teamProfiles.backfillStatus} = 'generating' AND ${schema.teamProfiles.backfillAt} < ${now - STALE_SECONDS})`;
    const rows = await db.select({ id: schema.teamProfiles.id, teamId: schema.teamProfiles.subjectId }).from(schema.teamProfiles)
      .where(and(eq(schema.teamProfiles.subjectType, "team"), retryable)).limit(ROUND_SIZE - claimed.length).all();
    for (const r of rows) {
      const got = await db.update(schema.teamProfiles).set({ backfillStatus: "generating", backfillAt: now })
        .where(and(eq(schema.teamProfiles.id, r.id), retryable)).returning({ id: schema.teamProfiles.id }).all();
      if (got.length === 0) continue;
      const t = await db.select({ id: schema.collabTeams.id, name: schema.collabTeams.name }).from(schema.collabTeams).where(eq(schema.collabTeams.id, r.teamId)).get();
      if (t) claimed.push(t);
    }
  }
  return claimed;
}

async function generateOne(db: Db, env: Env, team: { id: string; name: string }): Promise<void> {
  try {
    const row = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, team.id)).get();
    if (!row) return;
    const subject: Subject = { type: "team", id: team.id, title: team.name, goal: "", stage: row.type === "power" ? "power" : "loose", archived: row.archived === 1, leaderId: row.createdBy, createdAt: row.createdAt };
    const roster = await loadRoster(db, subject, { isActive: true, isPending: false, isLeader: true, leaderGone: false }, row.createdBy);
    const people = await buildAiPeople(db, subject, roster);
    const ideas = people.length === 0 ? null : await generateTeamDraftIdeas({
      apiKey: env.ANTHROPIC_API_KEY, isDev: env.ENVIRONMENT === "development", title: team.name, goal: "", people, maxTalents: 0,
    });
    if (!ideas) {
      await saveProfile(db, "team", team.id, { backfillStatus: "failed", backfillAt: nowSec() }, null);
      return;
    }
    const valid = new Set(people.map((p) => p.key));
    const roles = Object.fromEntries(ideas.roles.filter((r) => valid.has(r.key)).map((r) => [r.key, r.role]));
    await saveProfile(db, "team", team.id, {
      businessTitle: ideas.businessTitle, summary: ideas.summary, targetCustomers: ideas.targetCustomers ?? "",
      firstStepsJson: JSON.stringify(ideas.firstSteps), rolesJson: JSON.stringify({ ...parseRoles(null), ...roles }),
      isProvisional: 1, backfillStatus: "done", backfillAt: nowSec(),
    }, null);
  } catch (e) {
    console.error("[team-backfill] 仮プロフィールの生成に失敗", team.id, e);
    await saveProfile(db, "team", team.id, { backfillStatus: "failed", backfillAt: nowSec() }, null).catch(() => undefined);
  }
}

/** 1回分（ROUND_SIZE チーム）を処理して、まだ残っていれば次の回を呼ぶ */
export async function sweepTeamProfileBackfill(db: Db, env: Env, origin: string, hop: number, retryFailed = false): Promise<void> {
  const targets = await claim(db, retryFailed);
  if (targets.length === 0) return;
  for (const t of targets) await generateOne(db, env, t);
  if (targets.length >= ROUND_SIZE && hop < MAX_HOPS) {
    await fetch(`${origin}/api/internal/team-profile-backfill`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-task-secret": env.INTERNAL_TASK_SECRET },
      body: JSON.stringify({ hop: hop + 1, retryFailed }),
    }).catch((err) => console.error("[team-backfill] 自己連鎖呼び出しに失敗", err));
  }
}

/** アプリが開かれたときに呼ぶ。仮のプロフィールを作る対象が残っていれば、バックグラウンドで生成を始める */
export async function maybeStartTeamBackfill(db: Db, env: Env, origin: string): Promise<void> {
  try {
    if (await hasBackfillWork(db)) await sweepTeamProfileBackfill(db, env, origin, 0);
  } catch (e) {
    console.error("[team-backfill] 開始に失敗", e);
  }
}
