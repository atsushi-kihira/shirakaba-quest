-- イベントに複数メンバーを割り当てられるよう related_member_ids 列を追加
ALTER TABLE event_campaigns ADD COLUMN related_member_ids TEXT;
