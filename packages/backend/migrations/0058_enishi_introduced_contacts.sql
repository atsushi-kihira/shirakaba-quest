-- ご縁さがし「貢献のご縁」: 「紹介しました」とチェックされた組み合わせ（自分の人脈×相手の金の卵/ガチョウ）
CREATE TABLE enishi_introduced_contacts (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  my_contact_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_enishi_introduced_contacts_unique ON enishi_introduced_contacts(member_id, my_contact_id, candidate_id);
