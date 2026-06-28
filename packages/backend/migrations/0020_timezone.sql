-- タイムゾーン設定を追加
-- card_designs: システム全体のデフォルトタイムゾーン
ALTER TABLE card_designs ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo';
-- members: メンバー個人のタイムゾーン設定（NULL の場合はシステムデフォルトを使用）
ALTER TABLE members ADD COLUMN timezone TEXT;
