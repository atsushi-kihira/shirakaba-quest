-- ================================================================
-- USP（Unique Selling Proposition）マスターテーブル追加
-- ================================================================

CREATE TABLE IF NOT EXISTS usps (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  emoji       TEXT NOT NULL DEFAULT '⭐',
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- 初期データ（BNI 白樺チャプター向けサンプル USP）
INSERT OR IGNORE INTO usps (id, name, emoji, description, sort_order, created_at, updated_at) VALUES
  ('usp-01', 'リスク判断力',     '⚖️',  '法務・財務・業務上のリスクを見極め、適切な判断を下す能力', 1,  strftime('%s','now'), strftime('%s','now')),
  ('usp-02', '企画提案力',       '💡',  '課題をビジネス機会に変える企画・提案を生み出す能力',       2,  strftime('%s','now'), strftime('%s','now')),
  ('usp-03', 'ビジュアル構成力', '🎨',  'デザイン・資料・映像で伝わる表現を作り出す能力',           3,  strftime('%s','now'), strftime('%s','now')),
  ('usp-04', 'DX設計力',        '🖥️',   'デジタル化・自動化の仕組みを設計・実装する能力',           4,  strftime('%s','now'), strftime('%s','now')),
  ('usp-05', '人脈構築力',       '🤝',  '人と人をつなぎ、信頼関係のネットワークを広げる能力',       5,  strftime('%s','now'), strftime('%s','now')),
  ('usp-06', '資金調達力',       '💰',  '補助金・融資・投資などの資金を獲得する能力',               6,  strftime('%s','now'), strftime('%s','now')),
  ('usp-07', '販路開拓力',       '📣',  '新しい顧客・市場・販売チャネルを開拓する能力',             7,  strftime('%s','now'), strftime('%s','now')),
  ('usp-08', 'ブランディング力', '✨',  '商品・サービス・個人のブランド価値を高める能力',           8,  strftime('%s','now'), strftime('%s','now')),
  ('usp-09', '数値分析力',       '📊',  'データや財務情報を分析し、意思決定に活かす能力',           9,  strftime('%s','now'), strftime('%s','now')),
  ('usp-10', '交渉折衝力',       '🗣️',  '交渉・調停・説得を通じて合意形成を導く能力',               10, strftime('%s','now'), strftime('%s','now'));
