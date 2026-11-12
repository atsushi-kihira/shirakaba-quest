-- お繋ぎ（ご紹介）: 紹介者が、メンバーと外部の人をつなぎ、1to1の日程調整は、お繋ぎ先のメンバーが主催者として行う
--   status: 'active'（進行中。「返事待ち」「日程調整中」「確定」などは、外部ゲスト招待・予約から、そのつど導く） | 'declined'（メンバーが見送った） | 'cancelled'（紹介者が取り消した）
--   token: 外部の人に渡す、受付ページのURL用（作った時点で決まり、変わらない）
--   guest_invite_id: メンバーが日程の決め方を選んだときに作る、外部ゲスト招待（one_on_one_guest_invites.id）
CREATE TABLE IF NOT EXISTS otsunagi_requests (
  id                          TEXT PRIMARY KEY,
  introducer_member_id        TEXT NOT NULL,
  member_id                   TEXT NOT NULL,
  guest_name                  TEXT NOT NULL,
  guest_company               TEXT,
  guest_email                 TEXT NOT NULL DEFAULT '',
  guest_email_consent         INTEGER NOT NULL DEFAULT 0,
  message                     TEXT NOT NULL DEFAULT '',
  token                       TEXT NOT NULL UNIQUE,
  status                      TEXT NOT NULL DEFAULT 'active',
  guest_invite_id             TEXT,
  prepared_at                 INTEGER,
  guest_opened_at             INTEGER,
  guest_email_registered_at   INTEGER,
  member_reminded_at          INTEGER,
  guest_remind1_at            INTEGER,
  guest_remind2_at            INTEGER,
  confirmed_notified_at       INTEGER,
  declined_at                 INTEGER,
  expires_at                  INTEGER NOT NULL,
  created_at                  INTEGER NOT NULL,
  updated_at                  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otsunagi_introducer ON otsunagi_requests (introducer_member_id, created_at);
CREATE INDEX IF NOT EXISTS idx_otsunagi_member ON otsunagi_requests (member_id, created_at);
CREATE INDEX IF NOT EXISTS idx_otsunagi_invite ON otsunagi_requests (guest_invite_id);
