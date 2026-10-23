// =============================================================
// チーム育成の画面（チーム案・緩いチーム・パワーチーム共通）で使う型と共通の部品
// API：/api/collab/workspace/:type/:id（backend: routes/collab-workspace.ts）
// =============================================================
import { ApiError } from "@/lib/api";

export type WsType = "draft" | "team";
export type Stage = "draft" | "loose" | "power";
export type Perspective = "broaden" | "suggest_members" | "new_member_roles" | "reassign_roles";

export type WsMember = {
  key: string; id: string; name: string; emoji: string; bgColor: string; avatarImageKey: string | null; headline: string;
  status: "active" | "pending"; joinRequest: boolean; isLeader: boolean; isMe: boolean; role: string | null; prospectId: string | null;
};
export type WsProspect = {
  key: string; prospectId: string; kind: "member" | "contact" | "talent"; locked: boolean; role: string | null; published: boolean; filled: boolean; filledByName: string | null;
  memberId?: string; name?: string | null; emoji?: string; bgColor?: string; avatarImageKey?: string | null; headline?: string;
  isOwnerView?: boolean; company?: string | null; specialty?: string | null; summary?: string | null; relationships?: string[];
  title?: string; profile?: string; reason?: string;
};

export type Ideas = {
  teamTitle?: string; businessTitle: string; targetCustomers?: string; summary: string;
  roles: { key: string; role: string }[]; firstSteps: string[];
  alternativeIdeas?: { title: string; summary: string }[];
  suggestedMembers?: { key: string; name: string; kind: "member" | "contact" | "talent"; reason: string }[];
  desiredTalents?: { title: string; profile: string; reason: string; role: string }[];
  memberAdvice?: { key: string; advice: "drop"; reason: string }[];
  appliedPerspectives?: Perspective[]; appliedNote?: string; isMock?: boolean;
};
export type Applied = { business?: boolean; roles?: string[]; firstSteps?: number[]; addCandidates?: string[]; addTalents?: number[]; dismiss?: string[]; discarded?: boolean };
export type Proposal = {
  id: string; createdBy: { id: string; name: string }; createdAt: number; perspectives: Perspective[]; note: string; status: "open" | "closed";
  remaining: number; applied: Applied; stale: boolean; ideas: Ideas | null;
};
export type RoleRequest = {
  id: string; targetKey: string; targetName: string; currentRole: string | null; proposedRole: string; requestedBy: { id: string; name: string }; createdAt: number; mine: boolean;
};
export type NextStep = {
  id: string; kind: "invite_candidate" | "find_talent" | "publish_talent" | "role" | "meeting" | "profile" | "first_step"; title: string; detail: string; refKey?: string; text?: string;
};
export type WsDetail = {
  type: WsType; id: string; stage: Stage; title: string; archived: boolean; leaderId: string;
  access: { isActive: boolean; isPending: boolean; isLeader: boolean; leaderGone: boolean; canRun: boolean; canApply: boolean; canEditProfile: boolean };
  profile: {
    businessTitle: string; summary: string; targetCustomers: string; goal: string; firstSteps: string[]; isProvisional: boolean; backfillStatus: string | null; updatedAt: number;
  } | null;
  complete: boolean; members: WsMember[]; prospects: WsProspect[]; maxPeople: number;
  roleRequests: RoleRequest[]; proposals: Proposal[]; nextSteps: NextStep[];
  milestones: { id: string; type: string; label: string; at: number }[];
  health: { status: "active" | "rest" | "follow"; lastActivityAt: number } | null;
  aiRunsLeft: number;
};

export const PERSPECTIVE_LABEL: Record<Perspective, string> = {
  broaden: "協働ビジネスの幅を広げる",
  suggest_members: "追加するメンバーの提案",
  new_member_roles: "追加したメンバーの役割",
  reassign_roles: "役割の割り振り直し",
};

export const STAGE_LABEL: Record<Stage, { emoji: string; label: string; color: string }> = {
  draft: { emoji: "🧪", label: "チーム案", color: "var(--color-ink-500)" },
  loose: { emoji: "🌿", label: "緩いチーム", color: "var(--color-success)" },
  power: { emoji: "⚡", label: "パワーチーム", color: "var(--color-brand)" },
};

export const errText = (e: unknown, fallback: string): string => (e instanceof ApiError ? e.message : fallback);

export const wsKey = (type: WsType, id: string) => ["collab", "workspace", type, id] as const;

/** 画面の各部品に渡す共通の情報（詳細・API の基準パス・結果の反映・エラー表示） */
export type WsCtx = {
  d: WsDetail;
  /** 例：/collab/workspace/team/<id> */
  base: string;
  /** 更新系 API の結果（最新の詳細）を画面に反映する */
  apply: (res: { data: WsDetail }) => void;
  fail: (e: unknown, fallback: string) => void;
  clearError: () => void;
};
