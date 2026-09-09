ALTER TABLE member_scheduling_settings ADD COLUMN share_token TEXT;
ALTER TABLE member_scheduling_settings ADD COLUMN share_token_expires_at INTEGER;
CREATE UNIQUE INDEX idx_msettings_share_token ON member_scheduling_settings(share_token);

ALTER TABLE card_designs ADD COLUMN scheduler_link_validity_hours INTEGER NOT NULL DEFAULT 72;

ALTER TABLE bookings ADD COLUMN guest_followup_outcome TEXT;
