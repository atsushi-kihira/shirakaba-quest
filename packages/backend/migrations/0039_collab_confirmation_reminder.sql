-- =============================================================
-- 1to1完了後の「協業可能性・リファーラル」未確認リマインダー用
-- 各側が最後に確認を求められた／答えた時点の one_on_one_count を記録し、
-- 現在の one_on_one_count と比較することで「未確認の1to1がある」を検知する。
-- 既存行は 0 で初期化し、過去の未確認履歴もリマインダー対象として洗い出す。
-- =============================================================
ALTER TABLE collaboration_links ADD COLUMN prompted_count_low INTEGER NOT NULL DEFAULT 0;
ALTER TABLE collaboration_links ADD COLUMN prompted_count_high INTEGER NOT NULL DEFAULT 0;
