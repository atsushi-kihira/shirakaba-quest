-- 定例会の候補パターン：毎月の「第N曜日」を、1つのパターンに最大3つまで持てるようにする
-- （例：毎月 第1火曜日と第3水曜日）。1つ目は従来の列（day_of_week / week_of_month）、2つ目以降をこの列に JSON で持つ。
-- 形式：[{"weekOfMonth":3,"dayOfWeek":3}, ...]（最大2件）。NULL は、従来どおり1つだけ
ALTER TABLE meeting_series_pattern_candidates ADD COLUMN extra_slots_json TEXT;
