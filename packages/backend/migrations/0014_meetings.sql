-- ミーティング（日程調整）テーブル群

CREATE TABLE IF NOT EXISTS meetings (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  description      TEXT,
  host_member_id   TEXT NOT NULL,
  scope            TEXT NOT NULL DEFAULT 'all', -- 'all' | 'team' | 'selected'
  team_id          TEXT,
  status           TEXT NOT NULL DEFAULT 'open', -- 'open' | 'confirmed' | 'cancelled'
  confirmed_candidate_id TEXT,
  deadline         INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meeting_date_candidates (
  id          TEXT PRIMARY KEY,
  meeting_id  TEXT NOT NULL,
  starts_at   INTEGER NOT NULL,
  ends_at     INTEGER,
  note        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_meeting_candidates_meeting_id ON meeting_date_candidates(meeting_id);

-- scope=selected 時の招待メンバーリスト
CREATE TABLE IF NOT EXISTS meeting_invitees (
  id          TEXT PRIMARY KEY,
  meeting_id  TEXT NOT NULL,
  member_id   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meeting_invitees_meeting_id ON meeting_invitees(meeting_id);

-- 外部ゲスト（URLトークン）
CREATE TABLE IF NOT EXISTS meeting_external_invitees (
  id          TEXT PRIMARY KEY,
  meeting_id  TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  email       TEXT,
  token       TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meeting_ext_invitees_meeting_id ON meeting_external_invitees(meeting_id);

-- 回答 (member_id と external_invitee_id は一方のみが入る)
CREATE TABLE IF NOT EXISTS meeting_responses (
  id                    TEXT PRIMARY KEY,
  meeting_id            TEXT NOT NULL,
  candidate_id          TEXT NOT NULL,
  member_id             TEXT,
  external_invitee_id   TEXT,
  availability          TEXT NOT NULL DEFAULT 'yes', -- 'yes' | 'maybe' | 'no'
  comment               TEXT,
  responded_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meeting_responses_meeting_id ON meeting_responses(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_responses_candidate_id ON meeting_responses(candidate_id);
