// =============================================================
// ホームの「所在地の入力のお願い」
// 会社・屋号の所在地（都道府県）を自動では調べられなかったメンバーに、ホーム画面から選んで入力してもらう。
// 入力（保存）すると、この案内は出なくなる。
// =============================================================
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { LOCATION_VALUES } from "@shared/prefectures";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

export function PrefecturePromptCard() {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const setAuth = useAuthStore((s) => s.setAuth);
  const [value, setValue] = useState("");

  const save = useMutation({
    mutationFn: () => api.patch("/members/me", { prefecture: value }),
    onSuccess: () => {
      if (user && token) setAuth(token, { ...user, prefecture: value, prefectureStatus: "manual" });
    },
  });

  // 自動では分からなかった人だけに出す（自動入力の途中・入力済み・手で入力済みの人には出さない）
  const unknown = user?.prefectureStatus === "not_found" || user?.prefectureStatus === "error";
  if (!user || !unknown || user.prefecture) return null;

  return (
    <div className="px-4 py-3 rounded-2xl space-y-2" style={{ background: "rgba(212,160,59,0.12)", border: "1px solid rgba(212,160,59,0.35)" }}>
      <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>
        📍 会社・屋号の所在地（都道府県）を教えてください
      </p>
      <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
        自動では調べきれませんでした。なかま一覧で、所在地ごとに分けて見られるようになります。
      </p>
      <div className="flex items-center gap-2">
        <select value={value} onChange={(e) => setValue(e.target.value)} disabled={save.isPending}
          className="flex-1 min-w-0 rounded-xl px-2 py-2 text-sm outline-none"
          style={{ background: "var(--color-paper-50)", border: "1.5px solid var(--color-paper-300)", color: "var(--color-ink-800)" }}>
          <option value="">選んでください</option>
          {LOCATION_VALUES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button type="button" onClick={() => save.mutate()} disabled={!value || save.isPending}
          className="shrink-0 inline-flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--color-brand)" }}>
          {save.isPending && <Loader2 size={14} className="animate-spin" />}
          保存する
        </button>
      </div>
      {save.isError && (
        <p className="text-xs" style={{ color: "var(--color-brand)" }}>
          保存できませんでした。通信状況をご確認のうえ、もう一度お試しください。
        </p>
      )}
    </div>
  );
}
