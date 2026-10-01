-- Googleカレンダー連携を「1メンバー1アカウント」から「1メンバー複数アカウント」へ変更する。
-- 自動で予定を作成する処理（会議URL発行・ダブルブッキング防止のブロック予定等）は、
-- is_default=1の1件だけを使う。既存データは全件そのままdefaultアカウントとして移行する。

CREATE TABLE google_calendar_accounts (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  google_account_email TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  primary_calendar_id TEXT NOT NULL,
  busy_calendars TEXT,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  access_token_expires_at TEXT NOT NULL,
  scopes TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  last_refreshed_at TEXT
);

CREATE INDEX idx_google_calendar_accounts_member ON google_calendar_accounts(member_id);

INSERT INTO google_calendar_accounts (
  id, member_id, google_account_email, is_default, primary_calendar_id, busy_calendars,
  access_token_enc, refresh_token_enc, access_token_expires_at, scopes, connected_at, last_refreshed_at
)
SELECT
  lower(hex(randomblob(16))), member_id, google_account_email, 1, primary_calendar_id, busy_calendars,
  access_token_enc, refresh_token_enc, access_token_expires_at, scopes, connected_at, last_refreshed_at
FROM google_credentials;

DROP TABLE google_credentials;
