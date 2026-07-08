-- カードイメージデータ作成プランの名称を変更可能にする
ALTER TABLE card_designs ADD COLUMN card_print_image_only_name TEXT NOT NULL DEFAULT 'カードイメージデータ作成のみ';
