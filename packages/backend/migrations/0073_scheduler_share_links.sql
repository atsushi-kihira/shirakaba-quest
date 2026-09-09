CREATE TABLE scheduler_share_links (
  token TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_scheduler_share_links_member ON scheduler_share_links(member_id, created_at);

-- 既存の（旧方式・1メンバー1トークンの）有効なリンクを新テーブルへ引き継ぐ。
-- これをしないと、デプロイ直後に既に相手へ送信済みのリンクが即座に無効化されてしまう。
INSERT INTO scheduler_share_links (token, member_id, expires_at, created_at)
SELECT share_token, member_id, share_token_expires_at, strftime('%s', 'now')
FROM member_scheduling_settings
WHERE share_token IS NOT NULL AND share_token_expires_at IS NOT NULL;
