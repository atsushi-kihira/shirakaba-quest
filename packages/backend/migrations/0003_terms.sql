-- 用語カスタマイズ: お題・USP・1to1 の表示名を変更可能にする
ALTER TABLE card_designs ADD COLUMN term_quest TEXT NOT NULL DEFAULT 'お題';
ALTER TABLE card_designs ADD COLUMN term_usp TEXT NOT NULL DEFAULT 'USP';
ALTER TABLE card_designs ADD COLUMN term_one_on_one TEXT NOT NULL DEFAULT '1to1';
