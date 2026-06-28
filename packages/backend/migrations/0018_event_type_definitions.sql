-- =============================================================
-- event_type_definitions テーブル作成
-- =============================================================
CREATE TABLE IF NOT EXISTS event_type_definitions (
  id                     TEXT PRIMARY KEY,
  slug                   TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  description            TEXT NOT NULL DEFAULT '',
  emoji                  TEXT NOT NULL DEFAULT '🎉',
  trigger_type           TEXT NOT NULL DEFAULT 'display_only',
  -- 'one_on_one' | 'meeting_attendance' | 'display_only'
  point_value            INTEGER NOT NULL DEFAULT 0,
  reward_target          TEXT NOT NULL DEFAULT 'participant',
  -- 'participant' | 'partner_of_related' | 'none'
  requires_target_member INTEGER NOT NULL DEFAULT 0,
  creator_role           TEXT NOT NULL DEFAULT 'admin',
  -- 'admin' | 'member'
  links_to_meeting       INTEGER NOT NULL DEFAULT 0,
  is_system              INTEGER NOT NULL DEFAULT 0,
  is_active              INTEGER NOT NULL DEFAULT 1,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL
);

-- シードデータ（システム組込み種別）
INSERT OR IGNORE INTO event_type_definitions
  (id, slug, name, description, emoji, trigger_type, point_value, reward_target,
   requires_target_member, creator_role, links_to_meeting, is_system, is_active, sort_order, created_at, updated_at)
VALUES
  ('etd_welcome', 'welcome_quest',        '新メンバー歓迎',         '新しいメンバーと1to1を実施してボーナスポイントをもらおう', '🎉', 'one_on_one',         3, 'partner_of_related', 1, 'member', 0, 1, 1, 10, unixepoch(), unixepoch()),
  ('etd_visitor', 'visitor_invite_quest', 'ビジター招待',            'ビジターをBNIに招待しよう',                               '🤝', 'display_only',       0, 'none',               0, 'admin',  0, 1, 1, 20, unixepoch(), unixepoch()),
  ('etd_coffee',  'coffee_meeting',       'コーヒーミーティング',    'ビジターを招いてコーヒーミーティングを開催しよう',         '☕', 'meeting_attendance', 3, 'participant',        0, 'member', 1, 0, 1, 30, unixepoch(), unixepoch());

-- event_campaigns に event_type_def_id を追加（本番DBには既に追加済みの可能性あり）
-- ALTER TABLE event_campaigns ADD COLUMN event_type_def_id TEXT;

-- 既存レコードに event_type_def_id を付与（slug が一致するもの）
UPDATE event_campaigns
SET event_type_def_id = (
  SELECT id FROM event_type_definitions WHERE slug = event_campaigns.type
)
WHERE type IN ('welcome_quest', 'visitor_invite_quest') AND event_type_def_id IS NULL;

-- 不要になった種別の既存レコードを削除扱いに
UPDATE event_campaigns
SET status = 'deleted'
WHERE type IN ('special_quest_week', 'featured_member');

-- meetings に event_type_def_id と registration_deadline を追加（本番DBには既に追加済みの可能性あり）
-- ALTER TABLE meetings ADD COLUMN event_type_def_id TEXT;
-- ALTER TABLE meetings ADD COLUMN registration_deadline INTEGER;

-- 既存ミーティングに event_type_def_id を引き継ぐ（event_campaign_id 経由）
UPDATE meetings
SET event_type_def_id = (
  SELECT ec.event_type_def_id FROM event_campaigns ec
  WHERE ec.id = meetings.event_campaign_id
)
WHERE meetings.event_campaign_id IS NOT NULL;
