// =============================================================
// 新着のお知らせ（プッシュ通知が届いたとき、画面の上に数秒だけ出る）。押すと、その画面に移動する
// =============================================================
import { useNavigate } from "react-router-dom";
import { Bell, X } from "lucide-react";
import type { LiveToastData } from "@/hooks/use-live-updates";

export function LiveToast({ toast, onDismiss }: { toast: LiveToastData | null; onDismiss: () => void }) {
  const navigate = useNavigate();
  if (!toast) return null;
  return (
    <div className="fixed left-0 right-0 top-3 z-[60] flex justify-center px-3 pointer-events-none" role="status" aria-live="polite">
      <div className="pointer-events-auto w-full max-w-md card-paper rounded-2xl flex items-start gap-2 pl-4 pr-2 py-3 shadow-lg"
        style={{ borderLeft: "3px solid var(--color-brand)" }}>
        <Bell size={16} className="mt-0.5 shrink-0" style={{ color: "var(--color-brand)" }} />
        <button type="button" className="flex-1 min-w-0 text-left" onClick={() => { onDismiss(); navigate(toast.url); }}>
          <p className="text-sm font-semibold truncate" style={{ color: "var(--color-ink-800)" }}>{toast.title}</p>
          {toast.body && <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "var(--color-ink-500)" }}>{toast.body}</p>}
        </button>
        <button type="button" onClick={onDismiss} aria-label="閉じる" className="p-1.5 rounded-full shrink-0" style={{ color: "var(--color-ink-400)" }}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
