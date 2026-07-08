-- 複数確定日程に対応するため、出席記録にどの日程に参加するかを紐付ける
ALTER TABLE meeting_attendances ADD COLUMN candidate_id TEXT;
