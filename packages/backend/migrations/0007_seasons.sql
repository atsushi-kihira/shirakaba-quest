-- =============================================================
-- 0007_seasons.sql — シーズン制
-- =============================================================

CREATE TABLE IF NOT EXISTS seasons (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  theme      TEXT NOT NULL DEFAULT '',
  starts_at  INTEGER NOT NULL,
  ends_at    INTEGER,
  is_active  INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS season_rankings (
  id        TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  points    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(season_id, member_id)
);
