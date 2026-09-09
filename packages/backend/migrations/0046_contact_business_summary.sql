-- 人脈の会社名から、AI(Web検索)で会社の事業概要を自動生成して保持する
ALTER TABLE external_contacts ADD COLUMN business_summary text;
ALTER TABLE external_contacts ADD COLUMN business_summary_detail text;
ALTER TABLE external_contacts ADD COLUMN business_summary_status text NOT NULL DEFAULT 'pending'; -- 'pending' | 'done' | 'not_found' | 'skipped' | 'error'
ALTER TABLE external_contacts ADD COLUMN business_summary_generated_at integer;
