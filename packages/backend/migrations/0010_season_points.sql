-- シーズン別ポイント設定カラムを追加
ALTER TABLE seasons ADD COLUMN point_one_on_one INTEGER DEFAULT 1;
ALTER TABLE seasons ADD COLUMN point_real_card INTEGER DEFAULT 1;
ALTER TABLE seasons ADD COLUMN point_quest_normal INTEGER DEFAULT 5;
ALTER TABLE seasons ADD COLUMN point_quest_hard INTEGER DEFAULT 10;
ALTER TABLE seasons ADD COLUMN point_welcome_quest_bonus INTEGER DEFAULT 1;
