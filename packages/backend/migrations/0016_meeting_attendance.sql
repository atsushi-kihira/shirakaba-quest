-- ミーティングにイベントキャンペーンIDを追加（本番DBには既に追加済みのためスキップ）
-- ALTER TABLE meetings ADD COLUMN event_campaign_id TEXT;

-- 出席記録テーブル
CREATE TABLE IF NOT EXISTS meeting_attendances (
  id          TEXT    PRIMARY KEY,
  meeting_id  TEXT    NOT NULL,
  member_id   TEXT    NOT NULL,
  status      TEXT    NOT NULL, -- 'attended' | 'absent'
  recorded_at INTEGER NOT NULL,
  points_awarded INTEGER
);

CREATE INDEX IF NOT EXISTS idx_meeting_att_meeting ON meeting_attendances(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_att_member  ON meeting_attendances(member_id);
