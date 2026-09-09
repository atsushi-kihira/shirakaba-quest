CREATE TABLE meeting_series (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  host_member_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  collab_team_id TEXT,
  status TEXT NOT NULL DEFAULT 'voting',
  confirmed_pattern_id TEXT,
  deadline INTEGER,
  end_condition TEXT,
  end_date INTEGER,
  occurrence_count INTEGER,
  event_type_def_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE meeting_series_pattern_candidates (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  recurrence_type TEXT NOT NULL,
  day_of_week INTEGER NOT NULL,
  week_of_month INTEGER,
  start_time_local TEXT NOT NULL,
  end_time_local TEXT NOT NULL,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_confirmed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE meeting_series_invitees (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  member_id TEXT NOT NULL
);

CREATE TABLE meeting_series_responses (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  availability TEXT NOT NULL DEFAULT 'yes',
  comment TEXT,
  responded_at INTEGER NOT NULL
);

CREATE INDEX idx_meeting_series_pattern_candidates_series ON meeting_series_pattern_candidates(series_id);
CREATE INDEX idx_meeting_series_invitees_series ON meeting_series_invitees(series_id);
CREATE INDEX idx_meeting_series_responses_series ON meeting_series_responses(series_id);

ALTER TABLE meetings ADD COLUMN series_id TEXT;
ALTER TABLE meetings ADD COLUMN series_occurrence_index INTEGER;
