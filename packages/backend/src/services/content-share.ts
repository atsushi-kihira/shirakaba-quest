// =============================================================
// 共有（読み取り専用）
// 自分だけ・チームだけに限られているものを、次の範囲で見せられるようにする。
//   ・自分だけ（共有の設定がない状態）
//   ・指定した人だけ（個別／ギルド／チーム）
//   ・白樺クエストのメンバー全員
//   ・URLを知っている人全員（ログイン不要）
// 共有された人は見るだけで、編集はできない。見せる内容は、見る人に応じてサーバー側で絞り込む。
// =============================================================
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { isMemberApproved } from "./resolve-member.ts";
import { buildTeamProfileView, manageTeamProfile, titlesForTeamProfiles } from "./content-share-team-profile.ts";
import { buildContactsView, manageContacts, titlesForContacts } from "./content-share-contacts.ts";
import { buildDraftView, manageDraft, titlesForDrafts } from "./content-share-draft.ts";
import { buildResultView, manageResult, titlesForResults } from "./content-share-result.ts";

export type ShareKind = "team_profile" | "contacts" | "team_draft" | "enishi_result";
export type ShareScope = "private" | "selected" | "members" | "link";
export type TargetType = "member" | "guild" | "collab_team";

/** 見る人の立場。public = ログインしていない人（URLで見る人） */
export type ViewerLevel = "owner" | "member" | "public";

export type ShareSetting = {
  scope: ShareScope;
  memberIds: string[];
  guildIds: string[];
  collabTeamIds: string[];
  /** scope='link' のときの合言葉（共有URLの末尾） */
  linkToken: string | null;
};

export type ShareInput = {
  scope: ShareScope;
  memberIds?: string[];
  guildIds?: string[];
  collabTeamIds?: string[];
  /** true のとき、URLを作り直す（これまでのURLは使えなくなる） */
  regenerateLink?: boolean;
};

export type SharedBy = { id: string; name: string; emoji: string };

/** 共有されたものの表示用データ。body の中身は kind ごとに違う */
export type SharedView = {
  kind: ShareKind;
  subjectId: string;
  title: string;
  sharedBy: SharedBy;
  sharedAt: number;
  viewerLevel: ViewerLevel;
  body: unknown;
};

export type ShareRow = typeof schema.contentShares.$inferSelect;

/** kind ごとの処理。管理できる人かの判定・タイトル・表示データの組み立て */
type KindHandler = {
  /** その人が共有を設定できるか（できなければ null）。できるなら、共有するものの名前を返す */
  manage: (db: Db, subjectId: string, meId: string) => Promise<{ title: string } | null>;
  /** 一覧表示用のタイトル（subjectId → タイトル） */
  titles: (db: Db, subjectIds: string[]) => Promise<Map<string, string>>;
  /** 見る人に応じて絞り込んだ表示データ。見つからなければ null */
  build: (db: Db, share: ShareRow, viewerId: string | null, level: ViewerLevel) => Promise<{ title: string; body: unknown } | null>;
};

const HANDLERS: Partial<Record<ShareKind, KindHandler>> = {
  team_profile: { manage: manageTeamProfile, titles: titlesForTeamProfiles, build: buildTeamProfileView },
  contacts: { manage: manageContacts, titles: titlesForContacts, build: buildContactsView },
  team_draft: { manage: manageDraft, titles: titlesForDrafts, build: buildDraftView },
  enishi_result: { manage: manageResult, titles: titlesForResults, build: buildResultView },
};

export const isShareKind = (v: string): v is ShareKind => v === "team_profile" || v === "contacts" || v === "team_draft" || v === "enishi_result";
export const isSupportedKind = (k: ShareKind): boolean => !!HANDLERS[k];

const SCOPES: ShareScope[] = ["private", "selected", "members", "link"];
const MAX_TARGETS = 200;
const nowSec = () => Math.floor(Date.now() / 1000);

/** 推測されにくい合言葉（URLに入れる）。192ビットの乱数を、URLで使える文字に直したもの */
function newLinkToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function canManage(db: Db, kind: ShareKind, subjectId: string, meId: string): Promise<{ title: string } | null> {
  const h = HANDLERS[kind];
  return h ? h.manage(db, subjectId, meId) : null;
}

export async function loadShare(db: Db, kind: ShareKind, subjectId: string): Promise<ShareRow | null> {
  return (await db.select().from(schema.contentShares)
    .where(and(eq(schema.contentShares.kind, kind), eq(schema.contentShares.subjectId, subjectId))).get()) ?? null;
}

async function loadTargets(db: Db, shareId: string): Promise<{ targetType: TargetType; targetId: string }[]> {
  const rows = await db.select().from(schema.contentShareTargets).where(eq(schema.contentShareTargets.shareId, shareId)).all();
  return rows.map((r) => ({ targetType: r.targetType as TargetType, targetId: r.targetId }));
}

/** いまの共有の設定（なければ「自分だけ」） */
export async function getSetting(db: Db, kind: ShareKind, subjectId: string): Promise<ShareSetting> {
  const share = await loadShare(db, kind, subjectId);
  if (!share) return { scope: "private", memberIds: [], guildIds: [], collabTeamIds: [], linkToken: null };
  const targets = await loadTargets(db, share.id);
  const pick = (t: TargetType) => targets.filter((x) => x.targetType === t).map((x) => x.targetId);
  return {
    scope: share.scope as ShareScope,
    memberIds: pick("member"), guildIds: pick("guild"), collabTeamIds: pick("collab_team"),
    linkToken: share.scope === "link" ? share.linkToken : null,
  };
}

const uniq = (a: unknown): string[] => (Array.isArray(a) ? [...new Set(a.filter((x): x is string => typeof x === "string" && x !== ""))] : []);

export type SaveResult = { ok: true; setting: ShareSetting; addedMemberIds: string[] } | { ok: false; message: string };

/**
 * 共有の設定を保存する。共有先は、実在する利用中のメンバー・ギルド・チームだけ。
 * 返り値の addedMemberIds は、今回あらたに見られるようになった個別のメンバー（お知らせ用）
 */
export async function saveSetting(db: Db, kind: ShareKind, subjectId: string, ownerId: string, input: ShareInput): Promise<SaveResult> {
  if (!SCOPES.includes(input.scope)) return { ok: false, message: "共有の範囲が正しくありません" };
  const before = await loadShare(db, kind, subjectId);

  if (input.scope === "private") {
    if (before) {
      await db.delete(schema.contentShareTargets).where(eq(schema.contentShareTargets.shareId, before.id));
      await db.delete(schema.contentShares).where(eq(schema.contentShares.id, before.id));
    }
    return { ok: true, setting: await getSetting(db, kind, subjectId), addedMemberIds: [] };
  }

  const memberIds = input.scope === "selected" ? uniq(input.memberIds).filter((id) => id !== ownerId) : [];
  const guildIds = input.scope === "selected" ? uniq(input.guildIds) : [];
  const collabTeamIds = input.scope === "selected" ? uniq(input.collabTeamIds) : [];
  if (input.scope === "selected") {
    if (memberIds.length + guildIds.length + collabTeamIds.length === 0) return { ok: false, message: "共有する相手を1人以上（またはギルド・チームを1つ以上）選んでください" };
    if (memberIds.length + guildIds.length + collabTeamIds.length > MAX_TARGETS) return { ok: false, message: `共有先は${MAX_TARGETS}件までです` };
    const [okMembers, okGuilds, okTeams] = await Promise.all([
      memberIds.length ? db.select({ id: schema.members.id }).from(schema.members).where(and(inArray(schema.members.id, memberIds), eq(schema.members.status, "active"))).all() : [],
      guildIds.length ? db.select({ id: schema.teams.id }).from(schema.teams).where(inArray(schema.teams.id, guildIds)).all() : [],
      collabTeamIds.length ? db.select({ id: schema.collabTeams.id }).from(schema.collabTeams).where(inArray(schema.collabTeams.id, collabTeamIds)).all() : [],
    ]);
    if (okMembers.length !== memberIds.length || okGuilds.length !== guildIds.length || okTeams.length !== collabTeamIds.length) {
      return { ok: false, message: "選んだ共有先の中に、見つからない人・ギルド・チームがありました。選び直してください" };
    }
  }

  const now = nowSec();
  // URLの合言葉：URL共有のあいだは同じものを使い続ける（作り直すと、これまでのURLは使えなくなる）
  const keepToken = input.scope === "link" && before?.scope === "link" && before.linkToken && !input.regenerateLink;
  const linkToken = input.scope === "link" ? (keepToken ? before!.linkToken : newLinkToken()) : null;

  const previousMembers = before ? (await loadTargets(db, before.id)).filter((t) => t.targetType === "member").map((t) => t.targetId) : [];
  let shareId: string;
  if (before) {
    shareId = before.id;
    await db.update(schema.contentShares).set({ scope: input.scope, linkToken, ownerMemberId: ownerId, updatedAt: now }).where(eq(schema.contentShares.id, shareId)).run();
    await db.delete(schema.contentShareTargets).where(eq(schema.contentShareTargets.shareId, shareId));
  } else {
    shareId = crypto.randomUUID();
    await db.insert(schema.contentShares).values({ id: shareId, kind, subjectId, ownerMemberId: ownerId, scope: input.scope, linkToken, createdAt: now, updatedAt: now }).run();
  }
  const rows = [
    ...memberIds.map((id) => ({ shareId, targetType: "member", targetId: id })),
    ...guildIds.map((id) => ({ shareId, targetType: "guild", targetId: id })),
    ...collabTeamIds.map((id) => ({ shareId, targetType: "collab_team", targetId: id })),
  ];
  for (let i = 0; i < rows.length; i += 30) await db.insert(schema.contentShareTargets).values(rows.slice(i, i + 30)).run();

  return {
    ok: true, setting: await getSetting(db, kind, subjectId),
    addedMemberIds: memberIds.filter((id) => !previousMembers.includes(id)),
  };
}

/** ログインしている人が、その共有を見られるか。見られるなら、その立場を返す */
export async function viewerLevelFor(db: Db, share: ShareRow, viewerId: string): Promise<ViewerLevel | null> {
  if (viewerId === share.ownerMemberId) return "owner";
  if (!(await isMemberApproved(db, viewerId))) return null;
  if (share.scope === "members" || share.scope === "link") return "member";
  if (share.scope !== "selected") return null;

  const targets = await loadTargets(db, share.id);
  if (targets.some((t) => t.targetType === "member" && t.targetId === viewerId)) return "member";
  const guildIds = targets.filter((t) => t.targetType === "guild").map((t) => t.targetId);
  if (guildIds.length) {
    const hit = await db.select({ id: schema.teamMembers.id }).from(schema.teamMembers)
      .where(and(inArray(schema.teamMembers.teamId, guildIds), eq(schema.teamMembers.memberId, viewerId))).get();
    if (hit) return "member";
  }
  const teamIds = targets.filter((t) => t.targetType === "collab_team").map((t) => t.targetId);
  if (teamIds.length) {
    const hit = await db.select({ id: schema.collabTeamMembers.id }).from(schema.collabTeamMembers)
      .where(and(inArray(schema.collabTeamMembers.teamId, teamIds), eq(schema.collabTeamMembers.memberId, viewerId), eq(schema.collabTeamMembers.status, "active"))).get();
    if (hit) return "member";
  }
  return null;
}

async function sharedByOf(db: Db, ownerId: string): Promise<SharedBy> {
  const o = await db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji }).from(schema.members).where(eq(schema.members.id, ownerId)).get();
  return o ?? { id: ownerId, name: "メンバー", emoji: "👤" };
}

/** 表示データを組み立てる（見られない・見つからないときは null） */
export async function buildView(db: Db, share: ShareRow, viewerId: string | null, level: ViewerLevel): Promise<SharedView | null> {
  const h = HANDLERS[share.kind as ShareKind];
  if (!h) return null;
  const built = await h.build(db, share, viewerId, level);
  if (!built) return null;
  return {
    kind: share.kind as ShareKind, subjectId: share.subjectId, title: built.title,
    sharedBy: await sharedByOf(db, share.ownerMemberId), sharedAt: share.updatedAt, viewerLevel: level, body: built.body,
  };
}

/** メンバーとして、kind と対象を指定して見る */
export async function viewAsMember(db: Db, kind: ShareKind, subjectId: string, viewerId: string): Promise<SharedView | null> {
  const share = await loadShare(db, kind, subjectId);
  if (!share) return null;
  const level = await viewerLevelFor(db, share, viewerId);
  if (!level) return null;
  return buildView(db, share, viewerId, level);
}

/** URL（合言葉）で、ログインせずに見る。URL共有になっているときだけ見られる */
export async function viewByLink(db: Db, token: string): Promise<SharedView | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const share = await db.select().from(schema.contentShares).where(eq(schema.contentShares.linkToken, token)).get();
  if (!share || share.scope !== "link") return null;
  return buildView(db, share, null, "public");
}

export type SharedWithMe = { kind: ShareKind; subjectId: string; title: string; sharedBy: SharedBy; sharedAt: number; scope: "selected" | "members" };

/** 自分に共有されているもの一覧（個別・ギルド・チームで指定されたものと、メンバー全員向けのもの）。URL共有だけのものは含まない */
export async function listSharedWithMe(db: Db, meId: string, limit = 100): Promise<SharedWithMe[]> {
  const [guildRows, teamRows] = await Promise.all([
    db.select({ teamId: schema.teamMembers.teamId }).from(schema.teamMembers).where(eq(schema.teamMembers.memberId, meId)).all(),
    db.select({ teamId: schema.collabTeamMembers.teamId }).from(schema.collabTeamMembers)
      .where(and(eq(schema.collabTeamMembers.memberId, meId), eq(schema.collabTeamMembers.status, "active"))).all(),
  ]);
  const guildIds = guildRows.map((r) => r.teamId);
  const teamIds = teamRows.map((r) => r.teamId);

  const targetRows = await db.select({ shareId: schema.contentShareTargets.shareId, type: schema.contentShareTargets.targetType, id: schema.contentShareTargets.targetId })
    .from(schema.contentShareTargets).where(eq(schema.contentShareTargets.targetId, meId)).all();
  const toMe = new Set(targetRows.filter((t) => t.type === "member").map((t) => t.shareId));
  for (let i = 0; i < guildIds.length; i += 50) {
    for (const r of await db.select({ shareId: schema.contentShareTargets.shareId }).from(schema.contentShareTargets)
      .where(and(eq(schema.contentShareTargets.targetType, "guild"), inArray(schema.contentShareTargets.targetId, guildIds.slice(i, i + 50)))).all()) toMe.add(r.shareId);
  }
  for (let i = 0; i < teamIds.length; i += 50) {
    for (const r of await db.select({ shareId: schema.contentShareTargets.shareId }).from(schema.contentShareTargets)
      .where(and(eq(schema.contentShareTargets.targetType, "collab_team"), inArray(schema.contentShareTargets.targetId, teamIds.slice(i, i + 50)))).all()) toMe.add(r.shareId);
  }

  const allShares = await db.select().from(schema.contentShares).all();
  const mine = allShares
    .filter((s) => s.ownerMemberId !== meId && (s.scope === "members" || (s.scope === "selected" && toMe.has(s.id))))
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);

  const out: SharedWithMe[] = [];
  const byKind = new Map<ShareKind, ShareRow[]>();
  for (const s of mine) byKind.set(s.kind as ShareKind, [...(byKind.get(s.kind as ShareKind) ?? []), s]);
  const owners = new Map<string, SharedBy>();
  for (const [kind, rows] of byKind) {
    const h = HANDLERS[kind];
    if (!h) continue;
    const titles = await h.titles(db, rows.map((r) => r.subjectId));
    for (const r of rows) {
      const title = titles.get(r.subjectId);
      if (title === undefined) continue; // もとのものが削除されている
      if (!owners.has(r.ownerMemberId)) owners.set(r.ownerMemberId, await sharedByOf(db, r.ownerMemberId));
      out.push({ kind, subjectId: r.subjectId, title, sharedBy: owners.get(r.ownerMemberId)!, sharedAt: r.updatedAt, scope: r.scope as "selected" | "members" });
    }
  }
  return out.sort((a, b) => b.sharedAt - a.sharedAt);
}

/** 共有の元になるものが消えたときに、共有の設定も消す */
export async function deleteSharesFor(db: Db, kind: ShareKind, subjectId: string): Promise<void> {
  const s = await loadShare(db, kind, subjectId);
  if (!s) return;
  await db.delete(schema.contentShareTargets).where(eq(schema.contentShareTargets.shareId, s.id));
  await db.delete(schema.contentShares).where(eq(schema.contentShares.id, s.id));
}
