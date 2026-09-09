CREATE TABLE meeting_declines (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  declined_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_meeting_declines_unique ON meeting_declines(meeting_id, member_id);

ALTER TABLE meetings ADD COLUMN last_reminder_sent_at INTEGER;
