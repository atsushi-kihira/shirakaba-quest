-- ミーティング・定例会の「説明」に添付する画像・ファイル
--   owner_type : 'meeting'（ミーティング）または 'series'（定例会）。定例会の各回には、定例会の添付が表示される
--   owner_id   : 添付先のID。アップロードしただけでまだ会を作っていない間は NULL
--   uploader_id: アップロードした人（会に結びつく前は、この人だけが見られる）
--   r2_key     : ファイル本体の保存場所（R2）
CREATE TABLE meeting_attachments (
  id           TEXT PRIMARY KEY,
  owner_type   TEXT,
  owner_id     TEXT,
  uploader_id  TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  r2_key       TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_meeting_attachments_owner ON meeting_attachments(owner_type, owner_id);
CREATE INDEX idx_meeting_attachments_uploader ON meeting_attachments(uploader_id);
