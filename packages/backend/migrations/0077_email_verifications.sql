-- 手入力でのメンバー登録時、プロフィール入力後にメールアドレスの所有確認を行うためのトークン管理テーブル。
CREATE TABLE email_verifications (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  verified_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_email_verifications_email ON email_verifications (email);
