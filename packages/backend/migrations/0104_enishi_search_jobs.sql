-- 「私のご縁」「人脈をさがす」を、裏で実行して終わったら通知するための検索ジョブ
--   stage  : 'prepare'（候補を束に分ける）→ 'match'（束ごとにAIで照合）→ 'members'（メンバー本人の検索）
--            → 'collab'（協業イメージ）→ 'finalize'（結果を組み立てて履歴に保存・通知）
--   status : 'running' | 'done' | 'error'
--   claimed_at : いま処理している最中の目印（二重に処理しないための貸し出し。一定時間たつと無効）
CREATE TABLE enishi_search_jobs (
  id              TEXT PRIMARY KEY,
  member_id       TEXT NOT NULL,
  mode            TEXT NOT NULL,
  params_json     TEXT NOT NULL,
  stage           TEXT NOT NULL DEFAULT 'prepare',
  status          TEXT NOT NULL DEFAULT 'running',
  stage_attempts  INTEGER NOT NULL DEFAULT 0,
  total_batches   INTEGER NOT NULL DEFAULT 0,
  done_batches    INTEGER NOT NULL DEFAULT 0,
  failed_batches  INTEGER NOT NULL DEFAULT 0,
  truncated       INTEGER NOT NULL DEFAULT 0,
  members_json    TEXT,
  collab_json     TEXT,
  history_id      TEXT,
  result_count    INTEGER,
  error_message   TEXT,
  claimed_at      INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_enishi_search_jobs_member ON enishi_search_jobs(member_id, created_at);

-- 検索ジョブを分けた「束」ごとの進み具合と照合結果
CREATE TABLE enishi_search_job_batches (
  job_id            TEXT NOT NULL,
  idx               INTEGER NOT NULL,
  candidate_ids_json TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'processing' | 'done' | 'failed'
  attempts          INTEGER NOT NULL DEFAULT 0,
  matches_json      TEXT,
  PRIMARY KEY (job_id, idx)
);
