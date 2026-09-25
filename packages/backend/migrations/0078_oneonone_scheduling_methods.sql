-- 1to1日程調整フロー刷新: 候補日提示型・外部ゲスト招待・会議URL「none/unresolved」区別

ALTER TABLE one_on_one_sessions ADD COLUMN arrangement_method TEXT NOT NULL DEFAULT 'public_url';
ALTER TABLE one_on_one_sessions ADD COLUMN selected_candidate_slot_id TEXT;
ALTER TABLE one_on_one_sessions ADD COLUMN conference_url_status TEXT;

CREATE TABLE one_on_one_candidate_slots (
  id TEXT PRIMARY KEY,
  one_on_one_session_id TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_oneonone_candidate_slots_session ON one_on_one_candidate_slots(one_on_one_session_id);

CREATE TABLE one_on_one_guest_invites (
  id TEXT PRIMARY KEY,
  host_member_id TEXT NOT NULL,
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  arrangement_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at INTEGER NOT NULL,
  custom_title TEXT,
  custom_duration_minutes INTEGER,
  custom_note TEXT,
  selected_slot_id TEXT,
  resulting_booking_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_oneonone_guest_invites_host ON one_on_one_guest_invites(host_member_id, created_at);

CREATE TABLE one_on_one_guest_invite_candidate_slots (
  id TEXT PRIMARY KEY,
  invite_id TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_oneonone_guest_invite_candidate_slots_invite ON one_on_one_guest_invite_candidate_slots(invite_id);

ALTER TABLE bookings ADD COLUMN guest_invite_id TEXT;
ALTER TABLE bookings ADD COLUMN conference_url_status TEXT;
