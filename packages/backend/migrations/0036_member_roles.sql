-- =============================================================
-- メンバーへの追加ロール付与（パイロット枠・パワーチームコーディネーター等）
-- =============================================================
CREATE TABLE member_roles (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL,
  role        TEXT NOT NULL, -- 'pilot' | 'power_team_coordinator'
  granted_by  TEXT NOT NULL,
  granted_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);

CREATE UNIQUE INDEX uniq_member_role ON member_roles(member_id, role);
CREATE INDEX idx_member_roles_member ON member_roles(member_id);
