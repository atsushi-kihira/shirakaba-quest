-- ミーティング通知テーブル
CREATE TABLE IF NOT EXISTS meeting_notifications (
  id          TEXT PRIMARY KEY,
  meeting_id  TEXT NOT NULL,
  member_id   TEXT NOT NULL,  -- 通知対象のメンバー
  type        TEXT NOT NULL,  -- 'confirmed' | 'details_updated'
  message     TEXT,
  read_at     INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meeting_notif_member_id ON meeting_notifications(member_id, read_at);
CREATE INDEX IF NOT EXISTS idx_meeting_notif_meeting_id ON meeting_notifications(meeting_id);
