-- 人脈の「お気に入り」（協働の人脈検索から、後で見返したい人にマークする）
CREATE TABLE external_contact_favorites (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_contact_favorites_unique ON external_contact_favorites(member_id, contact_id);
CREATE INDEX idx_contact_favorites_member ON external_contact_favorites(member_id);
