-- メンバー本人によるメールアドレス変更の申請。
-- 新しいメールアドレスに届く確認リンク（token）を開いた時点で、メンバーのメールアドレスを切り替える。
CREATE TABLE email_change_requests (
  token      TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL,
  new_email  TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_email_change_requests_member ON email_change_requests(member_id);
