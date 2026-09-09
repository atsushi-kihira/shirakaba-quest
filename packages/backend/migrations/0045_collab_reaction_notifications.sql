-- 協働の投稿への「紹介できそう」「私も参加したい」リアクション時に送るメッセージ通知
-- 宛先（投稿者＋関係者）ごとに1行、既読管理もこの行単位で行う
CREATE TABLE collab_reaction_notifications (
  id            text PRIMARY KEY NOT NULL,
  post_id       text NOT NULL,
  reaction_type text NOT NULL, -- 'shokai' | 'join'
  reactor_id    text NOT NULL,
  member_id     text NOT NULL, -- 通知の宛先メンバー
  message       text NOT NULL,
  read_at       integer,
  created_at    integer NOT NULL
);
