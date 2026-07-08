-- イベントの「何度もチャレンジ可能かどうか」設定
-- allow_repeat: 1=何度でも実施可（デフォルト）、0=1度のみ
ALTER TABLE event_campaigns ADD COLUMN allow_repeat INTEGER NOT NULL DEFAULT 1;

-- 繰り返し実施イベントの実施ログ（event_participations は unique 制約があるため別テーブル）
CREATE TABLE IF NOT EXISTS event_action_logs (
  id TEXT PRIMARY KEY,
  event_campaign_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_action_logs ON event_action_logs (event_campaign_id, member_id);
