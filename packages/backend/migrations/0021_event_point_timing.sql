-- event_campaigns: ポイント付与タイミングを追加
ALTER TABLE event_campaigns ADD COLUMN point_award_timing TEXT;

-- イベント参加記録テーブル（重複ポイント防止）
CREATE TABLE IF NOT EXISTS event_participations (
  id TEXT PRIMARY KEY,
  event_campaign_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_part_unique
  ON event_participations(event_campaign_id, member_id);
