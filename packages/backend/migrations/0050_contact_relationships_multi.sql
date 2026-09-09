-- 人脈の「関係性」は複数所属（例: BNIであり倫理法人会でもある）に対応するため、
-- external_contacts の単一カラムから多対多の中間テーブルへ移行する。
CREATE TABLE external_contact_relationships (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  relationship TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_contact_relationships_unique ON external_contact_relationships(contact_id, relationship);
CREATE INDEX idx_contact_relationships_contact ON external_contact_relationships(contact_id);

-- 既存の単一値を新テーブルへ移行
INSERT INTO external_contact_relationships (id, contact_id, relationship, created_at)
SELECT lower(hex(randomblob(16))), id, relationship, created_at
FROM external_contacts
WHERE relationship IS NOT NULL AND relationship != '';

ALTER TABLE external_contacts DROP COLUMN relationship;
