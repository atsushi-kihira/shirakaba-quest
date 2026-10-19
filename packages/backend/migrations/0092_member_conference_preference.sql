-- 会議ツールの選び方（Google Meet・Zoomの両方を連携しているメンバー向け）。
-- 'choose'（既定）: 予約する側・回答する側に選んでもらう / 'google_meet' / 'zoom': 相手には選ばせず、常にそのツールを使う
ALTER TABLE members ADD COLUMN conference_preference TEXT NOT NULL DEFAULT 'choose';
