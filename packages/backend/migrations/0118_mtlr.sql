-- メンバー・トラフィック・ライト・レポート（MTLR）。BNIのレポート（PDFの表）を月ごとに取り込んで保存する。
-- 管理ダッシュボード「統計レポート」専用（当面は管理者だけが見られる）。

-- 取り込んだレポート（1か月に1件。期間の終わりの日の年月で区別する）
CREATE TABLE IF NOT EXISTS mtlr_reports (
  id              TEXT PRIMARY KEY,
  ym              TEXT NOT NULL,             -- 'YYYY-MM'（期間の終わりの年月）
  period_from     TEXT NOT NULL,             -- 'YYYY-MM-DD'
  period_to       TEXT NOT NULL,             -- 'YYYY-MM-DD'
  created_on      TEXT NOT NULL DEFAULT '',  -- レポートが作られた日（'YYYY-MM-DD'。わからなければ空）
  standard        TEXT NOT NULL DEFAULT '2025-10', -- 点数の基準の版
  source_filename TEXT NOT NULL DEFAULT '',
  imported_by     TEXT NOT NULL DEFAULT '',  -- 取り込んだ管理者のメンバーID
  imported_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_mtlr_reports_ym ON mtlr_reports (ym);

-- レポートの1行（メンバー1人ぶん）。列はPDFの表と同じ
CREATE TABLE IF NOT EXISTS mtlr_rows (
  id               TEXT PRIMARY KEY,
  report_id        TEXT NOT NULL,
  sort_index       INTEGER NOT NULL DEFAULT 0, -- PDFでの並び順
  person_key       TEXT NOT NULL,              -- 同じ人を月をまたいで見分けるキー（名前から作る）
  display_name     TEXT NOT NULL,              -- 画面に出す名前
  raw_name         TEXT NOT NULL,              -- PDFに書かれていた名前そのまま
  member_id        TEXT,                       -- ひも付いたメンバー（ひも付いていなければ NULL）
  attended         INTEGER NOT NULL DEFAULT 0, -- 出
  absent           INTEGER NOT NULL DEFAULT 0, -- 欠
  late             INTEGER NOT NULL DEFAULT 0, -- 遅
  medical          INTEGER NOT NULL DEFAULT 0, -- 医
  substitute       INTEGER NOT NULL DEFAULT 0, -- 代
  ref_in_given     INTEGER NOT NULL DEFAULT 0, -- 内与
  ref_out_given    INTEGER NOT NULL DEFAULT 0, -- 外与
  ref_out_rate     INTEGER NOT NULL DEFAULT 0, -- 外与率（%）
  ref_in_received  INTEGER NOT NULL DEFAULT 0, -- 内受
  ref_out_received INTEGER NOT NULL DEFAULT 0, -- 外受
  visitors         INTEGER NOT NULL DEFAULT 0, -- ビ
  one_to_one       INTEGER NOT NULL DEFAULT 0, -- 1to1
  tyfcb            INTEGER NOT NULL DEFAULT 0, -- 千円（サンキュー金額）
  ceu              INTEGER NOT NULL DEFAULT 0, -- CEU
  recommend        INTEGER NOT NULL DEFAULT 0, -- 推薦
  sponsor          INTEGER NOT NULL DEFAULT 0, -- 後援
  score            INTEGER NOT NULL DEFAULT 0  -- スコア（レポートに印刷されていた総合点）
);
CREATE INDEX IF NOT EXISTS idx_mtlr_rows_report ON mtlr_rows (report_id);
CREATE INDEX IF NOT EXISTS idx_mtlr_rows_person ON mtlr_rows (person_key);

-- 「このPDF上の名前」と「アプリのメンバー」のひも付け（月をまたいで引き継ぐ）。
-- member_id が NULL のものは「アプリのメンバーではない」と管理者が決めた人（自動で当てはめない）。
CREATE TABLE IF NOT EXISTS mtlr_person_links (
  person_key TEXT PRIMARY KEY,
  member_id  TEXT,
  updated_at INTEGER NOT NULL
);
