-- 「相手の紹介シート」。1to1でもらった略歴シート・GAINSシート・1to1シートの内容を、
-- メンバー／外部人脈ごとに、登録した本人だけが見られる形で保存する。
-- 1人の登録者につき、相手1人（メンバーまたは外部人脈）あたり1件。
CREATE TABLE IF NOT EXISTS profile_sheets (
  id               TEXT PRIMARY KEY,
  owner_member_id  TEXT NOT NULL,            -- 登録した本人（この人だけが見られる）
  subject_type     TEXT NOT NULL,            -- 'member' | 'contact'
  subject_id       TEXT NOT NULL,
  name             TEXT NOT NULL DEFAULT '',
  furigana         TEXT NOT NULL DEFAULT '',
  company          TEXT NOT NULL DEFAULT '', -- 会社・屋号
  title            TEXT NOT NULL DEFAULT '', -- 業種・肩書き
  oneonone_date    TEXT NOT NULL DEFAULT '', -- 1to1した日
  expertise        TEXT NOT NULL DEFAULT '', -- 専門・強み
  wanted_referrals TEXT NOT NULL DEFAULT '', -- 紹介してほしい相手（理想のお客様）
  personality      TEXT NOT NULL DEFAULT '', -- 人柄・話題メモ
  contact_info     TEXT NOT NULL DEFAULT '', -- 連絡手段
  tags             TEXT NOT NULL DEFAULT '[]', -- タグ（JSON配列）
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_profile_sheet_subject ON profile_sheets (owner_member_id, subject_type, subject_id);

-- 資料のAI読み取りの回数（1日の上限を数えるため）
CREATE TABLE IF NOT EXISTS profile_sheet_extractions (
  id         TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profile_sheet_extractions_member ON profile_sheet_extractions (member_id, created_at);
