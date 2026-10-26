-- 外部ゲストが回答したときの外部人脈の自動登録で、登録件数の上限（非公開を除いて300件）に達していた場合に、
-- 主催者に「どうするか」を確認するための保留（確認が済むまで、人脈には登録しない）
CREATE TABLE guest_contact_proposals (
  id              TEXT PRIMARY KEY,
  owner_member_id TEXT NOT NULL,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  company         TEXT NOT NULL,
  context         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      INTEGER NOT NULL,
  resolved_at     INTEGER
);
CREATE INDEX idx_guest_contact_proposals_owner ON guest_contact_proposals(owner_member_id, status);
