-- メンバーのアクセス記録（管理画面の「利用状況」のアクセス数グラフ用）。
-- アプリを開いたとき（ログイン情報の取得時）に1行記録する。同じメンバーの5分以内の連続アクセスは1回として数える。
CREATE TABLE access_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id  TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_access_logs_created ON access_logs(created_at);
CREATE INDEX idx_access_logs_member ON access_logs(member_id, created_at);
