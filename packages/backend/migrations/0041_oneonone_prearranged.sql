-- =============================================================
-- 1to1: 日程指定申込（prearranged）対応 + 既存データの不整合修正
-- =============================================================

-- メール等での未ログイン承諾/辞退用トークン
ALTER TABLE one_on_one_sessions ADD COLUMN response_token TEXT;

-- 既に日程調整（予約）が完了しているのに、ステータスがpendingのまま残っている
-- 既存データを修正する（本来は予約確定＝承諾とみなすべきだったもの）
UPDATE one_on_one_sessions
SET status = 'accepted', responded_at = scheduled_for
WHERE status = 'pending' AND scheduled_for IS NOT NULL;
