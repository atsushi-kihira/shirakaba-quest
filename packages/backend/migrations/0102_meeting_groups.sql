-- ミーティング・定例会の対象者を、あらかじめ作っておいた「グループ」で指定できるようにする
-- ・meeting_groups: 利用者が個人で作るグループ（作った本人だけが使える）
-- ・meeting_group_members / meeting_group_guests: グループに入れるメンバーと、外部ゲスト（名前とメールアドレス）
-- ・meetings.group_id / meeting_series.group_id: グループで作成したミーティング・定例会。
--   グループに後から人が加わると、これらの未実施のミーティング・定例会（確定済みの回を含む）にも招待される
CREATE TABLE meeting_groups (
  id              TEXT PRIMARY KEY,
  owner_member_id TEXT NOT NULL,
  name            TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_meeting_groups_owner ON meeting_groups(owner_member_id);

CREATE TABLE meeting_group_members (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uniq_meeting_group_member ON meeting_group_members(group_id, member_id);

CREATE TABLE meeting_group_guests (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  contact_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uniq_meeting_group_guest_email ON meeting_group_guests(group_id, email);

ALTER TABLE meetings ADD COLUMN group_id TEXT;
ALTER TABLE meeting_series ADD COLUMN group_id TEXT;
CREATE INDEX idx_meetings_group ON meetings(group_id);
CREATE INDEX idx_meeting_series_group ON meeting_series(group_id);
