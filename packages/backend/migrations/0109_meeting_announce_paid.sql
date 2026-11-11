-- ミーティング・定例会の「開催のしかた」オプション
--   no_attendance_check : 1 = あらかじめ出欠を確認しない（対象者へのお知らせのみ。直前のリマインド・ホーム・通知への表示は通常どおり）
--   is_paid / fee_amount / fee_note : 有料の会（参加費の金額（円）と、支払い方法などの補足）
-- 定例会（meeting_series）に設定した内容は、生成される各開催回（meetings）にも引き継ぐ
ALTER TABLE meetings ADD COLUMN no_attendance_check INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meetings ADD COLUMN is_paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meetings ADD COLUMN fee_amount INTEGER;
ALTER TABLE meetings ADD COLUMN fee_note TEXT;
ALTER TABLE meeting_series ADD COLUMN no_attendance_check INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meeting_series ADD COLUMN is_paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meeting_series ADD COLUMN fee_amount INTEGER;
ALTER TABLE meeting_series ADD COLUMN fee_note TEXT;
