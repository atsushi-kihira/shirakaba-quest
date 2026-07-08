-- ミーティング（複数人）の会議ツール連携
ALTER TABLE meetings ADD COLUMN conference_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE meetings ADD COLUMN conference_url TEXT;
ALTER TABLE meetings ADD COLUMN conference_meta_json TEXT;
ALTER TABLE meetings ADD COLUMN calendar_event_id TEXT;
