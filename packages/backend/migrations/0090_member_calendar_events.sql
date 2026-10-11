-- 招待されたメンバー（連携済みの人）のGoogleカレンダーへ自動登録した予定の記録。
-- 日時変更・キャンセル・不参加の回答があったときに、登録した予定を更新・削除するために使う。
-- kind: 'meeting'（ミーティング・定例会の開催回。ref_id=meetings.id, slot_id=確定した候補日のID）
--       'oneonone'（1to1。ref_id=one_on_one_sessions.id, slot_id=''）
CREATE TABLE member_calendar_events (
  id                TEXT PRIMARY KEY,
  member_id         TEXT NOT NULL,
  kind              TEXT NOT NULL,
  ref_id            TEXT NOT NULL,
  slot_id           TEXT NOT NULL DEFAULT '',
  google_account_id TEXT NOT NULL,
  calendar_id       TEXT NOT NULL,
  event_id          TEXT NOT NULL,
  signature         TEXT NOT NULL,   -- 件名・日時・会議URLの組み合わせ（変わったら予定を作り直す）
  starts_at         INTEGER NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE UNIQUE INDEX uniq_member_calendar_event ON member_calendar_events(member_id, kind, ref_id, slot_id);
CREATE INDEX idx_member_calendar_events_ref ON member_calendar_events(kind, ref_id);
