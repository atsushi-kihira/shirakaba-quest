-- メンバー・外部人脈の「所在地（都道府県）」
--   prefecture            : 都道府県名（例: 東京都）。日本国外のみの会社は「海外」。未判定は NULL
--   prefecture_status     : 'pending'（これから調べる）| 'processing'（調べている最中）| 'done'（調べて入力した）
--                           | 'not_found'（調べたが分からなかった）| 'manual'（本人・管理者が手で入力した）| 'error'（調べに失敗した）
--   prefecture_claimed_at : 'processing' にした時刻（一定時間たっても終わらない行を、再度調べるために使う）
ALTER TABLE members ADD COLUMN prefecture TEXT;
ALTER TABLE members ADD COLUMN prefecture_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE members ADD COLUMN prefecture_claimed_at INTEGER;

ALTER TABLE external_contacts ADD COLUMN prefecture TEXT;
ALTER TABLE external_contacts ADD COLUMN prefecture_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE external_contacts ADD COLUMN prefecture_claimed_at INTEGER;
