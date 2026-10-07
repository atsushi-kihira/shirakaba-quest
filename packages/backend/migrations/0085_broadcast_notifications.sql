-- 運営（管理ダッシュボード）からの「お知らせ配信」機能。
-- ・broadcast_templates: 配信文面のテンプレート（複数作成可）
-- ・broadcasts: 配信の履歴
-- ・member_notifications: メンバーごとの通知（ホーム画面・通知メニューに表示。メールと同じ内容）

CREATE TABLE broadcast_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  include_usage INTEGER NOT NULL DEFAULT 0,
  include_recommendations INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE broadcasts (
  id TEXT PRIMARY KEY,
  template_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  include_usage INTEGER NOT NULL DEFAULT 0,
  include_recommendations INTEGER NOT NULL DEFAULT 0,
  send_email INTEGER NOT NULL DEFAULT 1,
  scope TEXT NOT NULL,
  scope_label TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE member_notifications (
  id TEXT PRIMARY KEY,
  broadcast_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_member_notifications_member ON member_notifications(member_id, created_at);

-- 最初から使える配信文面の例（管理画面で自由に編集・削除できる）
INSERT INTO broadcast_templates (id, name, title, body, include_usage, include_recommendations, created_at, updated_at) VALUES
('tpl-feature-guide', '機能のご案内（利用状況つき）',
 '{{memberName}}さんにおすすめの{{appTitle}}の使い方',
 '{{memberName}}さん

いつも{{appTitle}}をご利用いただきありがとうございます。
{{appTitle}}を、もっと便利に活用していただくためのご案内です。

{{usageSummary}}

{{recommendations}}

ご不明な点があれば、お気軽に運営までお声がけください。',
 1, 1, strftime('%s','now'), strftime('%s','now')),
('tpl-simple-notice', 'お知らせ（シンプル）',
 '{{appTitle}}からのお知らせ',
 '{{memberName}}さん

{{appTitle}}からのお知らせです。

（ここにお知らせ内容を入力してください）',
 0, 0, strftime('%s','now'), strftime('%s','now'));
