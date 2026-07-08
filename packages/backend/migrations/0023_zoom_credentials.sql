-- Zoom OAuth 認証情報テーブル
CREATE TABLE IF NOT EXISTS zoom_credentials (
  member_id              TEXT PRIMARY KEY,
  zoom_account_email     TEXT NOT NULL DEFAULT '',
  zoom_user_id           TEXT NOT NULL DEFAULT '',
  access_token_enc       TEXT NOT NULL,
  refresh_token_enc      TEXT NOT NULL,
  access_token_expires_at TEXT NOT NULL,
  scopes                 TEXT NOT NULL DEFAULT '',
  connected_at           TEXT NOT NULL,
  last_refreshed_at      TEXT
);
