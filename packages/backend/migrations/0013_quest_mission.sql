-- 0013_quest_mission.sql — クエストにミッション（対策）カラムを追加
ALTER TABLE quests ADD COLUMN mission TEXT NOT NULL DEFAULT '';
