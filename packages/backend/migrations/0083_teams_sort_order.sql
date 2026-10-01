-- ギルド（teams）に管理画面での表示順（ドラッグ&ドロップ並び替え用）を追加する。
-- 既存データは、これまでの表示順（作成日時の新しい順）をそのまま初期値として引き継ぐ。

ALTER TABLE teams ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

UPDATE teams
SET sort_order = (
  SELECT COUNT(*) FROM teams AS t2
  WHERE t2.created_at > teams.created_at
     OR (t2.created_at = teams.created_at AND t2.id < teams.id)
);
