-- 「もらった資料のメモ」の拡張
--  ・自分から見た印象、補足情報（議事メモなど）、会社のホームページと事業内容（自動取得）の項目
--  ・紹介できそうな人（メンバー→自分の外部人脈／外部人脈→メンバー）の保存と、重点のチェック
--  ・用語「もらった資料のメモ」を、アプリ設定で変えられるようにする（白樺クエストは「略歴・GAINS・1to1資料の要約」）
ALTER TABLE profile_sheets ADD COLUMN impression TEXT NOT NULL DEFAULT '';           -- 1to1をした自分から見た印象
ALTER TABLE profile_sheets ADD COLUMN supplement TEXT NOT NULL DEFAULT '';           -- 補足情報（議事メモなど、決まった項目に入らないもの）
ALTER TABLE profile_sheets ADD COLUMN company_url TEXT NOT NULL DEFAULT '';          -- 会社のホームページ
ALTER TABLE profile_sheets ADD COLUMN company_description TEXT NOT NULL DEFAULT ''; -- 会社の事業内容（自動取得・編集可）
ALTER TABLE profile_sheets ADD COLUMN company_lookup_status TEXT NOT NULL DEFAULT ''; -- '' | 'pending' | 'done' | 'not_found' | 'error'
ALTER TABLE profile_sheets ADD COLUMN company_lookup_for TEXT NOT NULL DEFAULT '';   -- 自動取得をした会社名（会社名が変わったか見分ける）
ALTER TABLE profile_sheets ADD COLUMN company_lookup_at INTEGER NOT NULL DEFAULT 0;

-- 紹介できそうな人。subject が「なかま」のとき kind='contact'（自分の外部人脈）、subject が「外部人脈」のとき kind='member'（メンバー）
CREATE TABLE IF NOT EXISTS profile_sheet_links (
  id              TEXT PRIMARY KEY,
  owner_member_id TEXT NOT NULL,
  subject_type    TEXT NOT NULL,            -- 'member' | 'contact'
  subject_id      TEXT NOT NULL,
  kind            TEXT NOT NULL,            -- 'contact' | 'member'（紹介の相手の種類）
  target_id       TEXT NOT NULL,
  reason          TEXT NOT NULL DEFAULT '', -- 紹介できそうな理由（AIが書いたもの）
  starred         INTEGER NOT NULL DEFAULT 0, -- 重点（有望）のチェック
  source          TEXT NOT NULL DEFAULT 'ai', -- 'ai' | 'manual'
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_profile_sheet_link ON profile_sheet_links (owner_member_id, subject_type, subject_id, kind, target_id);
CREATE INDEX IF NOT EXISTS idx_profile_sheet_links_subject ON profile_sheet_links (owner_member_id, subject_type, subject_id);

-- 「AIでさがす」の実行の状況（相手ごとに1件。画面で「さがしています…」を出すため）
CREATE TABLE IF NOT EXISTS profile_sheet_match_runs (
  owner_member_id TEXT NOT NULL,
  subject_type    TEXT NOT NULL,
  subject_id      TEXT NOT NULL,
  job_id          TEXT NOT NULL,
  status          TEXT NOT NULL,            -- 'running' | 'done' | 'error'
  message         TEXT NOT NULL DEFAULT '',
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (owner_member_id, subject_type, subject_id)
);

ALTER TABLE card_designs ADD COLUMN term_sheet_memo TEXT NOT NULL DEFAULT 'もらった資料のメモ';
UPDATE card_designs SET term_sheet_memo = '略歴・GAINS・1to1資料の要約' WHERE id = 'default';
