// =============================================================
// プッシュ通知をオンにするご案内（ホーム画面）
// オンにすると、他の人からの連絡（1to1・ミーティングなど）が、アプリを開いていなくても届き、開いている画面にもすぐに反映される。
// 対応していない端末・すでにオンの方・「あとで」を選んだ方には、出さない
// =============================================================
import { useState } from "react";
import { Bell, X } from "lucide-react";
import { usePushNotifications } from "@/hooks/use-push";

const DISMISS_KEY = "push_prompt_dismissed_at";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000; // 「あとで」を選んだら、2週間は出さない

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

export function PushPromptCard() {
  const push = usePushNotifications();
  const [hidden, setHidden] = useState(dismissedRecently);
  if (hidden || push.loading || push.support !== "supported" || push.subscribed) return null;

  function later() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* 保存できなくても、このまま閉じる */ }
    setHidden(true);
  }

  return (
    <div className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3" style={{ borderLeft: "3px solid var(--color-accent)" }}>
      <Bell size={18} className="shrink-0" style={{ color: "var(--color-accent)" }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: "var(--color-ink-800)" }}>プッシュ通知をオンにしませんか？</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
          1to1やミーティングの連絡が、すぐに届きます。開いている画面にも、すぐに反映されます。
        </p>
        {push.error && <p className="text-xs mt-1" style={{ color: "var(--color-brand)" }}>{push.error}</p>}
      </div>
      <button type="button" onClick={push.enable} disabled={push.busy}
        className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-full text-white disabled:opacity-60" style={{ background: "var(--color-brand)" }}>
        {push.busy ? "処理中…" : "オンにする"}
      </button>
      <button type="button" onClick={later} aria-label="あとで" className="p-1.5 rounded-full shrink-0" style={{ color: "var(--color-ink-400)" }}>
        <X size={14} />
      </button>
    </div>
  );
}
