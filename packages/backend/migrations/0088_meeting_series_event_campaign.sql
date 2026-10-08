-- 定例会に「イベント（インスタンス）」を紐づける。
-- ポイントはイベント種別ではなく、管理画面で作成するイベント（インスタンス）に設定するため、
-- 定例会作成時に選んだイベントを保持し、各回のミーティングに引き継ぐ。
ALTER TABLE meeting_series ADD COLUMN event_campaign_id TEXT;
