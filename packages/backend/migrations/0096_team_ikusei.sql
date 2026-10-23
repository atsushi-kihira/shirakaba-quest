-- チーム育成：チームプロフィール・候補／募集人材・AIの提案の履歴・役割変更の承認・歩みの記録
-- （チーム案・緩いチーム・パワーチームの3段階で共通に使う。subject_type='draft'（チーム案）または 'team'（正式なチーム））

-- チームプロフィール（事業・概要・お客様像・最初の一歩・役割）。
-- 役割は、メンバーのキー（'m:<メンバーID>' / 'c:<外部人脈ID>' / 't:<募集人材ID>'）ごとに1文。
-- is_provisional=1 は、AIが仮に作った内容（リーダーの確認待ち）。backfill_status は、既存チームへの一括生成の状態。
CREATE TABLE team_profiles (
  id               TEXT PRIMARY KEY,
  subject_type     TEXT NOT NULL,
  subject_id       TEXT NOT NULL,
  business_title   TEXT NOT NULL DEFAULT '',
  summary          TEXT NOT NULL DEFAULT '',
  target_customers TEXT NOT NULL DEFAULT '',
  goal             TEXT NOT NULL DEFAULT '',
  first_steps_json TEXT NOT NULL DEFAULT '[]',
  roles_json       TEXT NOT NULL DEFAULT '{}',
  is_provisional   INTEGER NOT NULL DEFAULT 0,
  backfill_status  TEXT,          -- 'generating' | 'done' | 'failed'（既存チームの仮プロフィール生成）
  backfill_at      INTEGER,
  confirmed_at     INTEGER,
  updated_by       TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE UNIQUE INDEX uniq_team_profile_subject ON team_profiles(subject_type, subject_id);

-- AIによる再検討の提案の履歴（反映はリーダーが、情報ごとに選ぶ）
CREATE TABLE team_profile_proposals (
  id               TEXT PRIMARY KEY,
  subject_type     TEXT NOT NULL,
  subject_id       TEXT NOT NULL,
  created_by       TEXT NOT NULL,
  perspectives_json TEXT NOT NULL DEFAULT '[]',
  note             TEXT NOT NULL DEFAULT '',
  proposal_json    TEXT NOT NULL,
  applied_json     TEXT NOT NULL DEFAULT '{}',   -- 反映・破棄した項目の記録
  status           TEXT NOT NULL DEFAULT 'open', -- 'open' | 'closed'（すべて反映・破棄で閉じる）
  base_updated_at  INTEGER NOT NULL,              -- 提案のもとにしたプロフィールの更新日時
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_team_proposals_subject ON team_profile_proposals(subject_type, subject_id, created_at);

-- 候補（まだ参加していないメンバー・外部人脈）と募集人材（まだいない人の人物像）。
-- チーム案の構成メンバー（team_draft_members）を引き継ぎ、正式なチームでも同じ入れ物で扱う。
CREATE TABLE team_prospects (
  id                  TEXT PRIMARY KEY,
  subject_type        TEXT NOT NULL,
  subject_id          TEXT NOT NULL,
  kind                TEXT NOT NULL,        -- 'member' | 'contact' | 'talent'
  ref_id              TEXT,                 -- メンバーID / 外部人脈ID（talent は NULL）
  owner_member_id     TEXT,                 -- 外部人脈の登録者
  locked              INTEGER NOT NULL DEFAULT 0,  -- 確定（まとめ直しで外さない）
  talent_title        TEXT,                 -- 募集人材：業種・職種
  talent_profile      TEXT,                 -- 募集人材：ビジネス面での人物像
  talent_reason       TEXT,                 -- 募集人材：補えること
  published           INTEGER NOT NULL DEFAULT 0,  -- 募集として公開（チャプター全員に見せる）
  filled_by_member_id TEXT,                 -- 充足した人
  filled_at           INTEGER,
  added_by            TEXT,
  created_at          INTEGER NOT NULL
);
CREATE INDEX idx_team_prospects_subject ON team_prospects(subject_type, subject_id);
CREATE UNIQUE INDEX uniq_team_prospect_ref ON team_prospects(subject_type, subject_id, kind, ref_id);

INSERT INTO team_prospects (id, subject_type, subject_id, kind, ref_id, owner_member_id, locked, published, added_by, created_at)
SELECT m.id, 'draft', m.draft_id, m.kind, m.ref_id,
       CASE WHEN m.kind = 'contact' THEN (SELECT d.owner_member_id FROM team_drafts d WHERE d.id = m.draft_id) ELSE NULL END,
       0, 0, (SELECT d.owner_member_id FROM team_drafts d WHERE d.id = m.draft_id), m.created_at
FROM team_draft_members m;

-- 他のメンバーの役割を書き換える提案（リーダーの承認が必要。自分の役割は承認不要）
CREATE TABLE team_role_requests (
  id            TEXT PRIMARY KEY,
  team_id       TEXT NOT NULL,
  target_key    TEXT NOT NULL,
  requested_by  TEXT NOT NULL,
  proposed_role TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  decided_by    TEXT,
  decided_at    INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_team_role_requests_team ON team_role_requests(team_id, status);

-- チームの歩み（結成・プロフィール完成・昇格・募集人材の充足 など）。活動の投稿とは別（協働の未読バッジを増やさない）
CREATE TABLE team_milestones (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL,
  type       TEXT NOT NULL,
  ref_id     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_team_milestones_team ON team_milestones(team_id, created_at);

-- 募集人材への「興味あり」（参加希望）が、どの募集人材に対するものか
ALTER TABLE collab_team_members ADD COLUMN prospect_id TEXT;
