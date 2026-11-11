-- セミナーなどの強調表示と、主催者が自由に追加する入力項目
--   event_type_definitions.title_color : イベント種別ごとの、タイトル文字の色（"#rrggbb"。NULL = ふつうの色）
--   meetings / meeting_series.custom_fields_json : 主催者が追加した項目 [{"id","label","type":"text|number|date","value"}]（最大10個）
ALTER TABLE event_type_definitions ADD COLUMN title_color TEXT;
ALTER TABLE meetings ADD COLUMN custom_fields_json TEXT;
ALTER TABLE meeting_series ADD COLUMN custom_fields_json TEXT;
