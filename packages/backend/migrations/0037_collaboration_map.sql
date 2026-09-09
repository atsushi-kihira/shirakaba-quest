-- =============================================================
-- 協働マップ基盤（協働リンク・協働チーム）
-- =============================================================
CREATE TABLE collaboration_links (
  id                TEXT PRIMARY KEY,
  member_low_id     TEXT NOT NULL,
  member_high_id    TEXT NOT NULL,
  one_on_one_count  INTEGER NOT NULL DEFAULT 0,
  last_activity_at  INTEGER,
  possible_low      INTEGER NOT NULL DEFAULT 0,
  possible_high     INTEGER NOT NULL DEFAULT 0,
  referral_low      INTEGER NOT NULL DEFAULT 0,
  referral_high     INTEGER NOT NULL DEFAULT 0,
  stage             TEXT NOT NULL DEFAULT 'one',
  stalled           TEXT NOT NULL DEFAULT 'active',
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE UNIQUE INDEX uniq_collab_link ON collaboration_links(member_low_id, member_high_id);

CREATE TABLE collab_teams (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  archived   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE collab_team_members (
  id           TEXT PRIMARY KEY,
  team_id      TEXT NOT NULL,
  member_id    TEXT NOT NULL,
  status       TEXT NOT NULL,
  invited_by   TEXT,
  responded_at INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX uniq_collab_team_member ON collab_team_members(team_id, member_id);
CREATE INDEX idx_collab_team_members_member ON collab_team_members(member_id);

-- 既存の完了済み1to1から初期データをバックフィル（入力ゼロで立ち上がる）
INSERT INTO collaboration_links (
  id, member_low_id, member_high_id, one_on_one_count, last_activity_at,
  possible_low, possible_high, referral_low, referral_high, stage, stalled,
  created_at, updated_at
)
SELECT
  lower(hex(randomblob(16))),
  CASE WHEN requester_id < responder_id THEN requester_id ELSE responder_id END,
  CASE WHEN requester_id < responder_id THEN responder_id ELSE requester_id END,
  COUNT(*),
  MAX(completed_at),
  0, 0, 0, 0, 'one', 'active',
  strftime('%s', 'now'), strftime('%s', 'now')
FROM one_on_one_sessions
WHERE status = 'completed'
GROUP BY
  CASE WHEN requester_id < responder_id THEN requester_id ELSE responder_id END,
  CASE WHEN requester_id < responder_id THEN responder_id ELSE requester_id END;
