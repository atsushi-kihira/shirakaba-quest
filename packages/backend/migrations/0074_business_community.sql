ALTER TABLE card_designs ADD COLUMN term_business_community TEXT NOT NULL DEFAULT 'ビジネスコミュニティ';
ALTER TABLE members ADD COLUMN business_community_joined_month TEXT;
