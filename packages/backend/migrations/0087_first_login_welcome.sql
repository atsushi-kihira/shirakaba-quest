-- 初めてのログイン時に自動で配信する「ようこそ」通知・メール。
-- ・members.first_login_welcomed_at: ようこそを配信した時刻（NULL = まだ）。二重配信の防止にも使う。
--   すでにログインしたことのあるメンバー（セッション履歴あり）は、配信済みとして扱う。
-- ・broadcast_templates.system_key: 自動配信に使う文面を見分けるキー（'first_login'）。管理画面から編集できる。

ALTER TABLE members ADD COLUMN first_login_welcomed_at INTEGER;

UPDATE members
SET first_login_welcomed_at = strftime('%s','now')
WHERE id IN (SELECT user_id FROM auth_sessions WHERE user_type = 'member');

ALTER TABLE broadcast_templates ADD COLUMN system_key TEXT;
CREATE UNIQUE INDEX idx_broadcast_templates_system_key ON broadcast_templates(system_key);

INSERT INTO broadcast_templates (id, name, title, body, include_usage, include_recommendations, system_key, created_at, updated_at) VALUES
('tpl-first-login', '初めてのログイン（自動配信）',
 '{{appTitle}}へようこそ！まずは「やってみよう」',
 '{{memberName}}さん、{{appTitle}}へようこそ！🎉

初めてのログインありがとうございます。
{{appTitle}}は、なかまとの1to1や協働を通じて、ご縁を深めていくためのアプリです。

まずは、次の2つを「やってみよう」📝

■ 🤝 1to1を設定してみよう
気になるなかまに1to1を申し込んでみましょう。日程の調整から会議URLの発行まで、アプリがお手伝いします。完了するとポイントも貯まります。
▶ {{appUrl}}/meetings/one-on-one

■ 📅 複数人でのミーティングを設定してみよう
候補日を出して回答を集めるだけで、日程が決まります。会議URLも自動で発行されます。
▶ {{appUrl}}/meetings/new

操作に迷ったときは、こちらの操作マニュアルをご覧ください。
▶ {{appUrl}}/manual.html',
 0, 0, 'first_login', strftime('%s','now'), strftime('%s','now'));
