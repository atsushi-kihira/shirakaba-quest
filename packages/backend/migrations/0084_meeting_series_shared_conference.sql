-- 定例会の会議URLを「各回ごとに発行」から「全回共通の1つのURL」に変更する。
-- 自動発行した共通URLを後始末（シリーズ中止時の削除）できるよう、Zoom会議ID・Google予定IDを保持する。
-- 既存の定例会（各回ごとにURL発行済み）は変更せず、そのまま旧方式で動作し続ける。

ALTER TABLE meeting_series ADD COLUMN conference_meta_json TEXT;
ALTER TABLE meeting_series ADD COLUMN conference_calendar_event_id TEXT;
