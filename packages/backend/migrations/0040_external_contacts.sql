-- =============================================================
-- 人脈レイヤー（外部人脈・紹介依頼）
-- 連絡先情報（メール・電話・住所・SNS）は設計上保持しない。
-- =============================================================
CREATE TABLE external_contacts (
  id              TEXT PRIMARY KEY,
  owner_member_id TEXT NOT NULL,
  name            TEXT NOT NULL,
  specialty       TEXT,
  company         TEXT,
  note            TEXT,
  visibility      TEXT NOT NULL DEFAULT 'existence',
  source          TEXT NOT NULL DEFAULT 'manual',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_external_contacts_owner ON external_contacts(owner_member_id);

CREATE TABLE collab_intro_requests (
  id              TEXT PRIMARY KEY,
  contact_id      TEXT NOT NULL,
  owner_member_id TEXT NOT NULL,
  requester_id    TEXT NOT NULL,
  message         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      INTEGER NOT NULL,
  responded_at    INTEGER
);
CREATE INDEX idx_collab_intro_requests_owner ON collab_intro_requests(owner_member_id, status);
CREATE INDEX idx_collab_intro_requests_contact ON collab_intro_requests(contact_id);
