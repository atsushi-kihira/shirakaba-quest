-- 人脈の「関係性」（BNI・前職の同僚 等）を備考とは独立した項目として追加
ALTER TABLE external_contacts ADD COLUMN relationship TEXT;
