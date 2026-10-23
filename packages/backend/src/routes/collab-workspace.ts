// =============================================================
// チーム育成（チーム案・緩いチーム・パワーチーム共通）
//   :type は "draft"（検討中のチーム案）または "team"（緩いチーム・パワーチーム）
// GET    /api/collab/workspace/todos                      — ホームの「やること」に出すもの（プロフィール・再検討の確認・役割の承認・期限など）
// GET    /api/collab/workspace/talent-board               — 募集中の人材（公開されたもの）の一覧
// GET    /api/collab/workspace/:type/:id                  — 詳細（プロフィール・メンバー・候補・募集人材・提案・歩み）
// PATCH  /api/collab/workspace/draft/:id                  — チーム案のタイトル・考えたいことを更新
// PUT    /api/collab/workspace/:type/:id/profile          — プロフィールの編集（リーダー）
// POST   /api/collab/workspace/:type/:id/profile/confirm  — 仮のプロフィールを「この内容でよい」と確認する（リーダー）
// PUT    /api/collab/workspace/:type/:id/roles            — 役割の編集（自分の役割は誰でも。他の人の役割は、リーダー以外は承認待ちの提案になる）
// POST   /api/collab/workspace/team/:id/role-requests/:rid/approve|reject — 役割の変更提案の承認・却下（リーダー）
// POST   /api/collab/workspace/:type/:id/prospects        — 候補・募集人材の追加（リーダー）
// PATCH  /api/collab/workspace/:type/:id/prospects/:pid   — 確定・公開・募集人材の内容の更新（リーダー）
// DELETE /api/collab/workspace/:type/:id/prospects/:pid   — 候補・募集人材を外す（リーダー）
// POST   /api/collab/workspace/team/:id/prospects/:pid/invite   — 候補のメンバーに声をかける（招待。リーダー）
// POST   /api/collab/workspace/team/:id/prospects/:pid/interest — 公開された募集人材への「興味あり」（参加希望）
// POST   /api/collab/workspace/:type/:id/proposals        — AIによる再検討を実行（参加中のメンバーなら誰でも）。結果は「提案」として残る
// POST   /api/collab/workspace/:type/:id/proposals/:pid/apply|discard — 提案を情報ごとに選んで反映／破棄（リーダー）
// =============================================================
import { Hono } from "hono";
import { and, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { newId } from "../services/auth.ts";
import { MailService } from "../services/mailer.ts";
import { isMemberApproved, resolveEffectiveMemberId } from "../services/resolve-member.ts";
import {
  REGENERATE_NOTE_MAX, REGENERATE_PERSPECTIVES, generateTeamDraftIdeas, type RegeneratePerspective, type TeamDraftIdeas,
} from "../services/team-draft-ideas.ts";
import {
  DAILY_AI_RUNS, MAX_PEOPLE, adoptLegacyDraftIdeas, MILESTONE_LABEL, PROPOSAL_HISTORY, addMilestone, applyProposal, buildAiPeople, computeHealth, getProfile,
  hasProfileContent, isProfileComplete, loadRoster, loadSuggestionPool, parseApplied, parseRoles, parseSteps, profileAsPrevious,
  remainingItems, resolveSubject, saveProfile, setRole, type Access, type ApplySelection, type MilestoneType, type Subject, type SubjectType,
} from "../services/team-workspace.ts";
import type { Env, Variables } from "../types.ts";

export const collabWorkspaceRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
collabWorkspaceRoutes.use("*", authMiddleware);

type Db = ReturnType<typeof createDb>;
const err = (code: string, message: string) => ({ error: { code, message } });
const nowSec = () => Math.floor(Date.now() / 1000);
const TEXT_MAX = 1000;
const TITLE_MAX = 60;

async function resolveMe(c: { get: (k: "userId" | "userType") => never | string }, db: Db): Promise<string | null> {
  const meId = await resolveEffectiveMemberId(db, c.get("userId") as string, c.get("userType") as "member" | "admin");
  if (!meId || !(await isMemberApproved(db, meId))) return null;
  return meId;
}

function parseType(v: string): SubjectType | null {
  return v === "draft" || v === "team" ? v : null;
}

/** 対象と権限を解決する。見つからなければ null（チーム案は作成者以外には存在しないものとして扱う） */
async function open(c: { req: { param: (k: string) => string }; get: (k: "userId" | "userType") => never | string }, db: Db) {
  const meId = await resolveMe(c, db);
  if (!meId) return { error: err("forbidden", "メンバーとしての承認後にご利用いただけます"), status: 403 as const };
  const type = parseType(c.req.param("type"));
  if (!type) return { error: err("not_found", "見つかりません"), status: 404 as const };
  const resolved = await resolveSubject(db, type, c.req.param("id"), meId);
  if (!resolved) return { error: err("not_found", type === "draft" ? "チーム案が見つかりません" : "チームが見つかりません"), status: 404 as const };
  // この機能ができる前に作られたチーム案は、初めて開いたときに、まとめ済みの内容をプロフィールに引き継ぐ
  if (type === "draft") await adoptLegacyDraftIdeas(db, resolved.subject.id, meId);
  return { meId, ...resolved };
}

const needLeader = (a: Access) => (a.isLeader ? null : err("forbidden", a.leaderGone ? "このチームの参加中のメンバーだけが操作できます" : "リーダーだけが操作できます"));

async function memberNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < uniq.length; i += 80) {
    const rows = await db.select({ id: schema.members.id, name: schema.members.name }).from(schema.members).where(inArray(schema.members.id, uniq.slice(i, i + 80))).all();
    for (const r of rows) map.set(r.id, r.name);
  }
  return map;
}

// ---- ルールにもとづく「次の一歩」の提案（AIの利用料なし） ----
type NextStep = { id: string; kind: "invite_candidate" | "find_talent" | "publish_talent" | "role" | "meeting" | "profile" | "first_step"; title: string; detail: string; refKey?: string; text?: string };

const FOURTEEN_DAYS = 14 * 86400;

function buildNextSteps(
  subject: Subject, profile: Awaited<ReturnType<typeof getProfile>>, roster: Awaited<ReturnType<typeof loadRoster>>,
  existingTasks: string[], hasMeeting: boolean, prospectAdded: Map<string, number>,
): NextStep[] {
  const steps: NextStep[] = [];
  if (!isProfileComplete(profile) && subject.type === "team") {
    steps.push({ id: "profile", kind: "profile", title: "チームプロフィールを入力する", detail: "事業・概要・お客様像の3つを埋めると、入力済みになります" });
  }
  for (const m of roster.members) {
    if (m.status === "active" && !m.role) steps.push({ id: `role-${m.key}`, kind: "role", title: `${m.name}さんの役割を決める`, detail: "役割が未入力です", refKey: m.key });
  }
  for (const p of roster.prospects) {
    if (p.kind === "member" && subject.type === "team") {
      const added = prospectAdded.get(p.prospectId) ?? 0;
      if (nowSec() - added >= FOURTEEN_DAYS) {
        steps.push({ id: `invite-${p.prospectId}`, kind: "invite_candidate", title: `${p.name}さんに声をかける`, detail: "候補に入れて2週間たちました。事業のイメージを伝えて、参加の意向を聞いてみましょう", refKey: p.key });
      }
    } else if (p.kind === "talent" && !p.filled) {
      steps.push({ id: `talent-${p.prospectId}`, kind: "find_talent", title: `「${p.title}」を人脈検索で探す`, detail: "人物像を入れた状態で、人脈検索を開きます", refKey: p.key, text: `${p.title} ${p.profile ?? ""}`.trim() });
      if (subject.type === "team" && !p.published) {
        steps.push({ id: `publish-${p.prospectId}`, kind: "publish_talent", title: `「${p.title}」を募集として公開する`, detail: "チャプターのメンバーから、興味ありの声が届くようになります", refKey: p.key });
      }
    }
  }
  if (subject.type === "team" && !hasMeeting) {
    steps.push({ id: "meeting", kind: "meeting", title: "事業のたたき台を話し合う会議を開く", detail: "チームの会議として作成します" });
  }
  const steps0 = parseSteps(profile?.firstStepsJson);
  for (const [i, text] of steps0.entries()) {
    if (!existingTasks.includes(text)) steps.push({ id: `first-${i}`, kind: "first_step", title: `最初の一歩を、アクションに追加する：${text}`, detail: "プロフィールの「最初の一歩」から", text });
  }
  return steps.slice(0, 6);
}

// ---- 詳細 ----
async function buildDetail(db: Db, meId: string, subject: Subject, access: Access) {
  const profile = await getProfile(db, subject.type, subject.id);
  const roster = await loadRoster(db, subject, access, meId);
  const seeAll = access.isActive;
  const complete = isProfileComplete(profile);

  // プロフィール：参加中の人には全部。それ以外には、確認済みの事業内容だけ
  const showBusiness = seeAll || (!!profile && !profile.isProvisional && hasProfileContent(profile));
  const profileView = profile && showBusiness ? {
    businessTitle: profile.businessTitle, summary: profile.summary, targetCustomers: profile.targetCustomers,
    goal: seeAll ? (subject.type === "draft" ? subject.goal : profile.goal) : "",
    firstSteps: seeAll ? parseSteps(profile.firstStepsJson) : [],
    isProvisional: profile.isProvisional === 1, backfillStatus: profile.backfillStatus, updatedAt: profile.updatedAt,
  } : (seeAll ? {
    businessTitle: "", summary: "", targetCustomers: "", goal: subject.type === "draft" ? subject.goal : "", firstSteps: [] as string[],
    isProvisional: false, backfillStatus: profile?.backfillStatus ?? null, updatedAt: profile?.updatedAt ?? 0,
  } : null);

  const base = {
    type: subject.type, id: subject.id, stage: subject.stage, title: subject.title, archived: subject.archived, leaderId: subject.leaderId,
    access: { ...access, canRun: access.isActive, canApply: access.isLeader, canEditProfile: access.isLeader },
    profile: profileView, complete, members: roster.members, prospects: roster.prospects, maxPeople: MAX_PEOPLE,
  };
  if (!seeAll) {
    return { ...base, roleRequests: [], proposals: [], nextSteps: [], milestones: [], health: null, aiRunsLeft: 0 };
  }

  // 役割変更の提案（承認待ち）
  const reqRows = subject.type === "team"
    ? await db.select().from(schema.teamRoleRequests).where(and(eq(schema.teamRoleRequests.teamId, subject.id), eq(schema.teamRoleRequests.status, "pending"))).orderBy(schema.teamRoleRequests.createdAt).all()
    : [];
  const roles = parseRoles(profile?.rolesJson);

  // 提案の履歴
  const propRows = await db.select().from(schema.teamProfileProposals)
    .where(and(eq(schema.teamProfileProposals.subjectType, subject.type), eq(schema.teamProfileProposals.subjectId, subject.id)))
    .orderBy(desc(schema.teamProfileProposals.createdAt)).limit(PROPOSAL_HISTORY).all();
  const names = await memberNames(db, [...reqRows.map((r) => r.requestedBy), ...propRows.map((p) => p.createdBy)]);
  const dayAgo = nowSec() - 86400;
  const aiRunsToday = propRows.filter((p) => p.createdAt >= dayAgo).length;

  const proposals = propRows.map((p) => {
    let ideas: TeamDraftIdeas | null = null;
    try { ideas = JSON.parse(p.proposalJson) as TeamDraftIdeas; } catch { ideas = null; }
    const applied = parseApplied(p.appliedJson);
    return {
      id: p.id, createdBy: { id: p.createdBy, name: names.get(p.createdBy) ?? "メンバー" }, createdAt: p.createdAt,
      perspectives: JSON.parse(p.perspectivesJson || "[]") as RegeneratePerspective[], note: p.note, status: p.status,
      remaining: ideas ? remainingItems(ideas, applied) : 0, applied, stale: !!profile && profile.updatedAt > p.baseUpdatedAt, ideas,
    };
  });

  // 次の一歩・歩み・元気度
  const [actionRows, meetingRow, prospectRows, milestoneRows, health] = await Promise.all([
    db.select({ task: schema.collabTeamActionItems.task }).from(schema.collabTeamActionItems).where(eq(schema.collabTeamActionItems.teamId, subject.id)).all(),
    subject.type === "team"
      ? db.select({ id: schema.meetings.id }).from(schema.meetings).where(eq(schema.meetings.collabTeamId, subject.id)).limit(1).get()
      : Promise.resolve(undefined),
    db.select({ id: schema.teamProspects.id, at: schema.teamProspects.createdAt }).from(schema.teamProspects)
      .where(and(eq(schema.teamProspects.subjectType, subject.type), eq(schema.teamProspects.subjectId, subject.id))).all(),
    subject.type === "team"
      ? db.select().from(schema.teamMilestones).where(eq(schema.teamMilestones.teamId, subject.id)).orderBy(desc(schema.teamMilestones.createdAt)).all()
      : Promise.resolve([]),
    subject.type === "team" ? computeHealth(db, subject.id, subject.createdAt) : Promise.resolve(null),
  ]);
  const nextSteps = buildNextSteps(subject, profile, roster, actionRows.map((a) => a.task), !!meetingRow, new Map(prospectRows.map((r) => [r.id, r.at])));

  return {
    ...base,
    roleRequests: reqRows.map((r) => ({
      id: r.id, targetKey: r.targetKey, targetName: roster.nameByKey.get(r.targetKey) ?? "メンバー", currentRole: roles[r.targetKey] ?? null,
      proposedRole: r.proposedRole, requestedBy: { id: r.requestedBy, name: names.get(r.requestedBy) ?? "メンバー" }, createdAt: r.createdAt, mine: r.requestedBy === meId,
    })),
    proposals, nextSteps, health,
    milestones: milestoneRows.map((m) => ({ id: m.id, type: m.type, label: MILESTONE_LABEL[m.type as MilestoneType] ?? m.type, at: m.createdAt })),
    aiRunsLeft: Math.max(0, DAILY_AI_RUNS - aiRunsToday),
  };
}

// ---- ホームの「やること」 ----
collabWorkspaceRoutes.get("/todos", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveMe(c, db);
  if (!meId) return c.json({ data: [] });

  type Todo = { key: string; icon: string; title: string; detail?: string; to: string; urgent?: boolean };
  const todos: Todo[] = [];
  const mine = await db.select({ teamId: schema.collabTeamMembers.teamId }).from(schema.collabTeamMembers)
    .where(and(eq(schema.collabTeamMembers.memberId, meId), eq(schema.collabTeamMembers.status, "active"))).all();
  const teamIds = mine.map((m) => m.teamId);
  if (teamIds.length === 0) return c.json({ data: todos });

  const teams = await db.select().from(schema.collabTeams).where(inArray(schema.collabTeams.id, teamIds)).all();
  const leaderIds = [...new Set(teams.map((t) => t.createdBy))];
  const leaders = new Map((await db.select({ id: schema.members.id, status: schema.members.status }).from(schema.members).where(inArray(schema.members.id, leaderIds)).all()).map((l) => [l.id, l.status]));
  const profiles = new Map((await db.select().from(schema.teamProfiles).where(and(eq(schema.teamProfiles.subjectType, "team"), inArray(schema.teamProfiles.subjectId, teamIds))).all()).map((p) => [p.subjectId, p]));
  const names = new Map<string, string>();

  for (const t of teams) {
    const leaderStatus = leaders.get(t.createdBy);
    const leaderEquivalent = t.createdBy === meId || !leaderStatus || leaderStatus === "deleted";
    if (!leaderEquivalent) continue;
    const to = `/collab/teams/${t.id}`;
    const profile = profiles.get(t.id) ?? null;

    // プロフィール：入力済みになるまで、表示し続ける（休止中のチームは除く）
    if (!t.archived && !isProfileComplete(profile)) {
      const provisional = !!profile && profile.isProvisional === 1 && hasProfileContent(profile);
      todos.push(provisional
        ? { key: `team-profile-${t.id}`, icon: "📝", urgent: true, title: `「${t.name}」のプロフィールを確認しましょう`, detail: "AIが仮に作った内容（事業・役割）があります。確認して、直すか「この内容でよい」を押してください", to }
        : { key: `team-profile-${t.id}`, icon: "📝", urgent: true, title: `「${t.name}」のプロフィールを入力しましょう`, detail: "事業・概要・お客様像を入力します。AIの下書きから作れます", to });
    }

    // リーダー以外が実行した再検討の結果
    const open = await db.select().from(schema.teamProfileProposals)
      .where(and(eq(schema.teamProfileProposals.subjectType, "team"), eq(schema.teamProfileProposals.subjectId, t.id), eq(schema.teamProfileProposals.status, "open"), ne(schema.teamProfileProposals.createdBy, meId))).all();
    const reviewable = open.filter((p) => {
      try { return remainingItems(JSON.parse(p.proposalJson) as TeamDraftIdeas, parseApplied(p.appliedJson)) > 0; } catch { return false; }
    });
    if (reviewable.length > 0) {
      const who = await memberNames(db, reviewable.map((p) => p.createdBy));
      names.set(t.id, [...new Set(reviewable.map((p) => who.get(p.createdBy) ?? "メンバー"))].join("・"));
      todos.push({ key: `team-proposal-${t.id}`, icon: "💡", title: `${names.get(t.id)}さんがAIで再検討しました`, detail: `「${t.name}」：結果を確認して、反映するものを選んでください`, to });
    }

    // 役割の変更提案
    const reqs = await db.select().from(schema.teamRoleRequests).where(and(eq(schema.teamRoleRequests.teamId, t.id), eq(schema.teamRoleRequests.status, "pending"))).all();
    if (reqs.length > 0) {
      todos.push({ key: `team-roles-${t.id}`, icon: "🎭", title: `役割の変更の提案が${reqs.length}件あります`, detail: `「${t.name}」：承認するか、却下するかを選んでください`, to });
    }

    // 参加希望
    const joinReq = await db.select({ memberId: schema.collabTeamMembers.memberId, invitedBy: schema.collabTeamMembers.invitedBy }).from(schema.collabTeamMembers)
      .where(and(eq(schema.collabTeamMembers.teamId, t.id), eq(schema.collabTeamMembers.status, "pending"))).all();
    const requesters = joinReq.filter((j) => j.invitedBy === null);
    if (requesters.length > 0) {
      const who = await memberNames(db, requesters.map((r) => r.memberId));
      todos.push({ key: `team-join-${t.id}`, icon: "🙋", urgent: true, title: `${requesters.map((r) => who.get(r.memberId) ?? "メンバー").join("・")}さんがチームへの参加を希望しています`, detail: `「${t.name}」：承認するか、却下するかを選んでください`, to });
    }

    // 要フォロー（60日以上、動きがない）
    if (!t.archived) {
      const health = await computeHealth(db, t.id, t.createdAt);
      if (health.status === "follow") {
        todos.push({ key: `team-follow-${t.id}`, icon: "🌱", title: `「${t.name}」が、しばらく動いていません`, detail: "次の一歩を提案してもらったり、AIで再検討したりしてみませんか", to });
      }
    }
  }

  // 自分が担当のアクションの期限（前日と超過）
  const tomorrow = new Date(Date.now() + 9 * 3600_000 + 86400_000).toISOString().slice(0, 10);
  const due = await db.select().from(schema.collabTeamActionItems)
    .where(and(inArray(schema.collabTeamActionItems.teamId, teamIds), eq(schema.collabTeamActionItems.assigneeMemberId, meId), eq(schema.collabTeamActionItems.completed, 0), lte(schema.collabTeamActionItems.dueDate, tomorrow))).all();
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  for (const a of due) {
    if (!a.dueDate) continue;
    const overdue = a.dueDate < today;
    todos.push({ key: `team-action-${a.id}`, icon: "⏰", urgent: overdue, title: `${overdue ? "期限を過ぎています" : "期限が近づいています"}：${a.task}`, detail: `「${teamName.get(a.teamId) ?? "チーム"}」・期限 ${a.dueDate}`, to: `/collab/teams/${a.teamId}` });
  }
  return c.json({ data: todos });
});

// ---- 募集中の人材（公開されたもの） ----
collabWorkspaceRoutes.get("/talent-board", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveMe(c, db);
  if (!meId) return c.json({ data: [] });
  const rows = await db.select().from(schema.teamProspects)
    .where(and(eq(schema.teamProspects.subjectType, "team"), eq(schema.teamProspects.kind, "talent"), eq(schema.teamProspects.published, 1))).orderBy(desc(schema.teamProspects.createdAt)).all();
  const open = rows.filter((r) => !r.filledByMemberId);
  if (open.length === 0) return c.json({ data: [] });
  const teams = await db.select().from(schema.collabTeams).where(inArray(schema.collabTeams.id, open.map((r) => r.subjectId))).all();
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const myRows = await db.select({ teamId: schema.collabTeamMembers.teamId, prospectId: schema.collabTeamMembers.prospectId, status: schema.collabTeamMembers.status })
    .from(schema.collabTeamMembers).where(eq(schema.collabTeamMembers.memberId, meId)).all();
  const myTeam = new Map(myRows.map((r) => [r.teamId, r]));
  return c.json({
    data: open.flatMap((r) => {
      const t = teamById.get(r.subjectId);
      if (!t || t.archived) return [];
      const mine = myTeam.get(t.id);
      return [{
        prospectId: r.id, teamId: t.id, teamName: t.name, teamType: t.type, title: r.talentTitle ?? "", profile: r.talentProfile ?? "", reason: r.talentReason ?? "",
        isMember: mine?.status === "active", interested: mine?.status === "pending" && mine.prospectId === r.id,
      }];
    }),
  });
});

collabWorkspaceRoutes.get("/:type/:id", async (c) => {
  const db = createDb(c.env.DB);
  const o = await open(c, db);
  if ("error" in o) return c.json(o.error, o.status);
  return c.json({ data: await buildDetail(db, o.meId, o.subject, o.access) });
});

// ---- チーム案のタイトル・考えたいこと ----
collabWorkspaceRoutes.patch("/draft/:id", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveMe(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const resolved = await resolveSubject(db, "draft", c.req.param("id"), meId);
  if (!resolved) return c.json(err("not_found", "チーム案が見つかりません"), 404);
  const b = await c.req.json<{ title?: string; goal?: string }>().catch(() => ({} as { title?: string; goal?: string }));
  const patch: Partial<typeof schema.teamDrafts.$inferInsert> = {};
  if (b.title !== undefined) {
    const title = b.title.trim();
    if (!title) return c.json(err("invalid_input", "チーム案のタイトルを入力してください"), 400);
    if (title.length > TITLE_MAX) return c.json(err("invalid_input", `タイトルは${TITLE_MAX}文字以内で入力してください`), 400);
    patch.title = title;
  }
  if (b.goal !== undefined) {
    const goal = b.goal.trim();
    if (goal.length > TEXT_MAX) return c.json(err("invalid_input", `考えたいことは${TEXT_MAX}文字以内で入力してください`), 400);
    patch.goal = goal;
  }
  await db.update(schema.teamDrafts).set({ ...patch, updatedAt: nowSec() }).where(eq(schema.teamDrafts.id, resolved.subject.id));
  const again = (await resolveSubject(db, "draft", resolved.subject.id, meId))!;
  return c.json({ data: await buildDetail(db, meId, again.subject, again.access) });
});

// ---- プロフィールの編集（リーダー） ----
collabWorkspaceRoutes.put("/:type/:id/profile", async (c) => {
  const db = createDb(c.env.DB);
  const o = await open(c, db);
  if ("error" in o) return c.json(o.error, o.status);
  const denied = needLeader(o.access);
  if (denied) return c.json(denied, 403);
  const b = await c.req.json<{ businessTitle?: string; summary?: string; targetCustomers?: string; goal?: string; firstSteps?: unknown }>().catch(() => ({} as Record<string, unknown>));
  const patch: Parameters<typeof saveProfile>[3] = {};
  const txt = (v: unknown, label: string, max: number): string | { error: string } | undefined => {
    if (v === undefined) return undefined;
    if (typeof v !== "string") return { error: `${label}の形式が正しくありません` };
    const t = v.trim();
    return t.length > max ? { error: `${label}は${max}文字以内で入力してください` } : t;
  };
  for (const [field, label, max] of [["businessTitle", "協働事業のタイトル", 100], ["summary", "概要", TEXT_MAX], ["targetCustomers", "対象のお客様", TEXT_MAX]] as const) {
    const r = txt((b as Record<string, unknown>)[field], label, max);
    if (typeof r === "object") return c.json(err("invalid_input", r.error), 400);
    if (r !== undefined) patch[field] = r;
  }
  if (b.goal !== undefined) {
    const r = txt(b.goal, "考えたいこと", TEXT_MAX);
    if (typeof r === "object") return c.json(err("invalid_input", r.error), 400);
    if (r !== undefined) {
      if (o.subject.type === "draft") await db.update(schema.teamDrafts).set({ goal: r, updatedAt: nowSec() }).where(eq(schema.teamDrafts.id, o.subject.id));
      else patch.goal = r;
    }
  }
  if (b.firstSteps !== undefined) {
    if (!Array.isArray(b.firstSteps)) return c.json(err("invalid_input", "最初の一歩の形式が正しくありません"), 400);
    patch.firstStepsJson = JSON.stringify(b.firstSteps.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim().slice(0, 200)).slice(0, 5));
  }
  // 事業内容・最初の一歩を編集したら、仮の内容（確認待ち）ではなくなる（「考えたいこと」だけの編集では、確認したことにしない）
  const touchedContent = patch.businessTitle !== undefined || patch.summary !== undefined || patch.targetCustomers !== undefined || patch.firstStepsJson !== undefined;
  const saved = await saveProfile(db, o.subject.type, o.subject.id, touchedContent ? { ...patch, isProvisional: 0, confirmedAt: nowSec() } : patch, o.meId);
  if (o.subject.type === "team" && isProfileComplete(saved)) await addMilestone(db, o.subject.id, "profile_completed");
  return c.json({ data: await buildDetail(db, o.meId, o.subject, o.access) });
});

collabWorkspaceRoutes.post("/:type/:id/profile/confirm", async (c) => {
  const db = createDb(c.env.DB);
  const o = await open(c, db);
  if ("error" in o) return c.json(o.error, o.status);
  const denied = needLeader(o.access);
  if (denied) return c.json(denied, 403);
  const saved = await saveProfile(db, o.subject.type, o.subject.id, { isProvisional: 0, confirmedAt: nowSec() }, o.meId);
  if (o.subject.type === "team" && isProfileComplete(saved)) await addMilestone(db, o.subject.id, "profile_completed");
  return c.json({ data: await buildDetail(db, o.meId, o.subject, o.access) });
});

// ---- 役割の編集 ----
collabWorkspaceRoutes.put("/:type/:id/roles", async (c) => {
  const db = createDb(c.env.DB);
  const o = await open(c, db);
  if ("error" in o) return c.json(o.error, o.status);
  if (!o.access.isActive) return c.json(err("forbidden", "このチームの参加中のメンバーだけが編集できます"), 403);
  const b = await c.req.json<{ key?: string; role?: string }>().catch(() => ({} as { key?: string; role?: string }));
  const key = typeof b.key === "string" ? b.key : "";
  const role = typeof b.role === "string" ? b.role.trim() : "";
  if (role.length > 200) return c.json(err("invalid_input", "役割は200文字以内で入力してください"), 400);
  const roster = await loadRoster(db, o.subject, o.access, o.meId);
  if (!roster.nameByKey.has(key)) return c.json(err("not_found", "この役割の対象が見つかりません"), 404);

  // 自分の役割、またはリーダーによる編集は、そのまま反映する。リーダー以外が他の人の役割を変えるときは、リーダーの承認待ちの提案にする
  if (o.access.isLeader || key === `m:${o.meId}`) {
    await setRole(db, o.subject, key, role, o.meId);
    // 同じ対象への、承認待ちの提案は、直接の編集で置き換わったものとして閉じる
    if (o.subject.type === "team") {
      await db.update(schema.teamRoleRequests).set({ status: "rejected", decidedBy: o.meId, decidedAt: nowSec() })
        .where(and(eq(schema.teamRoleRequests.teamId, o.subject.id), eq(schema.teamRoleRequests.targetKey, key), eq(schema.teamRoleRequests.status, "pending")));
    }
    return c.json({ data: await buildDetail(db, o.meId, o.subject, o.access), pending: false });
  }
  if (!role) return c.json(err("invalid_input", "役割を入力してください"), 400);
  await db.update(schema.teamRoleRequests).set({ status: "rejected", decidedBy: o.meId, decidedAt: nowSec() })
    .where(and(eq(schema.teamRoleRequests.teamId, o.subject.id), eq(schema.teamRoleRequests.targetKey, key), eq(schema.teamRoleRequests.requestedBy, o.meId), eq(schema.teamRoleRequests.status, "pending")));
  await db.insert(schema.teamRoleRequests).values({ id: newId(), teamId: o.subject.id, targetKey: key, requestedBy: o.meId, proposedRole: role, status: "pending", createdAt: nowSec() });
  return c.json({ data: await buildDetail(db, o.meId, o.subject, o.access), pending: true });
});

collabWorkspaceRoutes.post("/team/:id/role-requests/:rid/:decision", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveMe(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const resolved = await resolveSubject(db, "team", c.req.param("id"), meId);
  if (!resolved) return c.json(err("not_found", "チームが見つかりません"), 404);
  const denied = needLeader(resolved.access);
  if (denied) return c.json(denied, 403);
  const decision = c.req.param("decision");
  if (decision !== "approve" && decision !== "reject") return c.json(err("not_found", "見つかりません"), 404);
  const req = await db.select().from(schema.teamRoleRequests)
    .where(and(eq(schema.teamRoleRequests.id, c.req.param("rid")), eq(schema.teamRoleRequests.teamId, resolved.subject.id), eq(schema.teamRoleRequests.status, "pending"))).get();
  if (!req) return c.json(err("not_found", "承認待ちの提案が見つかりません"), 404);
  if (decision === "approve") await setRole(db, resolved.subject, req.targetKey, req.proposedRole, meId);
  await db.update(schema.teamRoleRequests).set({ status: decision === "approve" ? "approved" : "rejected", decidedBy: meId, decidedAt: nowSec() }).where(eq(schema.teamRoleRequests.id, req.id));
  return c.json({ data: await buildDetail(db, meId, resolved.subject, resolved.access) });
});

// ---- 候補・募集人材 ----
async function peopleRoom(db: Db, subject: Subject, access: Access, meId: string): Promise<number> {
  const roster = await loadRoster(db, subject, access, meId);
  const used = subject.type === "draft" ? roster.members.length + roster.prospects.length : roster.prospects.length;
  return MAX_PEOPLE - used;
}

collabWorkspaceRoutes.post("/:type/:id/prospects", async (c) => {
  const db = createDb(c.env.DB);
  const o = await open(c, db);
  if ("error" in o) return c.json(o.error, o.status);
  const denied = needLeader(o.access);
  if (denied) return c.json(denied, 403);
  const b = await c.req.json<{ memberIds?: unknown; contactIds?: unknown; talent?: { title?: string; profile?: string; reason?: string } }>().catch(() => ({} as { memberIds?: unknown }));
  const uniq = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && x.length > 0))];
  const memberIds = uniq((b as { memberIds?: unknown }).memberIds);
  const contactIds = uniq((b as { contactIds?: unknown }).contactIds);
  const talent = (b as { talent?: { title?: string; profile?: string; reason?: string } }).talent;
  const roster = await loadRoster(db, o.subject, o.access, o.meId);
  const room = await peopleRoom(db, o.subject, o.access, o.meId);
  if (memberIds.length + contactIds.length + (talent ? 1 : 0) > room) {
    return c.json(err("invalid_input", o.subject.type === "draft" ? `チーム案は、自分を含めて最大${MAX_PEOPLE}名までです` : `候補と募集人材は、合わせて最大${MAX_PEOPLE}名までです`), 400);
  }
  const now = nowSec();
  const taken = new Set([...roster.members.map((m) => m.key), ...roster.prospects.map((p) => p.key)]);

  if (memberIds.length > 0) {
    const ok = await db.select({ id: schema.members.id }).from(schema.members).where(and(inArray(schema.members.id, memberIds), eq(schema.members.status, "active"))).all();
    if (ok.length !== memberIds.length) return c.json(err("invalid_input", "選べないメンバーが含まれています。画面を開き直して、選び直してください"), 400);
  }
  if (contactIds.length > 0) {
    const ok = await db.select({ id: schema.externalContacts.id }).from(schema.externalContacts)
      .where(and(inArray(schema.externalContacts.id, contactIds), eq(schema.externalContacts.ownerMemberId, o.meId))).all();
    if (ok.length !== contactIds.length) return c.json(err("invalid_input", "選べない外部人脈が含まれています。自分が登録した外部人脈から選んでください"), 400);
  }
  const rows = [
    ...memberIds.filter((id) => !taken.has(`m:${id}`)).map((id) => ({ kind: "member" as const, refId: id, ownerMemberId: null as string | null })),
    ...contactIds.filter((id) => !taken.has(`c:${id}`)).map((id) => ({ kind: "contact" as const, refId: id, ownerMemberId: o.meId as string | null })),
  ];
  for (const r of rows) {
    await db.insert(schema.teamProspects).values({ id: newId(), subjectType: o.subject.type, subjectId: o.subject.id, kind: r.kind, refId: r.refId, ownerMemberId: r.ownerMemberId, locked: 0, published: 0, addedBy: o.meId, createdAt: now }).onConflictDoNothing();
  }
  if (talent) {
    const title = (talent.title ?? "").trim();
    if (!title) return c.json(err("invalid_input", "募集したい人材の業種・職種を入力してください"), 400);
    await db.insert(schema.teamProspects).values({
      id: newId(), subjectType: o.subject.type, subjectId: o.subject.id, kind: "talent", refId: null, locked: 0,
      talentTitle: title.slice(0, 100), talentProfile: (talent.profile ?? "").trim().slice(0, TEXT_MAX), talentReason: (talent.reason ?? "").trim().slice(0, TEXT_MAX), published: 0, addedBy: o.meId, createdAt: now,
    });
  }
  return c.json({ data: await buildDetail(db, o.meId, o.subject, o.access) }, 201);
});

collabWorkspaceRoutes.patch("/:type/:id/prospects/:pid", async (c) => {
  const db = createDb(c.env.DB);
  const o = await open(c, db);
  if ("error" in o) return c.json(o.error, o.status);
  const denied = needLeader(o.access);
  if (denied) return c.json(denied, 403);
  const pr = await db.select().from(schema.teamProspects)
    .where(and(eq(schema.teamProspects.id, c.req.param("pid")), eq(schema.teamProspects.subjectType, o.subject.type), eq(schema.teamProspects.subjectId, o.subject.id))).get();
  if (!pr) return c.json(err("not_found", "見つかりません"), 404);
  type ProspectPatch = { locked?: boolean; published?: boolean; title?: string; profile?: string; reason?: string };
  const b = await c.req.json<ProspectPatch>().catch(() => ({} as ProspectPatch));
  const patch: Partial<typeof schema.teamProspects.$inferInsert> = {};
  if (typeof b.locked === "boolean") patch.locked = b.locked ? 1 : 0;
  if (pr.kind === "talent") {
    if (typeof b.published === "boolean") {
      if (o.subject.type === "draft" && b.published) return c.json(err("invalid_input", "募集として公開できるのは、緩いチーム・パワーチームになってからです"), 400);
      patch.published = b.published ? 1 : 0;
    }
    if (b.title !== undefined) { const t = b.title.trim(); if (!t) return c.json(err("invalid_input", "業種・職種を入力してください"), 400); patch.talentTitle = t.slice(0, 100); }
    if (b.profile !== undefined) patch.talentProfile = b.profile.trim().slice(0, TEXT_MAX);
    if (b.reason !== undefined) patch.talentReason = b.reason.trim().slice(0, TEXT_MAX);
  }
  if (Object.keys(patch).length > 0) await db.update(schema.teamProspects).set(patch).where(eq(schema.teamProspects.id, pr.id));
  return c.json({ data: await buildDetail(db, o.meId, o.subject, o.access) });
});

collabWorkspaceRoutes.delete("/:type/:id/prospects/:pid", async (c) => {
  const db = createDb(c.env.DB);
  const o = await open(c, db);
  if ("error" in o) return c.json(o.error, o.status);
  const denied = needLeader(o.access);
  if (denied) return c.json(denied, 403);
  const pr = await db.select().from(schema.teamProspects)
    .where(and(eq(schema.teamProspects.id, c.req.param("pid")), eq(schema.teamProspects.subjectType, o.subject.type), eq(schema.teamProspects.subjectId, o.subject.id))).get();
  if (!pr) return c.json(err("not_found", "見つかりません"), 404);
  await db.delete(schema.teamProspects).where(eq(schema.teamProspects.id, pr.id));
  const key = pr.kind === "talent" ? `t:${pr.id}` : pr.kind === "member" ? `m:${pr.refId}` : `c:${pr.refId}`;
  await setRole(db, o.subject, key, "", o.meId);
  return c.json({ data: await buildDetail(db, o.meId, o.subject, o.access) });
});

// ---- 候補に声をかける（招待） ----
collabWorkspaceRoutes.post("/team/:id/prospects/:pid/invite", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveMe(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const resolved = await resolveSubject(db, "team", c.req.param("id"), meId);
  if (!resolved) return c.json(err("not_found", "チームが見つかりません"), 404);
  const denied = needLeader(resolved.access);
  if (denied) return c.json(denied, 403);
  const pr = await db.select().from(schema.teamProspects)
    .where(and(eq(schema.teamProspects.id, c.req.param("pid")), eq(schema.teamProspects.subjectType, "team"), eq(schema.teamProspects.subjectId, resolved.subject.id), eq(schema.teamProspects.kind, "member"))).get();
  if (!pr?.refId) return c.json(err("not_found", "声をかけられる候補が見つかりません"), 404);

  const now = nowSec();
  const existing = await db.select().from(schema.collabTeamMembers)
    .where(and(eq(schema.collabTeamMembers.teamId, resolved.subject.id), eq(schema.collabTeamMembers.memberId, pr.refId))).get();
  if (existing && (existing.status === "active" || existing.status === "pending")) {
    await db.delete(schema.teamProspects).where(eq(schema.teamProspects.id, pr.id));
    return c.json({ data: await buildDetail(db, meId, resolved.subject, resolved.access) });
  }
  if (existing) {
    await db.update(schema.collabTeamMembers).set({ status: "pending", invitedBy: meId, respondedAt: null, createdAt: now }).where(eq(schema.collabTeamMembers.id, existing.id));
  } else {
    await db.insert(schema.collabTeamMembers).values({ id: newId(), teamId: resolved.subject.id, memberId: pr.refId, status: "pending", invitedBy: meId, respondedAt: null, createdAt: now });
  }
  // 招待したので、候補ではなくなる（役割のキーは同じなので、そのまま引き継がれる）
  await db.delete(schema.teamProspects).where(eq(schema.teamProspects.id, pr.id));
  try {
    const [inviter, invitee] = await Promise.all([
      db.select({ name: schema.members.name }).from(schema.members).where(eq(schema.members.id, meId)).get(),
      db.select({ email: schema.members.email, name: schema.members.name }).from(schema.members).where(eq(schema.members.id, pr.refId)).get(),
    ]);
    if (invitee?.email) {
      await new MailService(db, c.env).send("collab_team_invite", invitee.email, {
        inviteeName: invitee.name, inviterName: inviter?.name ?? "メンバー", teamName: resolved.subject.title,
        teamTypeLabel: resolved.subject.stage === "power" ? "パワーチーム" : "緩いチーム",
      });
    }
  } catch (e) {
    console.error("[collab-workspace] 招待メール送信失敗", e);
  }
  return c.json({ data: await buildDetail(db, meId, resolved.subject, resolved.access) });
});

// ---- 公開された募集人材への「興味あり」 ----
collabWorkspaceRoutes.post("/team/:id/prospects/:pid/interest", async (c) => {
  const db = createDb(c.env.DB);
  const meId = await resolveMe(c, db);
  if (!meId) return c.json(err("forbidden", "メンバーとしての承認後にご利用いただけます"), 403);
  const resolved = await resolveSubject(db, "team", c.req.param("id"), meId);
  if (!resolved) return c.json(err("not_found", "チームが見つかりません"), 404);
  const pr = await db.select().from(schema.teamProspects)
    .where(and(eq(schema.teamProspects.id, c.req.param("pid")), eq(schema.teamProspects.subjectType, "team"), eq(schema.teamProspects.subjectId, resolved.subject.id), eq(schema.teamProspects.kind, "talent"))).get();
  if (!pr || pr.published !== 1 || pr.filledByMemberId) return c.json(err("not_found", "この募集は、すでに終了しています"), 404);
  const existing = await db.select().from(schema.collabTeamMembers)
    .where(and(eq(schema.collabTeamMembers.teamId, resolved.subject.id), eq(schema.collabTeamMembers.memberId, meId))).get();
  if (existing?.status === "active") return c.json(err("invalid_input", "すでにこのチームに参加しています"), 400);
  if (existing?.status === "pending") return c.json(err("invalid_input", "すでに参加希望を出しているか、招待が届いています"), 400);
  const now = nowSec();
  if (existing) {
    await db.update(schema.collabTeamMembers).set({ status: "pending", invitedBy: null, respondedAt: null, prospectId: pr.id, createdAt: now }).where(eq(schema.collabTeamMembers.id, existing.id));
  } else {
    await db.insert(schema.collabTeamMembers).values({ id: newId(), teamId: resolved.subject.id, memberId: meId, status: "pending", invitedBy: null, respondedAt: null, prospectId: pr.id, createdAt: now });
  }
  return c.json({ ok: true });
});

// ---- AIによる再検討（参加中のメンバーなら誰でも） ----
collabWorkspaceRoutes.post("/:type/:id/proposals", async (c) => {
  const db = createDb(c.env.DB);
  const o = await open(c, db);
  if ("error" in o) return c.json(o.error, o.status);
  if (!o.access.isActive) return c.json(err("forbidden", "このチームの参加中のメンバーだけが実行できます"), 403);
  const body = await c.req.json<{ perspectives?: unknown; note?: unknown }>().catch(() => ({} as { perspectives?: unknown; note?: unknown }));
  const perspectives = REGENERATE_PERSPECTIVES.filter((p) => Array.isArray(body.perspectives) && (body.perspectives as unknown[]).includes(p)) as RegeneratePerspective[];
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > REGENERATE_NOTE_MAX) return c.json(err("invalid_input", `さらに伝えたい観点は${REGENERATE_NOTE_MAX}文字以内で入力してください`), 400);

  const dayAgo = nowSec() - 86400;
  const today = await db.select({ id: schema.teamProfileProposals.id }).from(schema.teamProfileProposals)
    .where(and(eq(schema.teamProfileProposals.subjectType, o.subject.type), eq(schema.teamProfileProposals.subjectId, o.subject.id), gte(schema.teamProfileProposals.createdAt, dayAgo))).all();
  if (today.length >= DAILY_AI_RUNS) return c.json(err("rate_limited", `AIによる再検討は、1つのチームで1日${DAILY_AI_RUNS}回までです。明日またお試しください`), 429);

  const roster = await loadRoster(db, o.subject, o.access, o.meId);
  const people = await buildAiPeople(db, o.subject, roster);
  if (people.length < 2) return c.json(err("invalid_input", "メンバーのほかに、候補または募集人材を1つ以上入れると、再検討できます"), 400);
  const profile = await getProfile(db, o.subject.type, o.subject.id);

  const used = o.subject.type === "draft" ? roster.members.length + roster.prospects.length : roster.prospects.length;
  const room = Math.max(0, MAX_PEOPLE - used);
  const wantSuggest = perspectives.includes("suggest_members") && room > 0;
  const candidates = wantSuggest ? await loadSuggestionPool(db, o.meId, new Set(people.map((p) => p.key))) : [];

  const ideas = await generateTeamDraftIdeas({
    apiKey: c.env.ANTHROPIC_API_KEY, isDev: c.env.ENVIRONMENT === "development", title: o.subject.title,
    goal: o.subject.type === "draft" ? o.subject.goal : profile?.goal ?? "", people,
    regenerate: { perspectives, note, previous: profileAsPrevious(profile, roster), candidates, maxSuggest: Math.min(3, room) },
    maxTalents: room,
  });
  if (!ideas) return c.json(err("ai_failed", "AIで再検討できませんでした。少し時間をおいて、もう一度お試しください"), 502);

  await db.insert(schema.teamProfileProposals).values({
    id: newId(), subjectType: o.subject.type, subjectId: o.subject.id, createdBy: o.meId, perspectivesJson: JSON.stringify(perspectives), note,
    proposalJson: JSON.stringify(ideas), appliedJson: "{}", status: "open", baseUpdatedAt: profile?.updatedAt ?? 0, createdAt: nowSec(),
  });
  return c.json({ data: await buildDetail(db, o.meId, o.subject, o.access) }, 201);
});

collabWorkspaceRoutes.post("/:type/:id/proposals/:pid/apply", async (c) => {
  const db = createDb(c.env.DB);
  const o = await open(c, db);
  if ("error" in o) return c.json(o.error, o.status);
  const denied = needLeader(o.access);
  if (denied) return c.json(denied, 403);
  const row = await db.select().from(schema.teamProfileProposals)
    .where(and(eq(schema.teamProfileProposals.id, c.req.param("pid")), eq(schema.teamProfileProposals.subjectType, o.subject.type), eq(schema.teamProfileProposals.subjectId, o.subject.id))).get();
  if (!row) return c.json(err("not_found", "提案が見つかりません"), 404);
  if (row.status !== "open") return c.json(err("invalid_input", "この提案は、すでに閉じています"), 400);
  const sel = await c.req.json<ApplySelection>().catch(() => ({} as ApplySelection));
  let ideas: TeamDraftIdeas;
  try { ideas = JSON.parse(row.proposalJson) as TeamDraftIdeas; } catch { return c.json(err("invalid_input", "提案の内容を読み込めませんでした"), 400); }

  const before = parseApplied(row.appliedJson);
  const { applied, error } = await applyProposal(db, o.subject, ideas, before, sel, o.meId);
  const closed = remainingItems(ideas, applied) === 0;
  await db.update(schema.teamProfileProposals).set({ appliedJson: JSON.stringify(applied), status: closed ? "closed" : "open" }).where(eq(schema.teamProfileProposals.id, row.id));
  const profile = await getProfile(db, o.subject.type, o.subject.id);
  if (o.subject.type === "team" && isProfileComplete(profile)) await addMilestone(db, o.subject.id, "profile_completed");
  return c.json({ data: await buildDetail(db, o.meId, o.subject, o.access), warning: error ?? null });
});

collabWorkspaceRoutes.post("/:type/:id/proposals/:pid/discard", async (c) => {
  const db = createDb(c.env.DB);
  const o = await open(c, db);
  if ("error" in o) return c.json(o.error, o.status);
  const denied = needLeader(o.access);
  if (denied) return c.json(denied, 403);
  const row = await db.select().from(schema.teamProfileProposals)
    .where(and(eq(schema.teamProfileProposals.id, c.req.param("pid")), eq(schema.teamProfileProposals.subjectType, o.subject.type), eq(schema.teamProfileProposals.subjectId, o.subject.id))).get();
  if (!row) return c.json(err("not_found", "提案が見つかりません"), 404);
  const applied = { ...parseApplied(row.appliedJson), discarded: true };
  await db.update(schema.teamProfileProposals).set({ appliedJson: JSON.stringify(applied), status: "closed" }).where(eq(schema.teamProfileProposals.id, row.id));
  return c.json({ data: await buildDetail(db, o.meId, o.subject, o.access) });
});
