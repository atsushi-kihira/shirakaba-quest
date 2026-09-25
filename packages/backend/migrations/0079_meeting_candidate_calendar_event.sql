-- 複数人ミーティング（通常・定例会）の日程確定時に、Googleカレンダーへ予定をブロックできるようにする
-- （1to1と異なり、これまで日程確定だけではカレンダーに何も記録されず、ダブルブッキングの危険があったため）

ALTER TABLE meeting_date_candidates ADD COLUMN calendar_event_id TEXT;
