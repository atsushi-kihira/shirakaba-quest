-- チームの「次回までのアクション」テーブル。特定の投稿に紐づく一時的なメモではなく、
-- 完了するまでチームに永続する（毎回の活動投稿で未完了分を引き継いで表示するため）。

CREATE TABLE collab_team_action_items (
  id                  TEXT PRIMARY KEY,
  team_id             TEXT NOT NULL,
  task                TEXT NOT NULL,
  assignee_member_id  TEXT,
  due_date            TEXT,
  completed           INTEGER NOT NULL DEFAULT 0,
  completed_at        INTEGER,
  created_by_post_id  TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX idx_collab_team_action_items_team ON collab_team_action_items (team_id);
