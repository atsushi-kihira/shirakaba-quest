// =============================================================
// 白樺クエスト — 共通型定義
// フロントエンド・バックエンドの両方から参照する
// =============================================================

// -------------------------------------------------------
// USP（Unique Selling Proposition）マスター
// 管理者がダッシュボードで定義する能力リスト
// -------------------------------------------------------

export type Usp = {
  id: string;
  name: string;        // 例: "リスク判断力"
  emoji: string;       // 例: "⚖️"
  description?: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

// -------------------------------------------------------
// スキル
// -------------------------------------------------------

export type Skill = {
  name: string;       // 例: "リスク判断力"
  emoji: string;      // 例: "🛡️"
  issue: string;      // 課題シーン
  connector: string;  // つなぎ ("に対して、" / "で、" 等)
  solution: string;   // 解決の結果
  noEnding?: boolean; // true → 末尾を「。」で終わる（falseは「ことができる。」）
  color: string;      // Tailwind クラス例: "bg-rose-100 text-rose-800 ring-rose-200"
};

/** スキル説明文を合成する */
export function buildSkillDescription(skill: Skill): string {
  const ending = skill.noEnding ? "。" : "ことができる。";
  return `${skill.issue}${skill.connector}${skill.name}を通じて、${skill.solution}${ending}`;
}

// -------------------------------------------------------
// メンバー
// -------------------------------------------------------

export type MemberStatus = "pending" | "active" | "suspended" | "deleted";

/** DB の生の Member 型（API レスポンスには直接使わない） */
export type Member = {
  id: string;
  email: string;
  name: string;
  furigana: string;
  romaji?: string;
  emoji: string;
  bgColor: string;

  // 個人情報（1to1 完了後のみ開示）
  company?: string;
  role?: string;
  phone?: string;
  address?: string;

  // 補足情報（常時公開）
  category: string;
  businessDescription: string;
  skills: [Skill, Skill, Skill];

  // SNS 等（CardDesign.backFields で制御）
  qrCodeUrl?: string;
  facebookUrl?: string;
  linkedinUrl?: string;
  instagramUrl?: string;
  customFields?: Record<string, string>;

  status: MemberStatus;
  approvedAt: number | null; // Unix timestamp
  createdAt: number;
  updatedAt: number;
};

/**
 * API レスポンス用の公開メンバー型。
 * 1to1 未実施の相手には個人情報フィールドが null になる。
 */
export type PublicMember = Omit<
  Member,
  "email" | "company" | "role" | "phone" | "address" | "qrCodeUrl" | "facebookUrl" | "linkedinUrl" | "instagramUrl" | "customFields"
> & {
  connectionStatus: ConnectionStatus; // 自分との関係
  hasCardImage: boolean; // カード画像（表面）の有無
  email: string | null;
  company: string | null;
  role: string | null;
  phone: string | null;
  address: string | null;
  qrCodeUrl: string | null;
  facebookUrl: string | null;
  linkedinUrl: string | null;
  instagramUrl: string | null;
  customFields: Record<string, string> | null;
};

// -------------------------------------------------------
// Connection（メンバー間の関係）
// -------------------------------------------------------

export type ConnectionStatus = "none" | "digital" | "real" | "self";

export type Connection = {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  status: ConnectionStatus;
  oneOnOneRequestedAt: number | null;
  oneOnOneAcceptedAt: number | null;
  oneOnOneCompletedAt: number | null;
  realCardReceivedAt: number | null;
};

// -------------------------------------------------------
// 1to1 セッション
// -------------------------------------------------------

export type OneOnOneStatus =
  | "pending"
  | "accepted"
  | "completed"
  | "rejected"
  | "cancelled";

export type OneOnOneSession = {
  id: string;
  requesterId: string;
  responderId: string;
  status: OneOnOneStatus;
  requestedAt: number;
  respondedAt: number | null;
  scheduledFor: number | null;
  requesterCompletedAt: number | null;
  responderCompletedAt: number | null;
  completedAt: number | null;
};

// -------------------------------------------------------
// クエスト（お題）
// -------------------------------------------------------

export type QuestLevel = "normal" | "hard";
export type QuestStatus = "draft" | "published" | "expired" | "deleted";
export type QuestSource = "manual" | "ai";

export type Quest = {
  id: string;
  title: string;
  story: string;
  emoji: string;
  level: QuestLevel;
  skillCount: number;
  // answerSkills は管理者 API のみ返す。プレイヤー API では省略
  answerSkills?: string[];
  required2x?: number;
  reward: number;
  status: QuestStatus;
  deadline: number | null;
  publishedAt: number | null;
  source: QuestSource;
  aiOriginalPrompt?: string;
  aiPromptHistory?: { prompt: string; generatedAt: number }[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

/** プレイヤー向けの公開クエスト型（answerSkills を除外） */
export type PublicQuest = Omit<Quest, "answerSkills">;

// -------------------------------------------------------
// クエスト挑戦記録
// -------------------------------------------------------

export type QuestAttempt = {
  id: string;
  questId: string;
  memberId: string;
  selectedSkillNames: string[];
  isCorrect: boolean;
  attemptedAt: number;
};

// -------------------------------------------------------
// ポイント履歴
// -------------------------------------------------------

export type PointReason =
  | "one_on_one_completed"
  | "real_card_exchanged"
  | "quest_normal_solved"
  | "quest_hard_solved"
  | "admin_reset"
  | "admin_adjust";

export type PointTransaction = {
  id: string;
  memberId: string;
  delta: number;
  reason: PointReason;
  relatedId: string | null;
  createdAt: number;
};

// -------------------------------------------------------
// 管理者アカウント
// -------------------------------------------------------

export type AdminRole = "super_admin" | "admin";

export type Admin = {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  createdAt: number;
};

// -------------------------------------------------------
// カード設計
// -------------------------------------------------------

export type BackFields = {
  role: boolean;
  nameKanji: boolean;
  nameRomaji: boolean;
  companyName: boolean;
  address: boolean;
  phone: boolean;
  email: boolean;
  qrCode: boolean;
  facebook: boolean;
  linkedin: boolean;
  instagram: boolean;
};

export type CardDesign = {
  id: string;
  frontFeatureLabel: string;
  frontFeatureSublabel: string;
  backFields: BackFields;
  customBackFields: { label: string; key: string }[];
  appTitle: string;
  appLogo: string;
  appPointName: string;
  updatedAt: number;
  updatedBy: string;
};

// -------------------------------------------------------
// 認証
// -------------------------------------------------------

export type UserType = "member" | "admin";

export type AuthSession = {
  id: string;
  userId: string;
  userType: UserType;
  tokenHash: string; // SHA-256(rawToken)
  expiresAt: number;
  createdAt: number;
};

// -------------------------------------------------------
// API レスポンス共通形式
// -------------------------------------------------------

export type ApiSuccess<T> = {
  data: T;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
  };
};

// -------------------------------------------------------
// ランキング
// -------------------------------------------------------

export type RankingEntry = {
  rank: number;
  member: Pick<Member, "id" | "name" | "furigana" | "emoji" | "bgColor" | "category">;
  points: number;
  lastPointedAt: number | null;
};

// -------------------------------------------------------
// USP承認申請
// -------------------------------------------------------

export type UspRequestStatus = "pending" | "approved" | "rejected";

export type UspRequest = {
  id: string;
  requesterEmail: string;
  requesterName: string;
  uspName: string;
  emoji: string;
  description?: string;
  status: UspRequestStatus;
  reviewNote?: string;
  reviewedBy?: string;
  reviewedAt?: number;
  createdAt: number;
};

// -------------------------------------------------------
// ユーティリティ
// -------------------------------------------------------

export const AVATAR_BG_OPTIONS = [
  "bg-amber-100",
  "bg-emerald-100",
  "bg-rose-100",
  "bg-sky-100",
  "bg-violet-100",
  "bg-orange-100",
  "bg-teal-100",
  "bg-fuchsia-100",
] as const;

export type AvatarBgColor = (typeof AVATAR_BG_OPTIONS)[number];
