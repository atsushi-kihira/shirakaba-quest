-- =============================================================
-- 活動と記録（協働の投稿・シェアストーリー）
-- =============================================================
CREATE TABLE collaboration_posts (
  id            TEXT PRIMARY KEY,
  author_id     TEXT NOT NULL,
  context_type  TEXT NOT NULL,
  link_id       TEXT,
  team_id       TEXT,
  visibility    TEXT NOT NULL DEFAULT 'chapter',
  is_private    INTEGER NOT NULL DEFAULT 0,
  stage_at_post TEXT,
  source        TEXT NOT NULL DEFAULT 'user',
  body          TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);
CREATE INDEX idx_collab_posts_created ON collaboration_posts(created_at);
CREATE INDEX idx_collab_posts_team ON collaboration_posts(team_id);
CREATE INDEX idx_collab_posts_link ON collaboration_posts(link_id);

CREATE TABLE collaboration_post_members (
  post_id   TEXT NOT NULL,
  member_id TEXT NOT NULL
);
CREATE UNIQUE INDEX uniq_collab_post_member ON collaboration_post_members(post_id, member_id);
CREATE INDEX idx_collab_post_members_member ON collaboration_post_members(member_id);

CREATE TABLE collaboration_post_reactions (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  type       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uniq_collab_post_reaction ON collaboration_post_reactions(post_id, member_id, type);

CREATE TABLE share_stories (
  id           TEXT PRIMARY KEY,
  team_id      TEXT,
  season_id    TEXT,
  author_id    TEXT NOT NULL,
  title        TEXT NOT NULL,
  summary      TEXT,
  presented_on INTEGER,
  visibility   TEXT NOT NULL DEFAULT 'chapter',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);
CREATE INDEX idx_share_stories_team ON share_stories(team_id);

CREATE TABLE share_story_attachments (
  id         TEXT PRIMARY KEY,
  story_id   TEXT NOT NULL,
  kind       TEXT NOT NULL,
  label      TEXT NOT NULL,
  url        TEXT,
  file_key   TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_share_story_attachments_story ON share_story_attachments(story_id);

CREATE TABLE share_story_members (
  story_id  TEXT NOT NULL,
  member_id TEXT NOT NULL
);
CREATE UNIQUE INDEX uniq_share_story_member ON share_story_members(story_id, member_id);
