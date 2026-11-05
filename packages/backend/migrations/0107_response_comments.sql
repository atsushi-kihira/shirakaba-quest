-- 日程の回答に添える「一言コメント」
--   ミーティング・定例会（投票）の回答表に、回答した人ごとのコメントを表示する。
--   候補日ごとではなく、「ミーティング（または定例会）1件につき、1人1つ」のコメント。
--   kind      : 'meeting'（ミーティング。定例会の各開催回も含む）／'series'（定例会の投票）
--   target_id : kind='meeting' は meetings.id、kind='series' は meeting_series.id
--   member_id / external_invitee_id : どちらか一方（メンバー／外部ゲスト）
CREATE TABLE response_comments (
  id                   TEXT PRIMARY KEY,
  kind                 TEXT NOT NULL,
  target_id            TEXT NOT NULL,
  member_id            TEXT,
  external_invitee_id  TEXT,
  comment              TEXT NOT NULL,
  updated_at           INTEGER NOT NULL
);
CREATE UNIQUE INDEX uniq_response_comment_member
  ON response_comments (kind, target_id, member_id) WHERE member_id IS NOT NULL;
CREATE UNIQUE INDEX uniq_response_comment_external
  ON response_comments (kind, target_id, external_invitee_id) WHERE external_invitee_id IS NOT NULL;
CREATE INDEX idx_response_comment_member ON response_comments (member_id);

-- 1to1（候補日提示方式）で、相手が日時を選んだときに添えた一言コメント
ALTER TABLE one_on_one_sessions ADD COLUMN selected_comment TEXT;
