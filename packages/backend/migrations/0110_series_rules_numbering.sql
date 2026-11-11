-- 定例会の開催ルールと、各回のタイトルの連番
--   skip_holidays       : 1 = 祝日と重なる日は開催しない（その日の回を作らない）
--   excluded_dates_json : 開催しない日（["2026-12-29","2027-01-05"] の形。日本時間の日付）
--   numbered_titles     : 1 = 各回のタイトルに「第N回」の連番をつける（初期値。これまでの定例会はすべて連番あり）／0 = つけない
ALTER TABLE meeting_series ADD COLUMN skip_holidays INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meeting_series ADD COLUMN excluded_dates_json TEXT;
ALTER TABLE meeting_series ADD COLUMN numbered_titles INTEGER NOT NULL DEFAULT 1;
