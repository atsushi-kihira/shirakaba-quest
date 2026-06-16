-- USP承認申請テーブル
CREATE TABLE IF NOT EXISTS usp_requests (
  id              TEXT PRIMARY KEY,
  requester_email TEXT NOT NULL,
  requester_name  TEXT NOT NULL DEFAULT '',
  usp_name        TEXT NOT NULL,
  emoji           TEXT NOT NULL DEFAULT '⭐',
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  review_note     TEXT,
  reviewed_by     TEXT,
  reviewed_at     INTEGER,
  created_at      INTEGER NOT NULL
);
