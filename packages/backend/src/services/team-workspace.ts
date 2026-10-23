// =============================================================
// チーム育成（チーム案・緩いチーム・パワーチーム共通）の中核ロジック
//   ・対象（チーム案 or 正式なチーム）の解決と、権限の判定
//   ・チームプロフィール（事業・概要・お客様像・最初の一歩・役割）
//   ・メンバー（参加中）と、候補・募集人材（prospects）の一覧。外部人脈は、登録者以外には名前・社名・備考を出さない
//   ・AIに渡す参加者の組み立て（外部人脈は本名・社名を渡さず、「外部人脈の候補A」のような呼び名にする）
//   ・AIの提案を、情報ごとに選んで反映する処理
//   ・チームの歩み（milestones）と元気度
// 仕様：docs/追加機能仕様_チーム育成.md
// =============================================================
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { newId } from "./auth.ts";
import { computeStalled } from "./collab-stage.ts";
import { loadProfiles, type Profile } from "./member-collab.ts";
import type { DraftParticipant, TeamDraftIdeas } from "./team-draft-ideas.ts";

export type SubjectType = "draft" | "team";
export type Stage = "draft" | "loose" | "power";

/** チーム案は自分を含めて10名まで。正式なチームの候補＋募集人材は合わせて10名まで */
export const MAX_PEOPLE = 10;
/** AIによる再検討の、チームごとの1日あたりの上限 */
export const DAILY_AI_RUNS = 5;
export const PROPOSAL_HISTORY = 10;

export type Subject = {
  type: SubjectType;
  id: string;
  title: string;
  goal: string;
  stage: Stage;
  archived: boolean;
  leaderId: string;
  createdAt: number;
};
export type Access = {
  /** 参加中（チーム案では作成者） */
  isActive: boolean;
  /** 招待中（承諾の返事待ち） */
  isPending: boolean;
  /** リーダー（チーム案では作成者）。リーダーが退会している場合は、参加中のメンバーなら誰でも */
  isLeader: boolean;
  leaderGone: boolean;
};

const nowSec = () => Math.floor(Date.now() / 1000);

// ---- 対象の解決と権限 ----

/** チーム案（作成者のみ）または正式なチームを解決する。見つからない・見られないときは null */
export async function resolveSubject(db: Db, type: SubjectType, id: string, meId: string): Promise<{ subject: Subject; access: Access } | null> {
  if (type === "draft") {
    const d = await db.select().from(schema.teamDrafts).where(and(eq(schema.teamDrafts.id, id), eq(schema.teamDrafts.ownerMemberId, meId))).get();
    if (!d) return null;
    return {
      subject: { type, id, title: d.title, goal: d.goal, stage: "draft", archived: false, leaderId: meId, createdAt: d.createdAt },
      access: { isActive: true, isPending: false, isLeader: true, leaderGone: false },
    };
  }
  const t = await db.select().from(schema.collabTeams).where(eq(schema.collabTeams.id, id)).get();
  if (!t) return null;
  const [mine, leader] = await Promise.all([
    db.select().from(schema.collabTeamMembers).where(and(eq(schema.collabTeamMembers.teamId, id), eq(schema.collabTeamMembers.memberId, meId))).get(),
    db.select({ status: schema.members.status }).from(schema.members).where(eq(schema.members.id, t.createdBy)).get(),
  ]);
  const leaderGone = !leader || leader.status === "deleted";
  const isActive = mine?.status === "active";
  return {
    subject: { type, id, title: t.name, goal: "", stage: t.type === "power" ? "power" : "loose", archived: t.archived === 1, leaderId: t.createdBy, createdAt: t.createdAt },
    access: { isActive, isPending: mine?.status === "pending", isLeader: meId === t.createdBy || (leaderGone && isActive), leaderGone },
  };
}

// ---- プロフィール ----

export type ProfileRow = typeof schema.teamProfiles.$inferSelect;

export async function getProfile(db: Db, type: SubjectType, id: string): Promise<ProfileRow | null> {
  return (await db.select().from(schema.teamProfiles)
    .where(and(eq(schema.teamProfiles.subjectType, type), eq(schema.teamProfiles.subjectId, id))).get()) ?? null;
}

export function parseRoles(raw: string | null | undefined): Record<string, string> {
  try {
    const v: unknown = JSON.parse(raw || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, r]) => typeof r === "string" && r.trim() !== "").map(([k, r]) => [k, (r as string).trim()]));
  } catch { return {}; }
}
export function parseSteps(raw: string | null | undefined): string[] {
  try {
    const v: unknown = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];
  } catch { return []; }
}

/** 入力済みの基準：事業名・概要・お客様像の3つがすべて空でなく、仮の内容（確認待ち）でもないこと */
export function isProfileComplete(p: Pick<ProfileRow, "businessTitle" | "summary" | "targetCustomers" | "isProvisional"> | null): boolean {
  return !!p && !p.isProvisional && p.businessTitle.trim() !== "" && p.summary.trim() !== "" && p.targetCustomers.trim() !== "";
}
export function hasProfileContent(p: Pick<ProfileRow, "businessTitle" | "summary" | "targetCustomers"> | null): boolean {
  return !!p && p.businessTitle.trim() !== "" && p.summary.trim() !== "" && p.targetCustomers.trim() !== "";
}

/** プロフィールを更新する（なければ作る）。プロフィールを編集・確認したら、仮の内容ではなくなる */
export async function saveProfile(
  db: Db, type: SubjectType, id: string, patch: Partial<Pick<ProfileRow, "businessTitle" | "summary" | "targetCustomers" | "goal" | "firstStepsJson" | "rolesJson" | "isProvisional" | "backfillStatus" | "backfillAt" | "confirmedAt">>, updatedBy: string | null,
): Promise<ProfileRow> {
  const now = nowSec();
  const existing = await getProfile(db, type, id);
  if (!existing) {
    await db.insert(schema.teamProfiles).values({ id: newId(), subjectType: type, subjectId: id, ...patch, updatedBy, createdAt: now, updatedAt: now });
  } else {
    await db.update(schema.teamProfiles).set({ ...patch, updatedBy, updatedAt: now }).where(eq(schema.teamProfiles.id, existing.id));
  }
  return (await getProfile(db, type, id))!;
}

// ---- 歩み・元気度 ----

export type MilestoneType = "formed" | "profile_completed" | "promoted" | "talent_filled" | "first_action_done";
export const MILESTONE_LABEL: Record<MilestoneType, string> = {
  formed: "チームを結成",
  profile_completed: "チームプロフィールが完成",
  promoted: "パワーチームに昇格",
  talent_filled: "募集していた人材が加わった",
  first_action_done: "初めてのアクションを完了",
};
/** 1度だけ記録する歩み（同じ種類がすでにあれば記録しない） */
const ONCE: MilestoneType[] = ["formed", "profile_completed", "promoted", "first_action_done"];

export async function addMilestone(db: Db, teamId: string, type: MilestoneType, refId?: string | null): Promise<void> {
  try {
    // チーム案（まだ正式なチームではない）には、歩みを記録しない
    const team = await db.select({ id: schema.collabTeams.id }).from(schema.collabTeams).where(eq(schema.collabTeams.id, teamId)).get();
    if (!team) return;
    if (ONCE.includes(type)) {
      const had = await db.select({ id: schema.teamMilestones.id }).from(schema.teamMilestones)
        .where(and(eq(schema.teamMilestones.teamId, teamId), eq(schema.teamMilestones.type, type))).get();
      if (had) return;
    }
    await db.insert(schema.teamMilestones).values({ id: newId(), teamId, type, refId: refId ?? null, createdAt: nowSec() });
  } catch (e) {
    console.error("[team-workspace] 歩みの記録に失敗", e);
  }
}

export type Health = { status: "active" | "rest" | "follow"; lastActivityAt: number };

/** チームの最終の活動（投稿・会議・アクションの追加／完了・プロフィールの更新・歩み）から、元気度を求める */
export async function computeHealth(db: Db, teamId: string, createdAt: number): Promise<Health> {
  const [post, meeting, action, profile, milestone] = await Promise.all([
    db.select({ at: sql<number>`max(${schema.collaborationPosts.createdAt})` }).from(schema.collaborationPosts)
      .where(and(eq(schema.collaborationPosts.teamId, teamId), sql`${schema.collaborationPosts.deletedAt} IS NULL`)).get(),
    db.select({ at: sql<number>`max(${schema.meetings.createdAt})` }).from(schema.meetings).where(eq(schema.meetings.collabTeamId, teamId)).get(),
    db.select({ at: sql<number>`max(max(${schema.collabTeamActionItems.createdAt}, coalesce(${schema.collabTeamActionItems.completedAt}, 0)))` }).from(schema.collabTeamActionItems)
      .where(eq(schema.collabTeamActionItems.teamId, teamId)).get(),
    db.select({ at: schema.teamProfiles.updatedAt, p: schema.teamProfiles.isProvisional }).from(schema.teamProfiles)
      .where(and(eq(schema.teamProfiles.subjectType, "team"), eq(schema.teamProfiles.subjectId, teamId))).get(),
    db.select({ at: sql<number>`max(${schema.teamMilestones.createdAt})` }).from(schema.teamMilestones).where(eq(schema.teamMilestones.teamId, teamId)).get(),
  ]);
  const last = Math.max(createdAt, post?.at ?? 0, meeting?.at ?? 0, action?.at ?? 0, profile && !profile.p ? profile.at : 0, milestone?.at ?? 0);
  const s = computeStalled(last, nowSec());
  return { status: s === "active" ? "active" : s === "stalled" ? "rest" : "follow", lastActivityAt: last };
}

// ---- メンバー・候補・募集人材の一覧 ----

export type RosterMember = {
  key: string; id: string; name: string; emoji: string; bgColor: string; avatarImageKey: string | null; headline: string;
  status: "active" | "pending"; joinRequest: boolean; isLeader: boolean; isMe: boolean; role: string | null; prospectId: string | null;
};
export type RosterProspect = {
  key: string; prospectId: string; kind: "member" | "contact" | "talent";
  locked: boolean; role: string | null; published: boolean; filled: boolean; filledByName: string | null;
  // メンバー
  memberId?: string; name?: string | null; emoji?: string; bgColor?: string; avatarImageKey?: string | null; headline?: string;
  // 外部人脈：登録者本人には名前・社名も出す。それ以外には、名前・社名・備考を出さず、専門分野・事業の概要・関係性だけを出す
  isOwnerView?: boolean; company?: string | null; specialty?: string | null; summary?: string | null; relationships?: string[];
  // 募集人材
  title?: string; profile?: string; reason?: string;
};

export type Roster = {
  members: RosterMember[];
  prospects: RosterProspect[];
  /** 全員のキー（役割の編集先として有効なもの）→ 表示名 */
  nameByKey: Map<string, string>;
};

type MemberInfo = { id: string; name: string; emoji: string; bgColor: string; avatarImageKey: string | null; category: string; status: string };

async function loadMemberInfos(db: Db, ids: string[]): Promise<Map<string, MemberInfo>> {
  const out = new Map<string, MemberInfo>();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 80) {
    const rows = await db.select({
      id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor,
      avatarImageKey: schema.members.avatarImageKey, category: schema.members.category, status: schema.members.status,
    }).from(schema.members).where(inArray(schema.members.id, uniq.slice(i, i + 80))).all();
    for (const r of rows) out.set(r.id, r);
  }
  return out;
}

async function loadRelationships(db: Db, contactIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (let i = 0; i < contactIds.length; i += 80) {
    const rows = await db.select().from(schema.externalContactRelationships)
      .where(inArray(schema.externalContactRelationships.contactId, contactIds.slice(i, i + 80))).all();
    for (const r of rows) map.set(r.contactId, [...(map.get(r.contactId) ?? []), r.relationship]);
  }
  return map;
}

/**
 * メンバー（参加中・招待中）と、候補・募集人材の一覧。見る人に応じて絞り込む。
 *   ・参加中の人（チーム案では作成者）：すべて。ただし、他の人の「非公開」の外部人脈は出さない
 *   ・それ以外：公開した募集人材だけ
 */
export async function loadRoster(db: Db, subject: Subject, access: Access, meId: string): Promise<Roster> {
  const profile = await getProfile(db, subject.type, subject.id);
  const roles = parseRoles(profile?.rolesJson);
  const seeAll = access.isActive;

  // メンバー
  const rawMembers: { id: string; status: "active" | "pending"; invitedBy: string | null; prospectId: string | null }[] = [];
  if (subject.type === "draft") {
    rawMembers.push({ id: subject.leaderId, status: "active", invitedBy: null, prospectId: null });
  } else {
    const rows = await db.select().from(schema.collabTeamMembers)
      .where(and(eq(schema.collabTeamMembers.teamId, subject.id), ne(schema.collabTeamMembers.status, "declined")))
      .orderBy(schema.collabTeamMembers.createdAt).all();
    for (const r of rows) rawMembers.push({ id: r.memberId, status: r.status as "active" | "pending", invitedBy: r.invitedBy, prospectId: r.prospectId });
  }

  const prospectRows = await db.select().from(schema.teamProspects)
    .where(and(eq(schema.teamProspects.subjectType, subject.type), eq(schema.teamProspects.subjectId, subject.id)))
    .orderBy(schema.teamProspects.createdAt).all();

  const infos = await loadMemberInfos(db, [
    ...rawMembers.map((m) => m.id),
    ...prospectRows.filter((p) => p.kind === "member" && p.refId).map((p) => p.refId as string),
    ...prospectRows.filter((p) => p.filledByMemberId).map((p) => p.filledByMemberId as string),
  ]);
  const contactIds = prospectRows.filter((p) => p.kind === "contact" && p.refId).map((p) => p.refId as string);
  const contacts = new Map<string, typeof schema.externalContacts.$inferSelect>();
  for (let i = 0; i < contactIds.length; i += 80) {
    const rows = await db.select().from(schema.externalContacts).where(inArray(schema.externalContacts.id, contactIds.slice(i, i + 80))).all();
    for (const r of rows) contacts.set(r.id, r);
  }
  const rels = await loadRelationships(db, contactIds);

  const nameByKey = new Map<string, string>();
  const members: RosterMember[] = [];
  for (const m of rawMembers) {
    const info = infos.get(m.id);
    if (!info || info.status === "deleted") continue;
    const key = `m:${m.id}`;
    nameByKey.set(key, info.name);
    // 招待中の人は、自分の役割だけ見える
    const showRole = seeAll || m.id === meId;
    members.push({
      key, id: m.id, name: info.name, emoji: info.emoji, bgColor: info.bgColor, avatarImageKey: info.avatarImageKey, headline: info.category,
      status: m.status, joinRequest: m.status === "pending" && m.invitedBy === null, isLeader: m.id === subject.leaderId, isMe: m.id === meId,
      role: showRole ? roles[key] ?? null : null, prospectId: m.prospectId,
    });
  }

  const prospects: RosterProspect[] = [];
  for (const p of prospectRows) {
    const filled = !!p.filledByMemberId;
    if (p.kind === "talent") {
      const key = `t:${p.id}`;
      nameByKey.set(key, p.talentTitle ?? "募集人材");
      if (!seeAll && !(p.published === 1 && !filled)) continue;
      prospects.push({
        key, prospectId: p.id, kind: "talent", locked: p.locked === 1, role: seeAll ? roles[key] ?? null : null, published: p.published === 1,
        filled, filledByName: p.filledByMemberId ? infos.get(p.filledByMemberId)?.name ?? null : null,
        title: p.talentTitle ?? "", profile: p.talentProfile ?? "", reason: p.talentReason ?? "",
      });
      continue;
    }
    if (!seeAll) continue;
    if (p.kind === "member" && p.refId) {
      const info = infos.get(p.refId);
      if (!info || info.status !== "active") continue; // 退会・休会した人は出さない
      if (nameByKey.has(`m:${p.refId}`)) continue;     // すでに参加中・招待中の人は、候補としては出さない
      const key = `m:${p.refId}`;
      nameByKey.set(key, info.name);
      prospects.push({
        key, prospectId: p.id, kind: "member", locked: p.locked === 1, role: roles[key] ?? null, published: false, filled: false, filledByName: null,
        memberId: info.id, name: info.name, emoji: info.emoji, bgColor: info.bgColor, avatarImageKey: info.avatarImageKey, headline: info.category,
      });
    } else if (p.kind === "contact" && p.refId) {
      const ct = contacts.get(p.refId);
      if (!ct) continue;
      const mine = ct.ownerMemberId === meId;
      if (!mine && ct.visibility === "private") continue; // 非公開の人脈は、登録者以外には出さない
      const key = `c:${ct.id}`;
      nameByKey.set(key, mine ? ct.name : "外部人脈の候補");
      prospects.push({
        key, prospectId: p.id, kind: "contact", locked: p.locked === 1, role: roles[key] ?? null, published: false, filled: false, filledByName: null,
        isOwnerView: mine, name: mine ? ct.name : null, company: mine ? ct.company : null, specialty: ct.specialty,
        summary: ct.businessSummaryStatus === "done" ? ct.businessSummary : null, relationships: rels.get(ct.id) ?? [],
      });
    }
  }
  return { members, prospects, nameByKey };
}

// ---- AIに渡す参加者 ----

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function memberProfileText(p: Profile): string {
  return [
    p.category && `職種: ${p.category}`, p.businessDescription && `事業内容: ${p.businessDescription}`,
    p.skills.length > 0 && `USP: ${p.skills.map((s) => (s.description ? `${s.name}（${s.description}）` : s.name)).join(" ／ ")}`,
  ].filter(Boolean).join(" / ") || "（情報の登録なし）";
}

/** 外部人脈をAIに渡すときの情報。本名・社名・備考は渡さず、専門分野と事業の概要だけにする */
function contactProfileText(ct: typeof schema.externalContacts.$inferSelect): string {
  return [
    ct.specialty && `専門分野: ${ct.specialty}`,
    ct.businessSummaryStatus === "done" && ct.businessSummary && `事業概要: ${ct.businessSummary}`,
  ].filter(Boolean).join(" / ") || "（情報の登録なし）";
}

/**
 * AIに渡す参加者（参加中・候補・募集中の人材像）。実行した人が見られる範囲のものだけを渡す。
 * 外部人脈は、本名や社名を渡さず、「外部人脈の候補A（専門分野）」の呼び名にする（AIの提案はチーム全員が見るため）。
 */
export async function buildAiPeople(db: Db, subject: Subject, roster: Roster): Promise<DraftParticipant[]> {
  const people: DraftParticipant[] = [];
  const memberIds = [
    ...roster.members.map((m) => m.id),
    ...roster.prospects.filter((p) => p.kind === "member").map((p) => p.memberId as string),
  ];
  const profiles = new Map((await loadProfiles(db, memberIds)).map((p) => [p.id, p]));
  for (const m of roster.members) {
    const p = profiles.get(m.id);
    people.push({ key: m.key, kind: "member", name: m.name, profile: p ? memberProfileText(p) : "（情報の登録なし）", status: "active", locked: true });
  }
  // リーダーを先頭にする（チーム案では作成者）
  const leaderIdx = people.findIndex((p) => p.key === `m:${subject.leaderId}`);
  if (leaderIdx > 0) people.unshift(...people.splice(leaderIdx, 1));

  const contactIds = roster.prospects.filter((p) => p.kind === "contact").map((p) => p.key.slice(2));
  const contacts = new Map<string, typeof schema.externalContacts.$inferSelect>();
  for (let i = 0; i < contactIds.length; i += 80) {
    const rows = await db.select().from(schema.externalContacts).where(inArray(schema.externalContacts.id, contactIds.slice(i, i + 80))).all();
    for (const r of rows) contacts.set(r.id, r);
  }
  let letter = 0;
  for (const pr of roster.prospects) {
    if (pr.kind === "member") {
      const p = profiles.get(pr.memberId as string);
      people.push({ key: pr.key, kind: "member", name: pr.name ?? "", profile: p ? memberProfileText(p) : "（情報の登録なし）", status: "candidate", locked: pr.locked });
    } else if (pr.kind === "contact") {
      const ct = contacts.get(pr.key.slice(2));
      if (!ct) continue;
      people.push({
        key: pr.key, kind: "contact", name: `外部人脈の候補${LETTERS[letter++ % 26]}（${ct.specialty || "専門分野の登録なし"}）`,
        profile: contactProfileText(ct), status: "candidate", locked: pr.locked,
      });
    } else if (pr.filled === false) {
      people.push({
        key: pr.key, kind: "talent", name: pr.title ?? "募集人材",
        profile: [pr.profile && `人物像: ${pr.profile}`, pr.reason && `補えること: ${pr.reason}`].filter(Boolean).join(" / ") || "（人物像の登録なし）",
        status: "recruiting", locked: pr.locked,
      });
    }
  }
  return people;
}

/**
 * 「追加メンバーの提案」に使う候補（メンバーと、実行した人の外部人脈）。すでに参加者・候補の人は含めない。
 * 外部人脈は、AIに本名・社名を渡さない。
 */
export async function loadSuggestionPool(db: Db, runnerId: string, exclude: Set<string>): Promise<DraftParticipant[]> {
  const rows = await db.select({ id: schema.members.id }).from(schema.members).where(eq(schema.members.status, "active")).all();
  const ids = rows.map((r) => r.id).filter((id) => id !== runnerId && !exclude.has(`m:${id}`)).slice(0, 150);
  const profiles = await loadProfiles(db, ids);
  const members: DraftParticipant[] = profiles
    .filter((p) => p.category || p.businessDescription || p.skills.length > 0)
    .map((p) => ({ key: `m:${p.id}`, kind: "member" as const, name: p.name, profile: memberProfileText(p) }));
  const contacts = await db.select().from(schema.externalContacts).where(eq(schema.externalContacts.ownerMemberId, runnerId))
    .orderBy(desc(schema.externalContacts.createdAt)).limit(100).all();
  let letter = 0;
  const contactPeople: DraftParticipant[] = contacts.filter((ct) => !exclude.has(`c:${ct.id}`)).map((ct) => ({
    key: `c:${ct.id}`, kind: "contact" as const, name: `外部人脈の候補${LETTERS[letter++ % 26]}（${ct.specialty || "専門分野の登録なし"}）`, profile: contactProfileText(ct),
  }));
  return [...members, ...contactPeople];
}

/** AIの提案を見る人向けに、候補の名前を直す（外部人脈は、登録者本人にだけ本名を見せる） */
export function suggestionNameFor(key: string, fallback: string, roster: Roster, nameByMemberId?: Map<string, string>): string {
  const known = roster.nameByKey.get(key);
  if (known) return known;
  if (key.startsWith("m:")) return nameByMemberId?.get(key.slice(2)) ?? fallback;
  return fallback;
}

// ---- 提案の反映（情報ごとに選ぶ） ----

export type ApplySelection = {
  /** true：提案の事業内容（タイトル・概要・お客様像）／{ alternativeIndex }：「ほかの切り口」のアイデアに差し替える */
  business?: boolean | { alternativeIndex: number };
  roles?: string[];
  firstSteps?: number[];
  addActionItems?: boolean;
  addCandidates?: string[];
  addTalents?: number[];
  dismiss?: string[];
};
export type AppliedState = {
  business?: boolean; roles?: string[]; firstSteps?: number[]; addCandidates?: string[]; addTalents?: number[]; dismiss?: string[]; discarded?: boolean;
};

export function parseApplied(raw: string | null | undefined): AppliedState {
  try { const v: unknown = JSON.parse(raw || "{}"); return v && typeof v === "object" ? (v as AppliedState) : {}; } catch { return {}; }
}

/** 提案のうち、まだ反映・破棄していない項目の数 */
export function remainingItems(ideas: TeamDraftIdeas, applied: AppliedState): number {
  const left = <T,>(all: T[], done: T[] | undefined) => all.filter((x) => !(done ?? []).includes(x)).length;
  return (applied.business ? 0 : 1)
    + left(ideas.roles.map((r) => r.key), applied.roles)
    + left(ideas.firstSteps.map((_, i) => i), applied.firstSteps)
    + left((ideas.suggestedMembers ?? []).map((m) => m.key), applied.addCandidates)
    + left((ideas.desiredTalents ?? []).map((_, i) => i), applied.addTalents)
    + left((ideas.memberAdvice ?? []).map((m) => m.key), applied.dismiss);
}

export async function applyProposal(
  db: Db, subject: Subject, ideas: TeamDraftIdeas, appliedBefore: AppliedState, sel: ApplySelection, meId: string,
): Promise<{ applied: AppliedState; error?: string }> {
  const now = nowSec();
  const profile = await getProfile(db, subject.type, subject.id);
  const patch: Parameters<typeof saveProfile>[3] = {};
  const applied: AppliedState = { ...appliedBefore };
  const merge = <T,>(a: T[] | undefined, b: T[]): T[] => [...new Set([...(a ?? []), ...b])];

  // ① 事業内容
  if (sel.business) {
    if (typeof sel.business === "object") {
      const alt = ideas.alternativeIdeas?.[sel.business.alternativeIndex];
      if (!alt) return { applied, error: "選んだアイデアが見つかりません" };
      patch.businessTitle = alt.title;
      patch.summary = alt.summary;
    } else {
      patch.businessTitle = ideas.businessTitle;
      patch.summary = ideas.summary;
      if (ideas.targetCustomers) patch.targetCustomers = ideas.targetCustomers;
    }
    applied.business = true;
  }

  // 現在の構成（役割・候補の追加の確認に使う）
  const roster = await loadRoster(db, subject, { isActive: true, isPending: false, isLeader: true, leaderGone: false }, meId);
  const roles = parseRoles(profile?.rolesJson);

  // ② 役割分担
  if (sel.roles?.length) {
    const valid = new Set([...roster.members.map((m) => m.key), ...roster.prospects.map((p) => p.key)]);
    const done: string[] = [];
    for (const key of sel.roles) {
      const r = ideas.roles.find((x) => x.key === key);
      if (!r || !valid.has(key)) continue;
      roles[key] = r.role;
      done.push(key);
    }
    if (done.length > 0) { patch.rolesJson = JSON.stringify(roles); applied.roles = merge(applied.roles, done); }
  }

  // ③ 最初の一歩
  if (sel.firstSteps?.length) {
    const steps = sel.firstSteps.filter((i) => Number.isInteger(i) && i >= 0 && i < ideas.firstSteps.length);
    if (steps.length > 0) {
      patch.firstStepsJson = JSON.stringify(steps.map((i) => ideas.firstSteps[i]));
      applied.firstSteps = merge(applied.firstSteps, steps);
      if (sel.addActionItems) {
        await db.insert(schema.collabTeamActionItems).values(steps.map((i) => ({
          id: newId(), teamId: subject.id, task: ideas.firstSteps[i], assigneeMemberId: null, dueDate: null, visibility: "team" as const,
          completed: 0, completedAt: null, createdByPostId: null, createdAt: now, updatedAt: now,
        })));
      }
    }
  }

  // ④ 追加メンバー候補
  const prospectCount = roster.prospects.length;
  const memberCount = roster.members.length;
  const capacity = subject.type === "draft" ? MAX_PEOPLE - memberCount - prospectCount : MAX_PEOPLE - prospectCount;
  let room = capacity;
  const skipped: string[] = [];
  if (sel.addCandidates?.length) {
    const taken = new Set([...roster.members.map((m) => m.key), ...roster.prospects.map((p) => p.key)]);
    const done: string[] = [];
    for (const key of sel.addCandidates) {
      const s = ideas.suggestedMembers?.find((m) => m.key === key);
      if (!s || taken.has(key) || (key[0] !== "m" && key[0] !== "c")) continue;
      if (room <= 0) { skipped.push(key); continue; }
      const kind = key.startsWith("m:") ? "member" : "contact";
      const refId = key.slice(2);
      let ownerMemberId: string | null = null;
      if (kind === "contact") {
        const ct = await db.select({ owner: schema.externalContacts.ownerMemberId }).from(schema.externalContacts).where(eq(schema.externalContacts.id, refId)).get();
        if (!ct) continue;
        ownerMemberId = ct.owner;
      } else {
        const m = await db.select({ status: schema.members.status }).from(schema.members).where(eq(schema.members.id, refId)).get();
        if (m?.status !== "active") continue;
      }
      await db.insert(schema.teamProspects).values({
        id: newId(), subjectType: subject.type, subjectId: subject.id, kind, refId, ownerMemberId, locked: 0, published: 0, addedBy: meId, createdAt: now,
      }).onConflictDoNothing();
      room--; taken.add(key); done.push(key);
    }
    if (done.length > 0) applied.addCandidates = merge(applied.addCandidates, done);
  }

  // ⑤ 追加したい人材
  if (sel.addTalents?.length) {
    const done: number[] = [];
    for (const i of sel.addTalents) {
      const t = ideas.desiredTalents?.[i];
      if (!t || (applied.addTalents ?? []).includes(i)) continue;
      if (room <= 0) continue;
      await db.insert(schema.teamProspects).values({
        id: newId(), subjectType: subject.type, subjectId: subject.id, kind: "talent", refId: null, locked: 0,
        talentTitle: t.title, talentProfile: t.profile, talentReason: t.reason, published: 0, addedBy: meId, createdAt: now,
      });
      room--; done.push(i);
    }
    if (done.length > 0) applied.addTalents = merge(applied.addTalents, done);
  }

  // ⑥ 候補の見送り（確定した人・参加中の人は対象外）
  if (sel.dismiss?.length) {
    const done: string[] = [];
    for (const key of sel.dismiss) {
      if (!ideas.memberAdvice?.some((a) => a.key === key)) continue;
      const pr = roster.prospects.find((p) => p.key === key);
      if (!pr || pr.locked) continue;
      await db.delete(schema.teamProspects).where(eq(schema.teamProspects.id, pr.prospectId));
      delete roles[key];
      patch.rolesJson = JSON.stringify(roles);
      done.push(key);
    }
    if (done.length > 0) applied.dismiss = merge(applied.dismiss, done);
  }

  if (Object.keys(patch).length > 0 || !profile) {
    // 反映して仮の内容でなくなるのは、リーダーが内容を確認して反映したため
    await saveProfile(db, subject.type, subject.id, { ...patch, isProvisional: 0, confirmedAt: now }, meId);
  }
  return { applied, ...(skipped.length > 0 ? { error: "候補・募集人材の人数の上限のため、追加できなかった人がいます" } : {}) };
}

/** プロフィールから、AIの「前回のまとめ」に渡す形を作る */
export function profileAsPrevious(profile: ProfileRow | null, roster: Roster): TeamDraftIdeas | null {
  if (!profile || !hasProfileContent(profile) && Object.keys(parseRoles(profile.rolesJson)).length === 0) return null;
  const roles = parseRoles(profile.rolesJson);
  return {
    businessTitle: profile.businessTitle, summary: profile.summary, targetCustomers: profile.targetCustomers || undefined,
    roles: Object.entries(roles).map(([key, role]) => ({ key, role })), firstSteps: parseSteps(profile.firstStepsJson),
    // 「前回のまとめ」に含まれていた人＝すでに役割を考えた人。役割がまだない人は「追加されたメンバー」として扱う
    participantKeys: Object.keys(roles).sort(), goal: profile.goal, generatedAt: profile.updatedAt,
    desiredTalents: roster.prospects.filter((p) => p.kind === "talent" && !p.filled).map((p) => ({ title: p.title ?? "", profile: p.profile ?? "", reason: p.reason ?? "", role: p.role ?? "" })),
  };
}

/** 役割を書き換える（空文字なら役割を消す） */
export async function setRole(db: Db, subject: Subject, key: string, role: string, updatedBy: string): Promise<void> {
  const profile = await getProfile(db, subject.type, subject.id);
  const roles = parseRoles(profile?.rolesJson);
  if (role.trim()) roles[key] = role.trim(); else delete roles[key];
  await saveProfile(db, subject.type, subject.id, { rolesJson: JSON.stringify(roles) }, updatedBy);
}

/** チームの解散・メンバーの全員脱退のときに、チーム育成のデータを片づける */
export async function deleteTeamWorkspaceData(db: Db, type: SubjectType, id: string): Promise<void> {
  await Promise.all([
    db.delete(schema.teamProfiles).where(and(eq(schema.teamProfiles.subjectType, type), eq(schema.teamProfiles.subjectId, id))),
    db.delete(schema.teamProfileProposals).where(and(eq(schema.teamProfileProposals.subjectType, type), eq(schema.teamProfileProposals.subjectId, id))),
    db.delete(schema.teamProspects).where(and(eq(schema.teamProspects.subjectType, type), eq(schema.teamProspects.subjectId, id))),
  ]);
  if (type === "team") {
    await Promise.all([
      db.delete(schema.teamRoleRequests).where(eq(schema.teamRoleRequests.teamId, id)),
      db.delete(schema.teamMilestones).where(eq(schema.teamMilestones.teamId, id)),
    ]);
  }
}

/** 招待中の「参加希望」を承認して参加した人が、募集人材への興味あり（prospect_id つき）なら、募集人材を「充足」にして役割を引き継ぐ */
export async function onJoinApproved(db: Db, teamId: string, memberId: string): Promise<void> {
  // 参加したので、候補としては外す（役割のキーは同じなので、そのまま引き継がれる）
  await db.delete(schema.teamProspects).where(and(eq(schema.teamProspects.subjectType, "team"), eq(schema.teamProspects.subjectId, teamId), eq(schema.teamProspects.kind, "member"), eq(schema.teamProspects.refId, memberId)));
  const row = await db.select().from(schema.collabTeamMembers)
    .where(and(eq(schema.collabTeamMembers.teamId, teamId), eq(schema.collabTeamMembers.memberId, memberId))).get();
  if (!row?.prospectId) return;
  const pr = await db.select().from(schema.teamProspects).where(eq(schema.teamProspects.id, row.prospectId)).get();
  if (!pr || pr.filledByMemberId) return;
  await db.update(schema.teamProspects).set({ filledByMemberId: memberId, filledAt: nowSec(), published: 0 }).where(eq(schema.teamProspects.id, pr.id));
  const subject: Subject = { type: "team", id: teamId, title: "", goal: "", stage: "loose", archived: false, leaderId: "", createdAt: 0 };
  const profile = await getProfile(db, "team", teamId);
  const roles = parseRoles(profile?.rolesJson);
  const talentKey = `t:${pr.id}`;
  if (roles[talentKey]) {
    roles[`m:${memberId}`] = roles[talentKey];
    delete roles[talentKey];
    await saveProfile(db, subject.type, teamId, { rolesJson: JSON.stringify(roles) }, null);
  }
  await addMilestone(db, teamId, "talent_filled", pr.id);
}


/**
 * チームが作られたときに呼ぶ。空のプロフィールを用意して（＝既存チーム向けの仮プロフィールの一括生成の対象にしない）、歩みに「結成」を記録する。
 * すでにプロフィールがあるとき（チーム案から移ってきたとき）は、そのまま使う。
 */
export async function onTeamCreated(db: Db, teamId: string): Promise<void> {
  const now = nowSec();
  await db.insert(schema.teamProfiles).values({ id: newId(), subjectType: "team", subjectId: teamId, createdAt: now, updatedAt: now }).onConflictDoNothing();
  await addMilestone(db, teamId, "formed");
}

/** チームのアクションを使える人か：参加中のメンバー、またはチーム案の作成者（チーム案のアクションは、チーム案のIDをチームIDとして持つ） */
export async function canUseActionItems(db: Db, teamId: string, meId: string): Promise<boolean> {
  const m = await db.select({ id: schema.collabTeamMembers.id }).from(schema.collabTeamMembers)
    .where(and(eq(schema.collabTeamMembers.teamId, teamId), eq(schema.collabTeamMembers.memberId, meId), eq(schema.collabTeamMembers.status, "active"))).get();
  if (m) return true;
  const d = await db.select({ id: schema.teamDrafts.id }).from(schema.teamDrafts)
    .where(and(eq(schema.teamDrafts.id, teamId), eq(schema.teamDrafts.ownerMemberId, meId))).get();
  return !!d;
}

/**
 * この機能ができる前に作られたチーム案（AIのまとめを team_drafts.ideas_json に持っている）を、初めて開いたときに、プロフィール・役割・募集人材に引き継ぐ。
 * すでにプロフィールがあるときは何もしない。
 */
export async function adoptLegacyDraftIdeas(db: Db, draftId: string, meId: string): Promise<void> {
  if (await getProfile(db, "draft", draftId)) return;
  const d = await db.select().from(schema.teamDrafts).where(eq(schema.teamDrafts.id, draftId)).get();
  if (!d?.ideasJson) return;
  let ideas: TeamDraftIdeas;
  try { ideas = JSON.parse(d.ideasJson) as TeamDraftIdeas; } catch { return; }
  const now = nowSec();
  const roles: Record<string, string> = Object.fromEntries((ideas.roles ?? []).map((r) => [r.key, r.role]));
  for (const t of (ideas.desiredTalents ?? []).slice(0, 3)) {
    const id = newId();
    await db.insert(schema.teamProspects).values({
      id, subjectType: "draft", subjectId: draftId, kind: "talent", refId: null, locked: 0, talentTitle: t.title, talentProfile: t.profile, talentReason: t.reason,
      published: 0, addedBy: meId, createdAt: now,
    });
    if (t.role) roles[`t:${id}`] = t.role;
  }
  await saveProfile(db, "draft", draftId, {
    businessTitle: ideas.businessTitle ?? "", summary: ideas.summary ?? "", targetCustomers: ideas.targetCustomers ?? "",
    firstStepsJson: JSON.stringify(ideas.firstSteps ?? []), rolesJson: JSON.stringify(roles), isProvisional: 0, confirmedAt: now,
  }, meId);
}
