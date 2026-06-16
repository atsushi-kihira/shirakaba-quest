-- =============================================================
-- 0009_teams.sql — チーム対抗戦
-- =============================================================

CREATE TABLE IF NOT EXISTS teams (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  emblem_emoji TEXT NOT NULL DEFAULT '🦊',
  season_id    TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
  id        TEXT PRIMARY KEY,
  team_id   TEXT NOT NULL,
  member_id TEXT NOT NULL,
  is_leader INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  UNIQUE(team_id, member_id)
);
