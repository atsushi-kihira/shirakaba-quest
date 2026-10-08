-- 1to1にイベントを結びつける。
-- ・event_type_definitions.links_to_one_on_one: 1to1に結びつけるイベント種別か
-- ・event_campaigns.one_on_one_target: そのイベント（インスタンス）が「メンバーとの1to1向け」('member')か
--   「ビジター（外部ゲスト）との1to1向け」('visitor')か
-- ・one_on_one_sessions.event_campaign_id: メンバーへの1to1申込で選んだイベント（ポイントはイベントに設定）
-- ・one_on_one_guest_invites.event_campaign_id: ビジター招待で選んだイベント
-- これまでの1to1（イベントなし）は、従来どおりシーズン設定のポイントで完了する。

ALTER TABLE event_type_definitions ADD COLUMN links_to_one_on_one INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event_campaigns ADD COLUMN one_on_one_target TEXT;
ALTER TABLE one_on_one_sessions ADD COLUMN event_campaign_id TEXT;
ALTER TABLE one_on_one_guest_invites ADD COLUMN event_campaign_id TEXT;

-- 最初から選べるイベント（管理画面で自由に編集・追加・終了できる）。
-- これまでどおり、メンバーとの1to1は1pt、ビジターとの1to1はポイントなしから始める。
INSERT INTO event_type_definitions
  (id, slug, name, description, emoji, trigger_type, point_value, reward_target, requires_target_member,
   creator_role, links_to_meeting, is_system, is_active, sort_order, created_at, updated_at, links_to_one_on_one)
VALUES
  ('etd_oneonone', 'one_on_one_event', '1to1', '1to1に結びつけるイベント種別です。', '🤝', 'on_action', 1, 'participant', 0,
   'admin', 0, 0, 1, 5, unixepoch(), unixepoch(), 1);

INSERT INTO event_campaigns
  (id, type, event_type_def_id, title, description, starts_at, ends_at, multiplier, allow_repeat, status, created_at, updated_at, one_on_one_target)
VALUES
  ('evc_oneonone_member', 'one_on_one_event', 'etd_oneonone', 'メンバーとの1to1', 'メンバー同士の1to1です。', unixepoch(), NULL, 1, 1, 'active', unixepoch(), unixepoch(), 'member'),
  ('evc_oneonone_visitor', 'one_on_one_event', 'etd_oneonone', 'ビジターとの1to1', 'ビジター（外部ゲスト）との1to1です。', unixepoch(), NULL, NULL, 1, 'active', unixepoch(), unixepoch(), 'visitor');
