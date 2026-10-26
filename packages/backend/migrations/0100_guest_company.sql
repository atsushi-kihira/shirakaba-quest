-- 外部ゲストが回答時に入力する会社名・屋号（回答すると、主催者の外部人脈にも登録される）
ALTER TABLE meeting_external_invitees ADD COLUMN company TEXT;
ALTER TABLE meeting_series_external_invitees ADD COLUMN company TEXT;
