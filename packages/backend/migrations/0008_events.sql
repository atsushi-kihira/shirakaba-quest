-- =============================================================
-- 0008_events.sql — 期間限定イベント
-- =============================================================

CREATE TABLE IF NOT EXISTS event_campaigns (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL,
  -- special_quest_week | welcome_quest | featured_member | visitor_invite_quest
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  starts_at         INTEGER NOT NULL,
  ends_at           INTEGER,
  related_member_id TEXT,
  multiplier        INTEGER,
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS visitor_invites (
  id             TEXT PRIMARY KEY,
  member_id      TEXT NOT NULL,
  visitor_name   TEXT NOT NULL DEFAULT '',
  attended_at    INTEGER,
  status         TEXT NOT NULL DEFAULT 'pending',
  resolved_at    INTEGER,
  points_awarded INTEGER NOT NULL DEFAULT 5,
  created_at     INTEGER NOT NULL
);
