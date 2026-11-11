-- ミーティング・定例会の説明を、書式つき（見たまま編集）で保存する
--   description_doc : 書式つきの説明（エディタの内容を JSON 文字列で保存。安全な書式だけに整えたもの）
--                     従来の description（文章だけ）は、メール・通知・Googleカレンダー用に、そのまま残す（書式つき説明から自動で作る）
--   meeting_attachments.inline : 1 = 説明の文章の中に差し込んだ画像（説明の下の「添付」一覧には出さない）
ALTER TABLE meetings ADD COLUMN description_doc TEXT;
ALTER TABLE meeting_series ADD COLUMN description_doc TEXT;
ALTER TABLE meeting_attachments ADD COLUMN inline INTEGER NOT NULL DEFAULT 0;
