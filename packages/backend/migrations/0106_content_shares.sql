-- 「共有」：自分だけのもの・チームだけのものを、読み取り専用で他の人に見せる仕組み
--   kind    : 'team_profile'（実チームのプロフィール・役割）／'contacts'（外部人脈）／
--             'team_draft'（チーム案）／'enishi_result'（ご縁さがしの検索結果）
--   subject_id : 共有するものの ID（team_profile=チームID、contacts=持ち主のメンバーID、
--                team_draft=チーム案ID、enishi_result=検索履歴ID）
--   scope   : 'selected'（指定した人だけ）／'members'（白樺クエストのメンバー全員）／'link'（URLを知っている人全員）
--             ※「自分だけ」は、行がない状態（または行を消した状態）で表す
--   link_token : scope='link' のときの、推測されにくい合言葉（URLに入れる）
CREATE TABLE content_shares (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL,
  subject_id       TEXT NOT NULL,
  owner_member_id  TEXT NOT NULL,
  scope            TEXT NOT NULL,
  link_token       TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE UNIQUE INDEX uniq_content_share_subject ON content_shares (kind, subject_id);
CREATE UNIQUE INDEX uniq_content_share_token ON content_shares (link_token);
CREATE INDEX idx_content_share_owner ON content_shares (owner_member_id);

-- scope='selected' の共有先。target_type: 'member'（個別）／'guild'（ギルド）／'collab_team'（チーム）
CREATE TABLE content_share_targets (
  share_id     TEXT NOT NULL,
  target_type  TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  PRIMARY KEY (share_id, target_type, target_id)
);
CREATE INDEX idx_content_share_target_lookup ON content_share_targets (target_type, target_id);
