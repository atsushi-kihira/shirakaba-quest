-- 複数人ミーティング・定例会の作成時に、外部ゲストを招待できるようにする
-- ・external_contacts.email: 外部人脈のメールアドレス（任意。登録した本人にだけ見える。他のメンバーには返さない）
-- ・invite_reservations: ミーティング・定例会を作る前に発行する「ゲスト用の共有URL」の予約（作成されなかったものは期限で自動削除）
-- ・meeting_external_invitees: 招待メールを送った時刻、人脈から追加した場合の人脈ID
-- ・meeting_series: ゲスト用の共有URLのトークン
-- ・meeting_series_external_invitees / meeting_series_external_responses: 定例会の外部ゲストと、候補パターンへの投票
ALTER TABLE external_contacts ADD COLUMN email TEXT;

ALTER TABLE meeting_external_invitees ADD COLUMN invited_at INTEGER;
ALTER TABLE meeting_external_invitees ADD COLUMN contact_id TEXT;

ALTER TABLE meeting_series ADD COLUMN invite_token TEXT;

CREATE TABLE invite_reservations (
  token          TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,
  host_member_id TEXT NOT NULL,
  expires_at     INTEGER NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_invite_reservations_host ON invite_reservations(host_member_id, kind);
CREATE INDEX idx_invite_reservations_expires ON invite_reservations(expires_at);

CREATE TABLE meeting_series_external_invitees (
  id         TEXT PRIMARY KEY,
  series_id  TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  email      TEXT,
  token      TEXT NOT NULL,
  contact_id TEXT,
  invited_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uniq_series_external_token ON meeting_series_external_invitees(token);
CREATE INDEX idx_series_external_series ON meeting_series_external_invitees(series_id);

CREATE TABLE meeting_series_external_responses (
  id                  TEXT PRIMARY KEY,
  series_id           TEXT NOT NULL,
  candidate_id        TEXT NOT NULL,
  external_invitee_id TEXT NOT NULL,
  availability        TEXT NOT NULL DEFAULT 'yes',
  responded_at        INTEGER NOT NULL
);
CREATE INDEX idx_series_external_responses_series ON meeting_series_external_responses(series_id);
