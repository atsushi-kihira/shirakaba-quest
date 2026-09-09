ALTER TABLE meeting_date_candidates ADD COLUMN added_by_member_id TEXT;

-- 既存の候補日はすべて主催者が作成したものとして扱う
UPDATE meeting_date_candidates
SET added_by_member_id = (
  SELECT host_member_id FROM meetings WHERE meetings.id = meeting_date_candidates.meeting_id
)
WHERE added_by_member_id IS NULL;
