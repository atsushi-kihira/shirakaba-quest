-- 協働チームの「検討中のチーム案」。作った本人だけに見える、ローカルな案（他のユーザーには見えない）。
-- 構成メンバーは、メンバー（kind='member', ref_id=メンバーID）と、本人の外部人脈（kind='contact', ref_id=人脈ID）。
-- 自分自身は常に含まれるため、行としては持たない。
CREATE TABLE team_drafts (
  id                 TEXT PRIMARY KEY,
  owner_member_id    TEXT NOT NULL,
  title              TEXT NOT NULL,
  goal               TEXT NOT NULL DEFAULT '',   -- どんな協業を考えたいか（任意）
  ideas_json         TEXT,                        -- 最新の「協働事業と役割のまとめ」（AI生成）
  ideas_generated_at INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX idx_team_drafts_owner ON team_drafts(owner_member_id, updated_at);

CREATE TABLE team_draft_members (
  id         TEXT PRIMARY KEY,
  draft_id   TEXT NOT NULL,
  kind       TEXT NOT NULL,   -- 'member' | 'contact'
  ref_id     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uniq_team_draft_member ON team_draft_members(draft_id, kind, ref_id);
