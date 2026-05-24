-- ================================================================
-- 白樺クエスト — D1 初期マイグレーション
-- ================================================================

-- メンバー
CREATE TABLE IF NOT EXISTS members (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  furigana    TEXT NOT NULL DEFAULT '',
  romaji      TEXT,
  emoji       TEXT NOT NULL DEFAULT '🙂',
  bg_color    TEXT NOT NULL DEFAULT 'bg-amber-100',

  -- 個人情報（1to1完了後に開示）
  company     TEXT,
  role        TEXT,
  phone       TEXT,
  address     TEXT,

  -- 補足情報（常時公開）
  category    TEXT NOT NULL DEFAULT '',
  business_description TEXT NOT NULL DEFAULT '',

  -- スキル（JSON: Skill[]、必ず3つ）
  skills      TEXT NOT NULL DEFAULT '[]',

  -- SNS等（JSON）
  qr_code_url   TEXT,
  facebook_url  TEXT,
  linkedin_url  TEXT,
  instagram_url TEXT,
  custom_fields TEXT DEFAULT '{}',

  status       TEXT NOT NULL DEFAULT 'pending',
  approved_at  INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- 管理者
CREATE TABLE IF NOT EXISTS admins (
  id         TEXT PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'admin',
  created_at INTEGER NOT NULL
);

-- 認証セッション（tokenはハッシュ化して保存）
CREATE TABLE IF NOT EXISTS auth_sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  user_type   TEXT NOT NULL,   -- 'member' | 'admin'
  token_hash  TEXT NOT NULL,   -- SHA-256(rawToken) をhex文字列で
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

-- メンバー間の関係
CREATE TABLE IF NOT EXISTS connections (
  id                        TEXT PRIMARY KEY,
  from_member_id            TEXT NOT NULL,
  to_member_id              TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'none',
  one_on_one_requested_at   INTEGER,
  one_on_one_accepted_at    INTEGER,
  one_on_one_completed_at   INTEGER,
  real_card_received_at     INTEGER,
  UNIQUE(from_member_id, to_member_id)
);

-- 1to1 セッション
CREATE TABLE IF NOT EXISTS one_on_one_sessions (
  id                      TEXT PRIMARY KEY,
  requester_id            TEXT NOT NULL,
  responder_id            TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending',
  requested_at            INTEGER NOT NULL,
  responded_at            INTEGER,
  scheduled_for           INTEGER,
  requester_completed_at  INTEGER,
  responder_completed_at  INTEGER,
  completed_at            INTEGER
);

-- クエスト（お題）
CREATE TABLE IF NOT EXISTS quests (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  story               TEXT NOT NULL,
  emoji               TEXT NOT NULL DEFAULT '📋',
  level               TEXT NOT NULL DEFAULT 'normal',
  skill_count         INTEGER NOT NULL,
  answer_skills       TEXT NOT NULL DEFAULT '[]',  -- JSON: string[]（非公開）
  required_2x         INTEGER,
  reward              INTEGER NOT NULL DEFAULT 5,
  status              TEXT NOT NULL DEFAULT 'draft',
  deadline            INTEGER,
  published_at        INTEGER,
  source              TEXT NOT NULL DEFAULT 'manual',
  ai_original_prompt  TEXT,
  ai_prompt_history   TEXT DEFAULT '[]',
  created_by          TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

-- クエスト挑戦記録
CREATE TABLE IF NOT EXISTS quest_attempts (
  id                    TEXT PRIMARY KEY,
  quest_id              TEXT NOT NULL,
  member_id             TEXT NOT NULL,
  selected_skill_names  TEXT NOT NULL DEFAULT '[]',
  is_correct            INTEGER NOT NULL DEFAULT 0,
  attempted_at          INTEGER NOT NULL
);

-- ポイント履歴
CREATE TABLE IF NOT EXISTS point_transactions (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL,
  delta       INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  related_id  TEXT,
  created_at  INTEGER NOT NULL
);

-- カード設計（全体で基本1レコード）
CREATE TABLE IF NOT EXISTS card_designs (
  id                    TEXT PRIMARY KEY DEFAULT 'default',
  front_feature_label   TEXT NOT NULL DEFAULT 'USP・SKILLs',
  front_feature_sublabel TEXT NOT NULL DEFAULT '〜力（チカラ）',
  back_fields           TEXT NOT NULL DEFAULT '{"role":true,"nameKanji":true,"nameRomaji":true,"companyName":true,"address":false,"phone":true,"email":true,"qrCode":false,"facebook":false,"linkedin":false,"instagram":false}',
  custom_back_fields    TEXT NOT NULL DEFAULT '[]',
  app_title             TEXT NOT NULL DEFAULT '白樺クエスト',
  app_logo              TEXT NOT NULL DEFAULT '🃏',
  app_point_name        TEXT NOT NULL DEFAULT 'pt',
  updated_at            INTEGER NOT NULL,
  updated_by            TEXT NOT NULL DEFAULT 'system'
);

-- ================================================================
-- インデックス
-- ================================================================
CREATE INDEX IF NOT EXISTS idx_members_email       ON members(email);
CREATE INDEX IF NOT EXISTS idx_members_status      ON members(status);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_hash  ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user  ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_connections_from    ON connections(from_member_id);
CREATE INDEX IF NOT EXISTS idx_connections_to      ON connections(to_member_id);
CREATE INDEX IF NOT EXISTS idx_oo_sessions_req     ON one_on_one_sessions(requester_id);
CREATE INDEX IF NOT EXISTS idx_oo_sessions_res     ON one_on_one_sessions(responder_id);
CREATE INDEX IF NOT EXISTS idx_quests_status       ON quests(status);
CREATE INDEX IF NOT EXISTS idx_quest_attempts_mem  ON quest_attempts(member_id, quest_id);
CREATE INDEX IF NOT EXISTS idx_point_tx_member     ON point_transactions(member_id, created_at);

-- ================================================================
-- 初期データ: カード設計レコード（なければ作る）
-- ================================================================
INSERT OR IGNORE INTO card_designs (id, updated_at, updated_by)
VALUES ('default', unixepoch(), 'system');
