-- メンバーが画面を開いた（ホーム・ミーティング・通知などを見た）記録。管理画面の利用状況の「情報参照」件数に使う。
-- 同じメンバー・同じ画面の5分以内の連続閲覧は1回として数える。
CREATE TABLE screen_views (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id  TEXT NOT NULL,
  screen     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_screen_views_created ON screen_views(created_at);
CREATE INDEX idx_screen_views_member_screen ON screen_views(member_id, screen, created_at);
