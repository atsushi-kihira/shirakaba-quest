-- 共通メールヘッダー・フッター（card_designs テーブル）
ALTER TABLE card_designs ADD COLUMN email_common_header TEXT;
ALTER TABLE card_designs ADD COLUMN email_common_footer TEXT;

-- テンプレートごとの無効化フラグ（email_templates テーブル）
ALTER TABLE email_templates ADD COLUMN disable_common_header INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_templates ADD COLUMN disable_common_footer INTEGER NOT NULL DEFAULT 0;
