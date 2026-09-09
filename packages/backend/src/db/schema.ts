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
  characterKey:        text("character_key"),
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
  timezone:            text("timezone"),
  status:              text("status").notNull().default("pending"), // 'pending' | 'active' | 'on_leave' | 'deleted'
  approvedAt:          integer("approved_at"),
  createdAt:           integer("created_at").notNull(),
  updatedAt:           integer("updated_at").notNull(),

  // 個人用カラーテーマ（null = アプリ全体のテーマに従う）
  personalTheme:       text("personal_theme"),

  // ビジネスコミュニティ（用語は card_designs.term_business_community でチャプターごとにカスタマイズ可能。
  // 例: 白樺チャプターでは「BNI」）への入会日（"YYYY-MM-DD"形式）。日にちは正確でなくてもよく、
  // 年月さえ合っていればよい（日は覚えている範囲・仮の値でよい）。
  businessCommunityJoinedDate: text("business_community_joined_date"),
});

export const admins = sqliteTable("admins", {
  id:        text("id").primaryKey(),
  email:     text("email").notNull().unique(),
  name:      text("name").notNull(),
  role:      text("role").notNull().default("admin"),
  createdAt: integer("created_at").notNull(),
});

// メンバーへの追加ロール付与（パイロット枠・パワーチームコーディネーター等）
export const memberRoles = sqliteTable(
  "member_roles",
  {
    id:        text("id").primaryKey(),
    memberId:  text("member_id").notNull(),
    role:      text("role").notNull(), // 'pilot' | 'power_team_coordinator'
    grantedBy: text("granted_by").notNull(),
    grantedAt: integer("granted_at").notNull(),
    revokedAt: integer("revoked_at"),
  },
  (t) => [uniqueIndex("uniq_member_role").on(t.memberId, t.role)]
);

// ---- 協働マップ ----

export const collaborationLinks = sqliteTable(
  "collaboration_links",
  {
    id:             text("id").primaryKey(),
    memberLowId:    text("member_low_id").notNull(),   // 2名を辞書順で正規化した小さい方
    memberHighId:   text("member_high_id").notNull(),
    oneOnOneCount:  integer("one_on_one_count").notNull().default(0),
    lastActivityAt: integer("last_activity_at"),
    possibleLow:    integer("possible_low").notNull().default(0),
    possibleHigh:   integer("possible_high").notNull().default(0),
    referralLow:    integer("referral_low").notNull().default(0),
    referralHigh:   integer("referral_high").notNull().default(0),
    promptedCountLow:  integer("prompted_count_low").notNull().default(0),  // このoneOnOneCountまで確認済み(low側)
    promptedCountHigh: integer("prompted_count_high").notNull().default(0), // このoneOnOneCountまで確認済み(high側)
    stage:          text("stage").notNull().default("one"),    // 'one' | 'seed' | 'loose'
    stalled:        text("stalled").notNull().default("active"), // 'active' | 'stalled' | 'intervene'
    createdAt:      integer("created_at").notNull(),
    updatedAt:      integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("uniq_collab_link").on(t.memberLowId, t.memberHighId)]
);

export const collabTeams = sqliteTable("collab_teams", {
  id:        text("id").primaryKey(),
  name:      text("name").notNull(),
  type:      text("type").notNull(), // 'loose' | 'power'
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  archived:  integer("archived").notNull().default(0),
});

export const collabTeamMembers = sqliteTable(
  "collab_team_members",
  {
    id:           text("id").primaryKey(),
    teamId:       text("team_id").notNull(),
    memberId:     text("member_id").notNull(),
    status:       text("status").notNull(), // 'active' | 'pending' | 'declined'
    invitedBy:    text("invited_by"),
    respondedAt:  integer("responded_at"),
    createdAt:    integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("uniq_collab_team_member").on(t.teamId, t.memberId)]
);

// ---- 活動と記録（協働の投稿・シェアストーリー）----

export const collaborationPosts = sqliteTable("collaboration_posts", {
  id:          text("id").primaryKey(),
  authorId:    text("author_id").notNull(),
  contextType: text("context_type").notNull(),               // 'link' | 'team'
  linkId:      text("link_id"),
  teamId:      text("team_id"),
  visibility:  text("visibility").notNull().default("chapter"), // 'team' | 'chapter' | 'private'
  isPrivate:   integer("is_private").notNull().default(0),
  stageAtPost: text("stage_at_post"),                          // 'seed' | 'loose' | 'power'
  source:      text("source").notNull().default("user"),       // 'user' | 'meeting' | 'growth' | 'system'
  body:        text("body"),
  createdAt:   integer("created_at").notNull(),
  updatedAt:   integer("updated_at").notNull(),
  deletedAt:   integer("deleted_at"),
});

export const collaborationPostMembers = sqliteTable(
  "collaboration_post_members",
  {
    postId:   text("post_id").notNull(),
    memberId: text("member_id").notNull(),
  },
  (t) => [uniqueIndex("uniq_collab_post_member").on(t.postId, t.memberId)]
);

export const collaborationPostReactions = sqliteTable(
  "collaboration_post_reactions",
  {
    id:        text("id").primaryKey(),
    postId:    text("post_id").notNull(),
    memberId:  text("member_id").notNull(),
    type:      text("type").notNull(), // 'ouen' | 'shokai' | 'join'
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("uniq_collab_post_reaction").on(t.postId, t.memberId, t.type)]
);

export const collaborationComments = sqliteTable("collaboration_comments", {
  id:        text("id").primaryKey(),
  postId:    text("post_id").notNull(),
  authorId:  text("author_id").notNull(),
  body:      text("body").notNull(),
  createdAt: integer("created_at").notNull(),
  deletedAt: integer("deleted_at"),
});

export const collaborationCommentReactions = sqliteTable(
  "collaboration_comment_reactions",
  {
    id:        text("id").primaryKey(),
    commentId: text("comment_id").notNull(),
    memberId:  text("member_id").notNull(),
    type:      text("type").notNull().default("like"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("uniq_collab_comment_reaction").on(t.commentId, t.memberId, t.type)]
);

// メンバーごとの「協働の活動タイムラインを最後に見た日時」（新着バッジの算出に使う）
export const collabActivityReads = sqliteTable("collab_activity_reads", {
  memberId:   text("member_id").primaryKey(),
  lastReadAt: integer("last_read_at").notNull(),
});

// 「紹介できそう」「私も参加したい」リアクション時のメッセージ通知（宛先ごとに1行）
export const collabReactionNotifications = sqliteTable("collab_reaction_notifications", {
  id:           text("id").primaryKey(),
  postId:       text("post_id").notNull(),
  reactionType: text("reaction_type").notNull(), // 'shokai' | 'join'
  reactorId:    text("reactor_id").notNull(),
  memberId:     text("member_id").notNull(),
  message:      text("message").notNull(),
  readAt:       integer("read_at"),
  createdAt:    integer("created_at").notNull(),
});

export const shareStories = sqliteTable("share_stories", {
  id:          text("id").primaryKey(),
  teamId:      text("team_id"),
  seasonId:    text("season_id"),
  authorId:    text("author_id").notNull(),
  title:       text("title").notNull(),
  summary:     text("summary"),
  presentedOn: integer("presented_on"),
  visibility:  text("visibility").notNull().default("chapter"), // 'team' | 'chapter' | 'private'
  createdAt:   integer("created_at").notNull(),
  updatedAt:   integer("updated_at").notNull(),
  deletedAt:   integer("deleted_at"),
});

export const shareStoryAttachments = sqliteTable("share_story_attachments", {
  id:        text("id").primaryKey(),
  storyId:   text("story_id").notNull(),
  kind:      text("kind").notNull(), // 'slide' | 'video' | 'minutes' | 'photo' | 'link'
  label:     text("label").notNull(),
  url:       text("url"),
  fileKey:   text("file_key"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const shareStoryMembers = sqliteTable(
  "share_story_members",
  {
    storyId:  text("story_id").notNull(),
    memberId: text("member_id").notNull(),
  },
  (t) => [uniqueIndex("uniq_share_story_member").on(t.storyId, t.memberId)]
);

// ---- 人脈レイヤー（外部人脈）----
// 連絡先情報（メール・電話・住所・SNS）は設計上そもそも保持しない。
// 名前・専門分野・会社名/屋号・備考のみを扱う。

export const externalContacts = sqliteTable("external_contacts", {
  id:            text("id").primaryKey(),
  ownerMemberId: text("owner_member_id").notNull(),
  name:          text("name").notNull(),
  specialty:     text("specialty"),                            // 専門分野
  company:       text("company"),                              // 会社名/屋号
  note:          text("note"),                                 // 備考（自由記述）
  visibility:    text("visibility").notNull().default("existence"), // 'private' | 'existence' | 'full'
  source:        text("source").notNull().default("manual"),   // 'manual' | 'generic' | 'eight'
  createdAt:     integer("created_at").notNull(),
  updatedAt:     integer("updated_at").notNull(),

  // 会社名からWeb検索で自動生成する事業概要（登録時に生成。名前・会社名の公開設定とは無関係に生成する）
  businessSummary:            text("business_summary"),          // 一覧表示用の一言概要
  businessSummaryDetail:      text("business_summary_detail"),   // 詳細表示用のより詳しい説明
  businessSummaryStatus:      text("business_summary_status").notNull().default("pending"), // 'pending' | 'processing' | 'done' | 'not_found' | 'skipped' | 'error'
  businessSummaryGeneratedAt: integer("business_summary_generated_at"),
  businessSummaryClaimedAt:   integer("business_summary_claimed_at"), // 'processing'に切り替えた時刻。一定時間が経っても完了しない行を再取得するために使う
});

export const externalContactFavorites = sqliteTable("external_contact_favorites", {
  id:        text("id").primaryKey(),
  memberId:  text("member_id").notNull(),   // お気に入りした本人
  contactId: text("contact_id").notNull(),  // 対象の人脈（他人の人脈も自分の人脈も可）
  createdAt: integer("created_at").notNull(),
});

// 人脈の「関係性」（BNI・倫理法人会・前職の同僚 等）は複数所属できるため多対多で持つ
export const externalContactRelationships = sqliteTable("external_contact_relationships", {
  id:           text("id").primaryKey(),
  contactId:    text("contact_id").notNull(),
  relationship: text("relationship").notNull(),
  createdAt:    integer("created_at").notNull(),
});

export const collabIntroRequests = sqliteTable("collab_intro_requests", {
  id:            text("id").primaryKey(),
  contactId:     text("contact_id").notNull(),
  ownerMemberId: text("owner_member_id").notNull(),
  requesterId:   text("requester_id").notNull(),
  message:       text("message"),
  status:        text("status").notNull().default("pending"), // 'pending' | 'handled'
  createdAt:     integer("created_at").notNull(),
  respondedAt:   integer("responded_at"),
});

// ---- ご縁さがし（金の卵・金のガチョウ） ----
// メンバーが登録する「たどり着きたい理想の案件・お客様（卵）」と
// 「その卵を継続的に運んでくれる立場の人（ガチョウ）」。各メンバー最大8件ずつ（route側でバリデーション）。

export const goldenEggs = sqliteTable("golden_eggs", {
  id:          text("id").primaryKey(),
  memberId:    text("member_id").notNull(),
  description: text("description").notNull(),  // どんな企業か（必須・AI分析の主入力）
  issue:       text("issue"),                   // 相手が抱える課題
  priceRange:  text("price_range"),             // 想定単価帯
  region:      text("region"),                  // 地域
  createdAt:   integer("created_at").notNull(),
  updatedAt:   integer("updated_at").notNull(),
});

export const goldenGeese = sqliteTable("golden_geese", {
  id:                 text("id").primaryKey(),
  memberId:           text("member_id").notNull(),
  description:        text("description").notNull(), // どんな立場の人か（必須・AI分析の主入力）
  contactHypothesis:  text("contact_hypothesis"),     // なぜ卵を持ちうるか（接点仮説）
  priority:           text("priority"),               // '高' | '中' | '低'
  createdAt:          integer("created_at").notNull(),
  updatedAt:          integer("updated_at").notNull(),
});

// ご縁さがしの検索履歴。AIコストをかけて検索した結果を保存し、再度開いた際は
// 再検索せず保存済みの結果をそのまま表示する。resultJson内の各結果カードには
// cardId・goodMatch（「良いご縁だった」フラグ、本人のみ有効）を含めて保存する。
export const enishiSearchHistory = sqliteTable("enishi_search_history", {
  id:         text("id").primaryKey(),
  memberId:   text("member_id").notNull(),
  mode:       text("mode").notNull(),        // 'for-me' | 'giver'
  title:      text("title").notNull(),       // 実施日時・内容がわかるタイトル（保存時に生成）
  paramsJson: text("params_json").notNull(), // 検索時に指定した条件（参考情報）
  resultJson: text("result_json").notNull(), // 検索結果一式（カードごとのcardId・goodMatchを含む）
  createdAt:  integer("created_at").notNull(),
});

// 「私のご縁」検索で「このご縁で繋がりました」とチェックされた人脈。立てた本人の今後の
// 検索候補から除外するために使う（本人のみに有効・他ユーザーの検索結果には影響しない）。
export const enishiTransactedContacts = sqliteTable("enishi_transacted_contacts", {
  id:        text("id").primaryKey(),
  memberId:  text("member_id").notNull(),
  contactId: text("contact_id").notNull(),
  createdAt: integer("created_at").notNull(),
});

// 「私のご縁」検索で「今後の表示は不要です」とチェックされた人脈。「このご縁で繋がりました」とは
// 別の理由（繋がった実績はないが、単純に今後表示してほしくない）として記録を分けるための別テーブル。
// 立てた本人の今後の検索候補から除外する（本人のみに有効・他ユーザーの検索結果には影響しない）。
export const enishiHiddenContacts = sqliteTable("enishi_hidden_contacts", {
  id:        text("id").primaryKey(),
  memberId:  text("member_id").notNull(),
  contactId: text("contact_id").notNull(),
  createdAt: integer("created_at").notNull(),
});

// 「貢献のご縁」検索で「紹介しました」とチェックされた組み合わせ（自分の人脈×相手の金の卵/ガチョウ）。
// 同じ組み合わせを立てた本人の今後の検索結果から除外する（人脈自体・相手の卵/ガチョウ自体は
// 他の組み合わせでは引き続き候補になり得るため、ペア単位で記録する）。
export const enishiIntroducedContacts = sqliteTable("enishi_introduced_contacts", {
  id:          text("id").primaryKey(),
  memberId:    text("member_id").notNull(),
  myContactId: text("my_contact_id").notNull(),
  candidateId: text("candidate_id").notNull(),
  createdAt:   integer("created_at").notNull(),
});

// 手入力でのメンバー登録時、プロフィール入力後にメールアドレスの所有確認を行うためのトークン
export const emailVerifications = sqliteTable("email_verifications", {
  token:      text("token").primaryKey(),
  email:      text("email").notNull(),
  verifiedAt: integer("verified_at"),
  expiresAt:  integer("expires_at").notNull(),
  createdAt:  integer("created_at").notNull(),
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
  responseToken:        text("response_token"),
  manualConferenceUrl:  text("manual_conference_url"),
  autoTransitionReason: text("auto_transition_reason"), // "pending_timeout" | "date_passed" | null(手動操作)
  // 通常申込（相手が公開予約URLで日時を選ぶ方式）で、申込者がこの1件だけに指定したタイトル・所要時間・メッセージ。
  // 公開予約ページ全体の既定値（member_scheduling_settings）は変更せず、このリンク経由の予約にのみ適用する。
  customTitle:            text("custom_title"),
  customDurationMinutes:  integer("custom_duration_minutes"),
  customNote:             text("custom_note"),
  // 自動完了（実施日から1週間経過）した1to1について、本人が「1to1の振り返り」
  // （協業の可能性・リファーラルの可能性）を確認済みかどうか。手動完了時はそもそも
  // ホーム画面で振り返りを促さないため、このセッションが対象にする側だけを記録する。
  requesterReviewedAt:    integer("requester_reviewed_at"),
  responderReviewedAt:    integer("responder_reviewed_at"),
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

// 「今週のクエスト」選出（メンバー×週の開始日時ごとに、未クリアからランダムで選ばれたクエスト）
export const questWeeklySelections = sqliteTable("quest_weekly_selections", {
  id:        text("id").primaryKey(),
  memberId:  text("member_id").notNull(),
  weekStart: integer("week_start").notNull(), // Unix秒（組織タイムゾーンの月曜0時）
  questId:   text("quest_id").notNull(),
  createdAt: integer("created_at").notNull(),
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

export const eventTypeDefinitions = sqliteTable("event_type_definitions", {
  id:                   text("id").primaryKey(),
  slug:                 text("slug").notNull(),
  name:                 text("name").notNull(),
  description:          text("description").notNull().default(""),
  emoji:                text("emoji").notNull().default("🎉"),
  triggerType:          text("trigger_type").notNull().default("display_only"),
  // 'one_on_one' | 'meeting_attendance' | 'display_only'
  pointValue:           integer("point_value").notNull().default(0),
  rewardTarget:         text("reward_target").notNull().default("participant"),
  // 'participant' | 'partner_of_related' | 'none'
  requiresTargetMember: integer("requires_target_member").notNull().default(0),
  creatorRole:          text("creator_role").notNull().default("admin"),
  // 'admin' | 'member'
  linksToMeeting:       integer("links_to_meeting").notNull().default(0),
  isSystem:             integer("is_system").notNull().default(0),
  isActive:             integer("is_active").notNull().default(1),
  sortOrder:            integer("sort_order").notNull().default(0),
  createdAt:            integer("created_at").notNull(),
  updatedAt:            integer("updated_at").notNull(),
});

export const eventCampaigns = sqliteTable("event_campaigns", {
  id:              text("id").primaryKey(),
  type:            text("type").notNull(),
  eventTypeDefId:  text("event_type_def_id"),
  title:           text("title").notNull(),
  description:     text("description").notNull().default(""),
  startsAt:        integer("starts_at").notNull(),
  endsAt:          integer("ends_at"),
  relatedMemberId:  text("related_member_id"),
  relatedMemberIds: text("related_member_ids"),
  multiplier:       integer("multiplier"),
  pointAwardTiming: text("point_award_timing"),  // 'on_view' | 'on_complete' | null
  allowRepeat:      integer("allow_repeat").notNull().default(1), // 1=何度でも実施可（デフォルト）、0=1度のみ
  status:             text("status").notNull().default("active"),
  createdByMemberId:  text("created_by_member_id"),
  createdAt:          integer("created_at").notNull(),
  updatedAt:          integer("updated_at").notNull(),
});

// 繰り返し実施イベントの実施ログ（eventParticipations は unique 制約があるため別テーブル）
export const eventActionLogs = sqliteTable("event_action_logs", {
  id:              text("id").primaryKey(),
  eventCampaignId: text("event_campaign_id").notNull(),
  memberId:        text("member_id").notNull(),
  createdAt:       integer("created_at").notNull(),
});

export const eventParticipations = sqliteTable(
  "event_participations",
  {
    id:              text("id").primaryKey(),
    eventCampaignId: text("event_campaign_id").notNull(),
    memberId:        text("member_id").notNull(),
    createdAt:       integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("idx_event_part_unique").on(t.eventCampaignId, t.memberId)]
);

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

// ---- ミーティング（日程調整）----

export const meetings = sqliteTable("meetings", {
  id:                   text("id").primaryKey(),
  title:                text("title").notNull(),
  description:          text("description"),
  hostMemberId:         text("host_member_id").notNull(),
  scope:                text("scope").notNull().default("all"), // 'all' | 'team' | 'collab_team' | 'selected'
  teamId:               text("team_id"),
  collabTeamId:         text("collab_team_id"),
  status:               text("status").notNull().default("open"), // 'open' | 'confirmed' | 'cancelled'
  confirmedCandidateId:  text("confirmed_candidate_id"),
  deadline:              integer("deadline"),
  eventCampaignId:       text("event_campaign_id"),
  eventTypeDefId:        text("event_type_def_id"),
  registrationDeadline:  integer("registration_deadline"),
  conferenceType:        text("conference_type").notNull().default("manual"),
  conferenceUrl:         text("conference_url"),
  conferenceMetaJson:    text("conference_meta_json"),
  calendarEventId:       text("calendar_event_id"),
  inviteToken:           text("invite_token"),
  lastReminderSentAt:    integer("last_reminder_sent_at"),
  seriesId:              text("series_id"), // 定例会（meeting_series）から生成された回の場合に設定
  seriesOccurrenceIndex: integer("series_occurrence_index"), // シリーズ内の何回目か（1始まり）
  createdAt:             integer("created_at").notNull(),
  updatedAt:             integer("updated_at").notNull(),
});

export const meetingDateCandidates = sqliteTable("meeting_date_candidates", {
  id:              text("id").primaryKey(),
  meetingId:       text("meeting_id").notNull(),
  startsAt:        integer("starts_at").notNull(),
  endsAt:          integer("ends_at"),
  note:            text("note"),
  sortOrder:       integer("sort_order").notNull().default(0),
  isConfirmed:     integer("is_confirmed").notNull().default(0),
  conferenceUrl:   text("conference_url"),
  addedByMemberId: text("added_by_member_id"), // 主催者作成時は主催者ID。あとから追加された候補日はその追加者ID
});

export const meetingInvitees = sqliteTable("meeting_invitees", {
  id:        text("id").primaryKey(),
  meetingId: text("meeting_id").notNull(),
  memberId:  text("member_id").notNull(),
});

export const meetingExternalInvitees = sqliteTable("meeting_external_invitees", {
  id:        text("id").primaryKey(),
  meetingId: text("meeting_id").notNull(),
  name:      text("name").notNull().default(""),
  email:     text("email"),
  token:     text("token").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const meetingResponses = sqliteTable("meeting_responses", {
  id:                 text("id").primaryKey(),
  meetingId:          text("meeting_id").notNull(),
  candidateId:        text("candidate_id").notNull(),
  memberId:           text("member_id"),
  externalInviteeId:  text("external_invitee_id"),
  availability:       text("availability").notNull().default("yes"), // 'yes' | 'maybe' | 'no'
  comment:            text("comment"),
  respondedAt:        integer("responded_at").notNull(),
});

export const meetingNotifications = sqliteTable("meeting_notifications", {
  id:        text("id").primaryKey(),
  meetingId: text("meeting_id").notNull(),
  memberId:  text("member_id").notNull(),
  type:      text("type").notNull(),  // 'confirmed' | 'details_updated' | 'invited'
  message:   text("message"),
  readAt:    integer("read_at"),
  createdAt: integer("created_at").notNull(),
});

export const meetingDeclines = sqliteTable(
  "meeting_declines",
  {
    id:          text("id").primaryKey(),
    meetingId:   text("meeting_id").notNull(),
    memberId:    text("member_id").notNull(),
    declinedAt:  integer("declined_at").notNull(),
  },
  (t) => [uniqueIndex("uniq_meeting_decline").on(t.meetingId, t.memberId)]
);

// ---- 定例会（繰り返しミーティング）----
// 「毎週火曜19:00〜20:00」のような繰り返しパターンの候補を複数提示し、参加者の投票で
// 1つに確定させたら、終了条件（日付 or 回数）までの全occurrenceを一括生成する。
// 生成された各回は通常の meetings 行そのもの（meetings.seriesId で紐づく）で、
// 出欠確認・個別回のリスケ/キャンセルは既存の meetings 機能をそのまま使う。
export const meetingSeries = sqliteTable("meeting_series", {
  id:                  text("id").primaryKey(),
  title:               text("title").notNull(),
  description:         text("description"),
  hostMemberId:        text("host_member_id").notNull(),
  scope:               text("scope").notNull(), // 'all' | 'team' | 'collab_team' | 'selected'
  teamId:              text("team_id"),         // scope='team' の場合（ギルド）
  collabTeamId:        text("collab_team_id"),  // scope='collab_team' の場合（パワーチーム/緩いチーム）
  status:              text("status").notNull().default("voting"), // 'voting' | 'confirmed' | 'ended' | 'cancelled'
  confirmedPatternId:  text("confirmed_pattern_id"),
  deadline:            integer("deadline"), // 投票期限（任意）
  endCondition:        text("end_condition"), // 'date' | 'count'（繰り返しパターンのときのみ必須。固定日モードでは不要）
  endDate:             integer("end_date"),
  occurrenceCount:     integer("occurrence_count"),
  conferenceType:      text("conference_type"), // 'manual' | 'google_meet' | 'zoom' | null（各回の会議URLをどう用意するか）
  conferenceUrl:       text("conference_url"),  // conferenceType='manual' の場合の固定URL（毎回同じ会議室URLを使い回す）
  dateMode:            text("date_mode").notNull().default("recurring"), // 'recurring'（繰り返しパターン） | 'fixed'（個別の固定日リスト）
  eventTypeDefId:      text("event_type_def_id"),
  createdAt:           integer("created_at").notNull(),
  updatedAt:           integer("updated_at").notNull(),
});

export const meetingSeriesPatternCandidates = sqliteTable("meeting_series_pattern_candidates", {
  id:              text("id").primaryKey(),
  seriesId:        text("series_id").notNull(),
  recurrenceType:  text("recurrence_type").notNull(), // 'weekly' | 'biweekly' | 'monthly'
  dayOfWeek:       integer("day_of_week").notNull(),  // 0=日 .. 6=土
  weekOfMonth:     integer("week_of_month"),           // 1〜5 or -1(最終週)。monthlyのみ使用
  startTimeLocal:  text("start_time_local").notNull(), // "19:00"（Asia/Tokyo固定）
  endTimeLocal:    text("end_time_local").notNull(),   // "20:00"
  note:            text("note"),
  sortOrder:       integer("sort_order").notNull().default(0),
  isConfirmed:     integer("is_confirmed").notNull().default(0),
});

// dateMode='fixed' の定例会向け：繰り返しパターンではなく、個別に指定した開催日リスト（記録・表示用。
// 実際のoccurrenceは確定時にそのまま meetings 行として一括生成される）
export const meetingSeriesFixedDates = sqliteTable("meeting_series_fixed_dates", {
  id:        text("id").primaryKey(),
  seriesId:  text("series_id").notNull(),
  startsAt:  integer("starts_at").notNull(),
  endsAt:    integer("ends_at").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const meetingSeriesInvitees = sqliteTable("meeting_series_invitees", {
  id:        text("id").primaryKey(),
  seriesId:  text("series_id").notNull(),
  memberId:  text("member_id").notNull(),
});

export const meetingSeriesResponses = sqliteTable("meeting_series_responses", {
  id:            text("id").primaryKey(),
  seriesId:      text("series_id").notNull(),
  candidateId:   text("candidate_id").notNull(),
  memberId:      text("member_id").notNull(),
  availability:  text("availability").notNull().default("yes"), // 'yes' | 'maybe' | 'no'
  comment:       text("comment"),
  respondedAt:   integer("responded_at").notNull(),
});

export const meetingAttendances = sqliteTable("meeting_attendances", {
  id:            text("id").primaryKey(),
  meetingId:     text("meeting_id").notNull(),
  memberId:      text("member_id").notNull(),
  candidateId:   text("candidate_id"),    // 複数確定日程がある場合に参加する日を指定
  status:        text("status").notNull(), // 'attended' | 'absent'
  recordedAt:    integer("recorded_at").notNull(),
  pointsAwarded: integer("points_awarded"),
});

// ---- スケジューラー（1on1日程調整機能 Phase 1）----

export const googleCredentials = sqliteTable("google_credentials", {
  memberId:             text("member_id").primaryKey(),
  googleAccountEmail:   text("google_account_email").notNull(),
  primaryCalendarId:    text("primary_calendar_id").notNull(), // 会議イベントの作成先（書き込み用）。常に "primary"
  // 空き状況判定（freeBusy）の対象カレンダー一覧。JSON配列 [{id, summary}]。
  // 未設定（null）の場合は primaryCalendarId のみを対象にする（連携直後のデフォルト動作）。
  busyCalendars:        text("busy_calendars"),
  accessTokenEnc:       text("access_token_enc").notNull(),
  refreshTokenEnc:      text("refresh_token_enc").notNull(),
  accessTokenExpiresAt: text("access_token_expires_at").notNull(),
  scopes:               text("scopes").notNull(),
  connectedAt:          text("connected_at").notNull(),
  lastRefreshedAt:      text("last_refreshed_at"),
});

export const memberSchedulingSettings = sqliteTable("member_scheduling_settings", {
  memberId:           text("member_id").primaryKey(),
  slug:               text("slug").notNull().unique(), // 廃止済み。公開URLでは使わず、shareToken を使う（過去の名残として列は残す）
  displayTitle:       text("display_title").notNull().default("1on1 ミーティング"),
  description:        text("description"),
  durationMinutes:    integer("duration_minutes").notNull().default(30),
  bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
  bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(10),
  minNoticeMinutes:   integer("min_notice_minutes").notNull().default(1440),
  maxAdvanceDays:     integer("max_advance_days").notNull().default(60),
  dailyMaxBookings:   integer("daily_max_bookings"),
  slotIntervalMinutes: integer("slot_interval_minutes").notNull().default(30),
  locationNote:       text("location_note"),
  isPublic:           integer("is_public").notNull().default(1),
  // 期限付き公開URL（恒久URLの代わり）。発行のたびに新しいトークンに置き換わり、古いものは無効になる。
  shareToken:          text("share_token"),
  shareTokenExpiresAt: integer("share_token_expires_at"),
  // Googleカレンダーの「予定なし」（transparency: transparent）設定の予定も、
  // 空き状況判定では「予定あり（busy）」として扱うかどうか。デフォルトtrue（扱う）。
  treatFreeEventsAsBusy: integer("treat_free_events_as_busy").notNull().default(1),
  // 終日の予定を、その日1日ぶん丸ごとブロックする（busy）として扱うかどうか。
  // デフォルトfalse（終日予定は日付指定なしのタスク等の可能性が高く、ブロックしない）。
  blockAllDayEvents:     integer("block_all_day_events").notNull().default(0),
  createdAt:          text("created_at").notNull(),
  updatedAt:          text("updated_at").notNull(),
});

// 期限付き公開URLの発行履歴。「コピーするたびに新しいリンクを発行」しても、
// 既に相手に送った古いリンクをそのまま無効化しないよう、1メンバーが複数の
// 有効なリンクを同時に持てるようにするためのテーブル
// （member_scheduling_settings.share_token は旧方式（1メンバー1トークン）の名残。新規発行はこちらに一本化）。
export const schedulerShareLinks = sqliteTable("scheduler_share_links", {
  token:     text("token").primaryKey(),
  memberId:  text("member_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const availabilityRules = sqliteTable("availability_rules", {
  id:             text("id").primaryKey(),
  memberId:       text("member_id").notNull(),
  dayOfWeek:      integer("day_of_week").notNull(),
  startTimeLocal: text("start_time_local").notNull(),
  endTimeLocal:   text("end_time_local").notNull(),
  timezone:       text("timezone").notNull().default("Asia/Tokyo"),
});

export const availabilityOverrides = sqliteTable("availability_overrides", {
  id:             text("id").primaryKey(),
  memberId:       text("member_id").notNull(),
  dateLocal:      text("date_local").notNull(),
  isBlocked:      integer("is_blocked").notNull().default(0),
  startTimeLocal: text("start_time_local"),
  endTimeLocal:   text("end_time_local"),
  note:           text("note"),
});

export const bookings = sqliteTable("bookings", {
  id:                   text("id").primaryKey(),
  hostMemberId:         text("host_member_id").notNull(),
  guestMemberId:        text("guest_member_id"),
  guestName:            text("guest_name").notNull(),
  guestEmail:           text("guest_email").notNull(),
  guestMessage:         text("guest_message"),
  guestCompany:         text("guest_company"), // 会社名（正式名）。完了後の外部人脈登録に流用する
  startAtUtc:           text("start_at_utc").notNull(),
  endAtUtc:             text("end_at_utc").notNull(),
  timezone:             text("timezone").notNull(),
  status:               text("status").notNull().default("confirmed"),
  cancellationReason:   text("cancellation_reason"),
  cancellationToken:    text("cancellation_token").notNull(),
  rescheduleToken:      text("reschedule_token").notNull(),
  hostCalendarEventId:  text("host_calendar_event_id"),
  conferenceType:       text("conference_type").notNull().default("manual"),
  conferenceUrl:        text("conference_url"),
  conferenceMetaJson:   text("conference_meta_json"),
  oneOnOneSessionId:    text("one_on_one_session_id"),
  source:               text("source").notNull().default("public"),
  createdAt:            text("created_at").notNull(),
  updatedAt:            text("updated_at").notNull(),
  externalContactId:    text("external_contact_id"),
  guestFollowupDismissedAt: text("guest_followup_dismissed_at"),
  guestFollowupOutcome: text("guest_followup_outcome"), // 'not_held' | 'no_add'（"人脈に追加する"を選んだ場合は externalContactId が入るため null のまま）
});

export const bookingEvents = sqliteTable("booking_events", {
  id:          text("id").primaryKey(),
  bookingId:   text("booking_id").notNull(),
  eventType:   text("event_type").notNull(),
  actorKind:   text("actor_kind").notNull(),
  actorId:     text("actor_id"),
  payloadJson: text("payload_json"),
  occurredAt:  text("occurred_at").notNull(),
});

export const reminderJobs = sqliteTable("reminder_jobs", {
  id:          text("id").primaryKey(),
  bookingId:   text("booking_id").notNull(),
  remindAtUtc: text("remind_at_utc").notNull(),
  kind:        text("kind").notNull(),
  recipient:   text("recipient").notNull(),
  status:      text("status").notNull().default("scheduled"),
  sentAt:      text("sent_at"),
});

export const zoomCredentials = sqliteTable("zoom_credentials", {
  memberId:             text("member_id").primaryKey(),
  zoomAccountEmail:     text("zoom_account_email").notNull().default(""),
  zoomUserId:           text("zoom_user_id").notNull().default(""),
  accessTokenEnc:       text("access_token_enc").notNull(),
  refreshTokenEnc:      text("refresh_token_enc").notNull(),
  accessTokenExpiresAt: text("access_token_expires_at").notNull(),
  scopes:               text("scopes").notNull().default(""),
  connectedAt:          text("connected_at").notNull(),
  lastRefreshedAt:      text("last_refreshed_at"),
});

export const cardDesigns = sqliteTable("card_designs", {
  id:                   text("id").primaryKey().default("default"),
  frontFeatureLabel:    text("front_feature_label").notNull().default("USP・SKILLs"),
  frontFeatureSublabel: text("front_feature_sublabel").notNull().default("〜力（チカラ）"),
  backFields:           text("back_fields").notNull(),
  customBackFields:     text("custom_back_fields").notNull().default("[]"),
  appTitle:             text("app_title").notNull().default("白樺クエスト"),
  appLogo:              text("app_logo").notNull().default("🃏"),
  appPointName:         text("app_point_name").notNull().default("pt"),
  termQuest:            text("term_quest").notNull().default("お題"),
  termUsp:              text("term_usp").notNull().default("USP"),
  termOneOnOne:         text("term_one_on_one").notNull().default("1to1"),
  termExternalGuest:    text("term_external_guest").notNull().default("外部ゲスト"),
  termEnishi:           text("term_enishi").notNull().default("ご縁"),
  termBusinessCommunity: text("term_business_community").notNull().default("ビジネスコミュニティ"),
  characterImageKey:    text("character_image_key"),
  timezone:             text("timezone").notNull().default("Asia/Tokyo"),
  theme:                text("theme").notNull().default("playful"), // VALID_THEMES (services/theme.ts) を参照
  // カード作成設定
  cardPrintEnabled:       integer("card_print_enabled").notNull().default(0),
  cardPrintCompanyName:   text("card_print_company_name").notNull().default(""),
  cardPrintCompanyUrl:    text("card_print_company_url").notNull().default(""),
  cardPrintContactPerson: text("card_print_contact_person").notNull().default(""),
  cardPrintContactEmail:  text("card_print_contact_email").notNull().default(""),
  cardPrintContactPhone:  text("card_print_contact_phone").notNull().default(""),
  cardPrintImageOnlyPrice: integer("card_print_image_only_price"),
  cardPrintImageOnlyName: text("card_print_image_only_name").notNull().default("カードイメージデータ作成のみ"),
  cardPrintPlans:         text("card_print_plans").notNull().default("[]"),
  cardPrintThankYouMessage: text("card_print_thank_you_message").notNull().default("ご注文いただきありがとうございました。"),
  systemFromEmail:      text("system_from_email"),              // メール送信元の既定アドレス
  emailCommonHeader:    text("email_common_header"),            // 共通メールヘッダー（全テンプレートに付加）
  emailCommonFooter:    text("email_common_footer"),            // 共通メールフッター（全テンプレートに付加）
  // 日程調整の公開URL（期限付き）の有効期間（時間）。最小6・最大336（2週間）を想定
  schedulerLinkValidityHours: integer("scheduler_link_validity_hours").notNull().default(72),
  updatedAt:            integer("updated_at").notNull(),
  updatedBy:            text("updated_by").notNull(),
});

export const cardOrders = sqliteTable("card_orders", {
  id:              text("id").primaryKey(),
  memberId:        text("member_id").notNull(),
  characterKey:    text("character_key").notNull(),
  characterLabel:  text("character_label").notNull(),
  photoKey:        text("photo_key"),
  address:         text("address"),
  phone:           text("phone"),
  planName:        text("plan_name").notNull(),
  planPrice:       integer("plan_price").notNull(),
  memberSnapshot:  text("member_snapshot").notNull().default("{}"),
  status:          text("status").notNull().default("pending"),
  createdAt:       integer("created_at").notNull(),
  updatedAt:       integer("updated_at").notNull(),
});

// メールテンプレート（管理者が管理画面からカスタマイズできる送信設定）
export const emailTemplates = sqliteTable("email_templates", {
  id:          text("id").primaryKey(),
  emailKey:    text("email_key").notNull().unique(),
  enabled:     integer("enabled").notNull().default(1),  // 0=送信しない
  fromEmail:   text("from_email"),                       // null=システム既定を使用
  subject:     text("subject").notNull(),
  bodyHtml:             text("body_html").notNull(),
  disableCommonHeader:  integer("disable_common_header").notNull().default(0),  // 1=共通ヘッダーを使わない
  disableCommonFooter:  integer("disable_common_footer").notNull().default(0),  // 1=共通フッターを使わない
  updatedAt:            integer("updated_at").notNull(),
});

// Web Push購読情報。1メンバーが複数端末/ブラウザを登録できるよう member_id は複数行持てる。
// endpoint はブラウザのpushサービスごとに一意なURLのため、それ自体をユニークキーにする。
export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id:        text("id").primaryKey(),
  memberId:  text("member_id").notNull(),
  endpoint:  text("endpoint").notNull().unique(),
  p256dh:    text("p256dh").notNull(),
  auth:      text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: integer("created_at").notNull(),
});
