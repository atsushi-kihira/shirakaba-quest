-- 協働の活動タイムライン: 投稿へのコメント・コメントへのいいね・既読管理
CREATE TABLE collaboration_comments (
  id text PRIMARY KEY NOT NULL,
  post_id text NOT NULL,
  author_id text NOT NULL,
  body text NOT NULL,
  created_at integer NOT NULL,
  deleted_at integer
);

CREATE TABLE collaboration_comment_reactions (
  id text PRIMARY KEY NOT NULL,
  comment_id text NOT NULL,
  member_id text NOT NULL,
  type text NOT NULL DEFAULT 'like',
  created_at integer NOT NULL
);
CREATE UNIQUE INDEX uniq_collab_comment_reaction ON collaboration_comment_reactions (comment_id, member_id, type);

-- メンバーごとの「協働の活動タイムラインを最後に見た日時」（新着バッジの算出に使う）
CREATE TABLE collab_activity_reads (
  member_id text PRIMARY KEY NOT NULL,
  last_read_at integer NOT NULL
);
