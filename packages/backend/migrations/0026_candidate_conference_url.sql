-- 複数日程の会議URLをそれぞれの候補日に持てるようにする
ALTER TABLE meeting_date_candidates ADD COLUMN conference_url TEXT;
