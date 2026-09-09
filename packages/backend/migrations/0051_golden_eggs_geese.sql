-- ご縁さがし機能: 金の卵（狙いたい案件・紹介先）・金のガチョウ（運んでくれそうな立場）
CREATE TABLE golden_eggs (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  description TEXT NOT NULL,
  issue TEXT,
  price_range TEXT,
  region TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_golden_eggs_member ON golden_eggs(member_id);

CREATE TABLE golden_geese (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  description TEXT NOT NULL,
  contact_hypothesis TEXT,
  priority TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_golden_geese_member ON golden_geese(member_id);
