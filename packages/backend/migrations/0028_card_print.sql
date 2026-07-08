-- カード作成設定（card_designsに追加）
ALTER TABLE card_designs ADD COLUMN card_print_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE card_designs ADD COLUMN card_print_company_name TEXT NOT NULL DEFAULT '';
ALTER TABLE card_designs ADD COLUMN card_print_company_url TEXT NOT NULL DEFAULT '';
ALTER TABLE card_designs ADD COLUMN card_print_contact_person TEXT NOT NULL DEFAULT '';
ALTER TABLE card_designs ADD COLUMN card_print_contact_email TEXT NOT NULL DEFAULT '';
ALTER TABLE card_designs ADD COLUMN card_print_contact_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE card_designs ADD COLUMN card_print_image_only_price INTEGER;
ALTER TABLE card_designs ADD COLUMN card_print_plans TEXT NOT NULL DEFAULT '[]';
ALTER TABLE card_designs ADD COLUMN card_print_thank_you_message TEXT NOT NULL DEFAULT 'ご注文いただきありがとうございました。';

-- カード発注テーブル
CREATE TABLE IF NOT EXISTS card_orders (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  character_key TEXT NOT NULL,
  character_label TEXT NOT NULL,
  photo_key TEXT,
  address TEXT,
  phone TEXT,
  plan_name TEXT NOT NULL,
  plan_price INTEGER NOT NULL,
  member_snapshot TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
