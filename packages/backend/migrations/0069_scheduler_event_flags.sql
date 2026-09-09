ALTER TABLE member_scheduling_settings ADD COLUMN treat_free_events_as_busy INTEGER NOT NULL DEFAULT 1;
ALTER TABLE member_scheduling_settings ADD COLUMN block_all_day_events INTEGER NOT NULL DEFAULT 0;
