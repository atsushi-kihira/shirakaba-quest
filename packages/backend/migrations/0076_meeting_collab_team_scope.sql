-- 個別ミーティング・定例会の対象者に「チーム（パワーチーム/ゆるいチーム）」「全員」「ギルド」を
-- 一貫して指定できるようにするための列追加。
ALTER TABLE meetings ADD COLUMN collab_team_id TEXT;
ALTER TABLE meeting_series ADD COLUMN team_id TEXT;
