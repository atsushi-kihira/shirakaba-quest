-- アクションごとに投稿本文とは別に公開レベルを設定できるようにする
-- （投稿本文はチャプター公開でも、特定のアクションだけチーム内に留めたい場合があるため）

ALTER TABLE collab_team_action_items ADD COLUMN visibility TEXT NOT NULL DEFAULT 'team';
