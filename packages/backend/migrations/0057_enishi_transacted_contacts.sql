-- ご縁さがし「私のご縁」: 「既に取引があります」フラグ。立てた本人の今後の検索から
-- その人脈を除外するために使う（本人のみに有効・他ユーザーには影響しない）。
CREATE TABLE enishi_transacted_contacts (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_enishi_transacted_contacts_unique ON enishi_transacted_contacts(member_id, contact_id);
