-- メンバーごとの個人用カラーテーマ設定（未設定 = アプリ全体のテーマに従う）
ALTER TABLE members ADD COLUMN personal_theme text;
