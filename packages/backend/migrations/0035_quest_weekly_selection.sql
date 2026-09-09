-- =============================================================
-- 「今週のクエスト」選出テーブル
-- =============================================================
CREATE TABLE quest_weekly_selections (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL,
  week_start  INTEGER NOT NULL,
  quest_id    TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_qws_member_week ON quest_weekly_selections(member_id, week_start);
CREATE UNIQUE INDEX idx_qws_member_week_quest ON quest_weekly_selections(member_id, week_start, quest_id);
