// =============================================================
// Drizzle ORM スキーマ定義 (D1/SQLite)
// =============================================================
import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

export const members = sqliteTable("members", {
  id:                  text("id").primaryKey(),
  email:               text("email").notNull().unique(),
  name:                text("name").notNull(),
  furigana:            text("furigana").notNull().default(""),
  romaji:              text("romaji"),
  emoji:               text("emoji").notNull().default("🙂"),
  bgColor:             text("bg_color").notNull().default("bg-amber-100"),
  company:             text("company"),
  role:                text("role"),
  phone:               text("phone"),
  address:             text("address"),
  category:            text("category").notNull().default(""),
  businessDescription: text("business_description").notNull().default(""),
  skills:              text("skills").notNull().default("[]"),  // JSON
  qrCodeUrl:           text("qr_code_url"),
  facebookUrl:         text("facebook_url"),
  linkedinUrl:         text("linkedin_url"),
  instagramUrl:        text("instagram_url"),
  customFields:        text("custom_fields").default("{}"),
  cardImageKey:        text("card_image_key"),
  avatarImageKey:      text("avatar_image_key"),
  status:              text("status").notNull().default("pending"),
  approvedAt:          integer("approved_at"),
  createdAt:           integer("created_at").notNull(),
  updatedAt:           integer("updated_at").notNull(),
});

export const admins = sqliteTable("admins", {
  id:        text("id").primaryKey(),
  email:     text("email").notNull().unique(),
  name:      text("name").notNull(),
  role:      text("role").notNull().default("admin"),
  createdAt: integer("created_at").notNull(),
});

export const authSessions = sqliteTable("auth_sessions", {
  id:        text("id").primaryKey(),
  userId:    text("user_id").notNull(),
  userType:  text("user_type").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const connections = sqliteTable(
  "connections",
  {
    id:                     text("id").primaryKey(),
    fromMemberId:           text("from_member_id").notNull(),
    toMemberId:             text("to_member_id").notNull(),
    status:                 text("status").notNull().default("none"),
    oneOnOneRequestedAt:    integer("one_on_one_requested_at"),
    oneOnOneAcceptedAt:     integer("one_on_one_accepted_at"),
    oneOnOneCompletedAt:    integer("one_on_one_completed_at"),
    realCardReceivedAt:     integer("real_card_received_at"),
  },
  (t) => [uniqueIndex("uniq_conn").on(t.fromMemberId, t.toMemberId)]
);

export const oneOnOneSessions = sqliteTable("one_on_one_sessions", {
  id:                   text("id").primaryKey(),
  requesterId:          text("requester_id").notNull(),
  responderId:          text("responder_id").notNull(),
  status:               text("status").notNull().default("pending"),
  requestedAt:          integer("requested_at").notNull(),
  respondedAt:          integer("responded_at"),
  scheduledFor:         integer("scheduled_for"),
  requesterCompletedAt: integer("requester_completed_at"),
  responderCompletedAt: integer("responder_completed_at"),
  completedAt:          integer("completed_at"),
});

export const quests = sqliteTable("quests", {
  id:                text("id").primaryKey(),
  title:             text("title").notNull(),
  story:             text("story").notNull(),
  mission:           text("mission").notNull().default(""),
  emoji:             text("emoji").notNull().default("📋"),
  level:             text("level").notNull().default("normal"),
  skillCount:        integer("skill_count").notNull(),
  answerSkills:      text("answer_skills").notNull().default("[]"),  // JSON
  required2x:        integer("required_2x"),
  reward:            integer("reward").notNull().default(5),
  status:            text("status").notNull().default("draft"),
  deadline:          integer("deadline"),
  publishedAt:       integer("published_at"),
  source:            text("source").notNull().default("manual"),
  aiOriginalPrompt:  text("ai_original_prompt"),
  aiPromptHistory:   text("ai_prompt_history").default("[]"),
  createdBy:         text("created_by").notNull(),
  createdAt:         integer("created_at").notNull(),
  updatedAt:         integer("updated_at").notNull(),
});

export const questAttempts = sqliteTable("quest_attempts", {
  id:                 text("id").primaryKey(),
  questId:            text("quest_id").notNull(),
  memberId:           text("member_id").notNull(),
  selectedSkillNames: text("selected_skill_names").notNull().default("[]"),
  isCorrect:          integer("is_correct").notNull().default(0),
  attemptedAt:        integer("attempted_at").notNull(),
});

export const pointTransactions = sqliteTable("point_transactions", {
  id:        text("id").primaryKey(),
  memberId:  text("member_id").notNull(),
  delta:     integer("delta").notNull(),
  reason:    text("reason").notNull(),
  relatedId: text("related_id"),
  createdAt: integer("created_at").notNull(),
});

// USP（Unique Selling Proposition）マスター — 管理者が定義する能力リスト
export const usps = sqliteTable("usps", {
  id:          text("id").primaryKey(),
  name:        text("name").notNull().unique(),   // 例: "リスク判断力"
  emoji:       text("emoji").notNull().default("⭐"),
  description: text("description"),               // 任意の補足説明
  sortOrder:   integer("sort_order").notNull().default(0),
  createdAt:   integer("created_at").notNull(),
  updatedAt:   integer("updated_at").notNull(),
});

export const uspRequests = sqliteTable("usp_requests", {
  id:             text("id").primaryKey(),
  requesterEmail: text("requester_email").notNull(),
  requesterName:  text("requester_name").notNull().default(""),
  uspName:        text("usp_name").notNull(),
  emoji:          text("emoji").notNull().default("⭐"),
  description:    text("description"),
  status:         text("status").notNull().default("pending"), // pending | approved | rejected
  reviewNote:     text("review_note"),
  reviewedBy:     text("reviewed_by"),
  reviewedAt:     integer("reviewed_at"),
  createdAt:      integer("created_at").notNull(),
});

export const teams = sqliteTable("teams", {
  id:          text("id").primaryKey(),
  name:        text("name").notNull(),
  emblemEmoji: text("emblem_emoji").notNull().default("🦊"),
  seasonId:    text("season_id"),
  createdAt:   integer("created_at").notNull(),
  updatedAt:   integer("updated_at").notNull(),
});

export const teamMembers = sqliteTable(
  "team_members",
  {
    id:       text("id").primaryKey(),
    teamId:   text("team_id").notNull(),
    memberId: text("member_id").notNull(),
    isLeader: integer("is_leader").notNull().default(0),
    joinedAt: integer("joined_at").notNull(),
  },
  (t) => [uniqueIndex("uniq_team_member").on(t.teamId, t.memberId)]
);

export const eventCampaigns = sqliteTable("event_campaigns", {
  id:              text("id").primaryKey(),
  type:            text("type").notNull(),
  title:           text("title").notNull(),
  description:     text("description").notNull().default(""),
  startsAt:        integer("starts_at").notNull(),
  endsAt:          integer("ends_at"),
  relatedMemberId:  text("related_member_id"),
  relatedMemberIds: text("related_member_ids"),
  multiplier:       integer("multiplier"),
  status:          text("status").notNull().default("active"),
  createdAt:       integer("created_at").notNull(),
  updatedAt:       integer("updated_at").notNull(),
});

export const visitorInvites = sqliteTable("visitor_invites", {
  id:           text("id").primaryKey(),
  memberId:     text("member_id").notNull(),
  visitorName:  text("visitor_name").notNull().default(""),
  attendedAt:   integer("attended_at"),
  status:       text("status").notNull().default("pending"),
  resolvedAt:   integer("resolved_at"),
  pointsAwarded: integer("points_awarded").notNull().default(5),
  createdAt:    integer("created_at").notNull(),
});

export const seasons = sqliteTable("seasons", {
  id:        text("id").primaryKey(),
  name:      text("name").notNull(),
  theme:     text("theme").notNull().default(""),
  startsAt:  integer("starts_at").notNull(),
  endsAt:    integer("ends_at"),
  isActive:  integer("is_active").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  // ポイント設定（null = デフォルト値を使用）
  pointOneOnOne:          integer("point_one_on_one"),
  pointRealCard:          integer("point_real_card"),
  pointQuestNormal:       integer("point_quest_normal"),
  pointQuestHard:         integer("point_quest_hard"),
  pointWelcomeQuestBonus: integer("point_welcome_quest_bonus"),
});

export const seasonRankings = sqliteTable(
  "season_rankings",
  {
    id:       text("id").primaryKey(),
    seasonId: text("season_id").notNull(),
    memberId: text("member_id").notNull(),
    points:   integer("points").notNull().default(0),
  },
  (t) => [uniqueIndex("uniq_season_ranking").on(t.seasonId, t.memberId)]
);

export const badges = sqliteTable("badges", {
  id:             text("id").primaryKey(),
  name:           text("name").notNull(),
  emoji:          text("emoji").notNull(),
  description:    text("description").notNull().default(""),
  conditionType:  text("condition_type").notNull(),
  conditionValue: integer("condition_value"),
  sortOrder:      integer("sort_order").notNull().default(0),
  createdAt:      integer("created_at").notNull(),
});

export const memberBadges = sqliteTable(
  "member_badges",
  {
    id:       text("id").primaryKey(),
    memberId: text("member_id").notNull(),
    badgeId:  text("badge_id").notNull(),
    earnedAt: integer("earned_at").notNull(),
  },
  (t) => [uniqueIndex("uniq_member_badge").on(t.memberId, t.badgeId)]
);

export const cardDesigns = sqliteTable("card_designs", {
  id:                   text("id").primaryKey().default("default"),
  frontFeatureLabel:    text("front_feature_label").notNull().default("USP・SKILLs"),
  frontFeatureSublabel: text("front_feature_sublabel").notNull().default("〜力（チカラ）"),
  backFields:           text("back_fields").notNull(),
  customBackFields:     text("custom_back_fields").notNull().default("[]"),
  appTitle:             text("app_title").notNull().default("白樺クエスト"),
  appLogo:              text("app_logo").notNull().default("🃏"),
  appPointName:         text("app_point_name").notNull().default("pt"),
  // 用語カスタマイズ
  termQuest:            text("term_quest").notNull().default("お題"),
  termUsp:              text("term_usp").notNull().default("USP"),
  termOneOnOne:         text("term_one_on_one").notNull().default("1to1"),
  characterImageKey:    text("character_image_key"),
  updatedAt:            integer("updated_at").notNull(),
  updatedBy:            text("updated_by").notNull(),
});
