// =============================================================
// 共有（読み取り専用）で見る画面の型
// API：/api/shares/view/:kind/:subjectId（メンバー）、/api/shared/:token（URLで見る人）
// =============================================================
import type { ShareKind } from "@/components/share-dialog";

export type ViewerLevel = "owner" | "member" | "public";

export type TeamProfileBody = {
  stage: "loose" | "power";
  archived: boolean;
  profile: { businessTitle: string; summary: string; targetCustomers: string; goal: string; firstSteps: string[]; isProvisional: boolean } | null;
  members: { id: string; name: string; emoji: string; bgColor: string; headline: string; isLeader: boolean; role: string | null }[];
  talents: { title: string; profile: string; role: string | null; filled: boolean }[];
};

export type ContactsBody = {
  contacts: { id: string; name: string | null; company: string | null; specialty: string | null; summary: string | null; relationships: string[]; prefecture: string | null }[];
  truncated: boolean;
};

export type DraftBody = {
  goal: string;
  profile: { businessTitle: string; summary: string; targetCustomers: string; firstSteps: string[]; isProvisional: boolean } | null;
  proposer: { id: string; name: string; emoji: string; bgColor: string; headline: string; role: string | null };
  candidates: DraftCandidate[];
  nextSteps: { kind: string; title: string; detail: string }[];
  actions: { task: string; assigneeName: string | null; dueDate: string | null; completed: boolean }[];
};

export type DraftCandidate =
  | { kind: "member"; id: string; name: string; emoji: string; bgColor: string; headline: string; role: string | null }
  | { kind: "contact"; name: string | null; company: string | null; specialty: string | null; summary: string | null; relationships: string[]; role: string | null; isSharersContact: boolean }
  | { kind: "talent"; title: string; profile: string; role: string | null };

export type SharedResultCard = {
  hop: string; type: "egg" | "goose"; matchedTargetLabel: string;
  counterpart: { memberId: string; name: string; emoji: string; bgColor: string };
  contactLabel: string; dealDescription: string; why: string; privacyNote: string | null;
  goodMatch: boolean; isMemberCandidate: boolean; score: number | null; isOwnContact: boolean;
};
export type ResultBody = {
  mode: string; createdAt: number; conditions: string[];
  groups: { hop: string; label: string; results: SharedResultCard[] }[];
  total: number; someHidden: boolean; aiCallFailed: boolean; truncated: boolean;
};

export type SharedView = {
  kind: ShareKind;
  subjectId: string;
  title: string;
  sharedBy: { id: string; name: string; emoji: string };
  sharedAt: number;
  viewerLevel: ViewerLevel;
  body: unknown;
};

export type SharedWithMe = {
  kind: ShareKind; subjectId: string; title: string;
  sharedBy: { id: string; name: string; emoji: string }; sharedAt: number; scope: "selected" | "members";
};

export const KIND_LABEL: Record<ShareKind, { emoji: string; label: string }> = {
  team_profile: { emoji: "🌿", label: "チームのプロフィール・役割" },
  contacts: { emoji: "📇", label: "外部人脈" },
  team_draft: { emoji: "🧪", label: "チーム案" },
  enishi_result: { emoji: "🔎", label: "ご縁さがしの検索結果" },
};
