ALTER TABLE meeting_series ADD COLUMN date_mode TEXT NOT NULL DEFAULT 'recurring';
ALTER TABLE meeting_series ADD COLUMN conference_url TEXT;

CREATE TABLE meeting_series_fixed_dates (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL REFERENCES meeting_series(id),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
