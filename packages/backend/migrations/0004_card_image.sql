-- メンバーのカード画像（表面・撮影画像）を R2 に保存するためのキーを保持する
ALTER TABLE members ADD COLUMN card_image_key TEXT;
