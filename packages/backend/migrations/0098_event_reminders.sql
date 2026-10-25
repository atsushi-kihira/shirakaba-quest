-- 確定済みの予定（1to1・ミーティング・定例会）のリマインド通知
-- ・member_reminder_settings: メンバーごとの初期設定（行がなければ「1日前・ホーム画面とメールの両方」）
-- ・reminder_overrides: 予定ごとの設定（その予定だけ初期設定と違う設定にしたとき）。target_kind は 'oneonone' | 'meeting' | 'series' | 'booking'
-- ・reminder_notices: 届けたリマインド（ホーム画面の表示と、同じリマインドを二重に送らないための記録を兼ねる）
CREATE TABLE member_reminder_settings (
  member_id  TEXT PRIMARY KEY,
  days_json  TEXT NOT NULL DEFAULT '[1]',
  channel    TEXT NOT NULL DEFAULT 'both',
  updated_at INTEGER NOT NULL
);

CREATE TABLE reminder_overrides (
  member_id   TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  days_json   TEXT NOT NULL,
  channel     TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (member_id, target_kind, target_id)
);

CREATE TABLE reminder_notices (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,
  ref_id      TEXT NOT NULL,
  starts_at   INTEGER NOT NULL,
  days_before INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'sent',
  channel     TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  link_path   TEXT,
  read_at     INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX uniq_reminder_notice ON reminder_notices(member_id, kind, ref_id, starts_at, days_before);
CREATE INDEX idx_reminder_notices_member ON reminder_notices(member_id, status, starts_at);
