-- チーム案のメンバー案（候補・募集人材）に、「AIが提案した人」か「自分で追加した人」かの区別をつける。
-- チーム案の人数の枠は、AI提案・自分で追加でそれぞれ別に数える。
-- すでにある人は、どちらで加わったか区別できないため、「自分で追加」として扱う。
ALTER TABLE team_prospects ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
