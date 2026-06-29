-- Phase 1: 1on1日程調整機能 テーブル追加
-- google_credentials, member_scheduling_settings, availability_rules,
-- availability_overrides, bookings, booking_events, reminder_jobs

CREATE TABLE google_credentials (
  member_id               TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  google_account_email    TEXT NOT NULL,
  primary_calendar_id     TEXT NOT NULL,
  access_token_enc        TEXT NOT NULL,   -- AES-GCM 暗号化後 base64
  refresh_token_enc       TEXT NOT NULL,   -- AES-GCM 暗号化後 base64
  access_token_expires_at TEXT NOT NULL,   -- ISO 8601 UTC
  scopes                  TEXT NOT NULL,
  connected_at            TEXT NOT NULL,
  last_refreshed_at       TEXT
);

CREATE TABLE member_scheduling_settings (
  member_id              TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  slug                   TEXT NOT NULL UNIQUE,
  display_title          TEXT NOT NULL DEFAULT '1on1 ミーティング',
  description            TEXT,
  duration_minutes       INTEGER NOT NULL DEFAULT 30,
  buffer_before_minutes  INTEGER NOT NULL DEFAULT 0,
  buffer_after_minutes   INTEGER NOT NULL DEFAULT 10,
  min_notice_minutes     INTEGER NOT NULL DEFAULT 1440,
  max_advance_days       INTEGER NOT NULL DEFAULT 60,
  daily_max_bookings     INTEGER,
  slot_interval_minutes  INTEGER NOT NULL DEFAULT 30,
  location_note          TEXT,
  is_public              INTEGER NOT NULL DEFAULT 1,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE TABLE availability_rules (
  id               TEXT PRIMARY KEY,
  member_id        TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  day_of_week      INTEGER NOT NULL,
  start_time_local TEXT NOT NULL,
  end_time_local   TEXT NOT NULL,
  timezone         TEXT NOT NULL DEFAULT 'Asia/Tokyo'
);

CREATE INDEX idx_avail_rules_member ON availability_rules(member_id);

CREATE TABLE availability_overrides (
  id               TEXT PRIMARY KEY,
  member_id        TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date_local       TEXT NOT NULL,
  is_blocked       INTEGER NOT NULL DEFAULT 0,
  start_time_local TEXT,
  end_time_local   TEXT,
  note             TEXT
);

CREATE INDEX idx_avail_overrides_member ON availability_overrides(member_id);

CREATE TABLE bookings (
  id                     TEXT PRIMARY KEY,
  host_member_id         TEXT NOT NULL REFERENCES members(id),
  guest_member_id        TEXT REFERENCES members(id),
  guest_name             TEXT NOT NULL,
  guest_email            TEXT NOT NULL,
  guest_message          TEXT,
  start_at_utc           TEXT NOT NULL,
  end_at_utc             TEXT NOT NULL,
  timezone               TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'confirmed',
  cancellation_reason    TEXT,
  cancellation_token     TEXT NOT NULL,
  reschedule_token       TEXT NOT NULL,
  host_calendar_event_id TEXT,
  conference_type        TEXT NOT NULL DEFAULT 'manual',
  conference_url         TEXT,
  conference_meta_json   TEXT,
  one_on_one_session_id  TEXT,
  source                 TEXT NOT NULL DEFAULT 'public',
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE INDEX idx_bookings_host_start ON bookings(host_member_id, start_at_utc);
CREATE INDEX idx_bookings_cancel_token ON bookings(cancellation_token);

CREATE TABLE booking_events (
  id           TEXT PRIMARY KEY,
  booking_id   TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  actor_kind   TEXT NOT NULL,
  actor_id     TEXT,
  payload_json TEXT,
  occurred_at  TEXT NOT NULL
);

CREATE TABLE reminder_jobs (
  id            TEXT PRIMARY KEY,
  booking_id    TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  remind_at_utc TEXT NOT NULL,
  kind          TEXT NOT NULL,
  recipient     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'scheduled',
  sent_at       TEXT
);

CREATE INDEX idx_reminder_jobs_due ON reminder_jobs(status, remind_at_utc);
