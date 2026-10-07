-- 協働マップ：メンバーごとのアイコン配置（自分の画面でだけ使う私的な並び）。
-- user_placed = 1 は本人がドラッグして置いた位置、0 は自動配置（＋微調整）で決まった位置。
CREATE TABLE collab_map_positions (
  member_id   TEXT NOT NULL,
  node_id     TEXT NOT NULL,
  x           REAL NOT NULL,
  y           REAL NOT NULL,
  user_placed INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (member_id, node_id)
);
