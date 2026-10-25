// =============================================================
// 予定のリマインド通知の定期実行（Cron Trigger）
// 毎時、バックエンドの内部用API（POST /api/internal/send-reminders）を呼び出す。
// 送る相手・時刻・文面の判断は、すべてバックエンド側（services/event-reminders.ts）で行う。
// =============================================================
type Env = {
  API_BASE_URL: string;
  REMINDER_CRON_SECRET: string;
};

async function sendReminders(env: Env): Promise<void> {
  const res = await fetch(`${env.API_BASE_URL}/api/internal/send-reminders`, {
    method: "POST",
    headers: { "x-internal-task-secret": env.REMINDER_CRON_SECRET },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`send-reminders failed: HTTP ${res.status} ${text}`);
  console.log(`send-reminders ok: ${text}`);
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(sendReminders(env));
  },
};
