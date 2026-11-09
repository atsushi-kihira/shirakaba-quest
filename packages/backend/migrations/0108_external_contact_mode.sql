-- 「外部の方との連絡」の主な手段（管理ダッシュボードのアプリ設定）
--   'email' : メール主体（初期設定）。1to1で外部の方を招待するとき、「相手にメールで案内する」が最初からオン
--   'dm'    : DM主体。同じチェックが最初からオフ（招待URLを、LINE・Messengerなどで直接送る）
ALTER TABLE card_designs ADD COLUMN external_contact_mode TEXT NOT NULL DEFAULT 'email';
