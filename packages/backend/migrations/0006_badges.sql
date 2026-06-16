-- =============================================================
-- 0006_badges.sql — バッジシステム
-- =============================================================

CREATE TABLE IF NOT EXISTS badges (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  emoji          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  condition_type TEXT NOT NULL,
  condition_value INTEGER,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS member_badges (
  id        TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  badge_id  TEXT NOT NULL,
  earned_at INTEGER NOT NULL,
  UNIQUE(member_id, badge_id)
);

-- 初期バッジ5種
INSERT OR IGNORE INTO badges VALUES
  ('badge_first_1on1',   'はじめての1to1',  '🥇', '1to1を初めて完了',        'first_1on1',           1,  10, unixepoch()),
  ('badge_members_10',   'なかま10人達成',  '🤝', 'カード入手数10人以上',    'members_collected_10', 10, 20, unixepoch()),
  ('badge_quest_master', 'クエストマスター', '🧩', 'クエスト正解10問以上',    'quest_master_10',      10, 30, unixepoch()),
  ('badge_real_card_5',  'リアルカード5枚', '🃏', 'リアルカード交換5枚以上', 'real_card_5',          5,  40, unixepoch()),
  ('badge_monthly_mvp',  '月間MVP',         '👑', '月間ポイント獲得1位',     'monthly_mvp',          1,  50, unixepoch());
