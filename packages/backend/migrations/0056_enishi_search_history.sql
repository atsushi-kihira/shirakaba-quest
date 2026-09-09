-- ご縁さがしの検索履歴（結果の保存・「良いご縁だった」フラグはresult_json内のカードごとに保持）
CREATE TABLE enishi_search_history (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  title TEXT NOT NULL,
  params_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_enishi_search_history_member ON enishi_search_history(member_id, created_at);
