// =============================================================
// マイページ — メールアドレスの変更（本人）
// 新しいメールアドレスに確認メールを送り、メール内のリンクを開くと切り替わる
// =============================================================
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, X, MailCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api";

type ChangeEmailModalProps = {
  currentEmail: string;
  onClose: () => void;
};

export function ChangeEmailModal({ currentEmail, onClose }: ChangeEmailModalProps) {
  const [newEmail, setNewEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const request = useMutation({
    mutationFn: () => api.post<{ data: { sentTo: string } }>("/email-change/request", { newEmail: newEmail.trim() }),
    onSuccess: (res) => setSentTo(res.data.sentTo),
    onError: (e) => setError(e instanceof ApiError ? e.message : "送信できませんでした。通信状況をご確認のうえ、もう一度お試しください。"),
  });

  function submit() {
    setError(null);
    const value = newEmail.trim();
    if (!value.includes("@")) { setError("メールアドレスを入力してください"); return; }
    request.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            ✉️ メールアドレスを変更する
          </h2>
          <button onClick={onClose} aria-label="閉じる" className="shrink-0"><X size={18} style={{ color: "var(--color-ink-400)" }} /></button>
        </div>

        {sentTo ? (
          <div className="text-center py-2">
            <MailCheck size={40} className="mx-auto mb-3" style={{ color: "var(--color-success)" }} />
            <p className="text-sm font-semibold mb-2" style={{ color: "var(--color-ink-800)" }}>確認メールを送りました</p>
            <p className="text-sm mb-1 break-all" style={{ color: "var(--color-ink-700)" }}>{sentTo}</p>
            <p className="text-xs mb-4" style={{ color: "var(--color-ink-500)" }}>
              届いたメールの中のリンクを開くと、変更が完了します（24時間以内）。<br />
              リンクを開くまでは、これまでのメールアドレスのままです。<br />
              メールが届かないときは、迷惑メールフォルダもご確認ください。
            </p>
            <button onClick={onClose} className="w-full py-2.5 rounded-2xl text-sm font-medium text-white" style={{ background: "var(--color-brand)" }}>
              閉じる
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
              ログインや各種のお知らせの送り先になるメールアドレスを変更します。新しいメールアドレスに確認メールをお送りします。
            </p>
            <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>いまのメールアドレス</p>
            <p className="text-sm mb-3 break-all" style={{ color: "var(--color-ink-800)" }}>{currentEmail}</p>

            <label className="text-xs font-medium block mb-1" style={{ color: "var(--color-ink-700)" }}>新しいメールアドレス</label>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !request.isPending) submit(); }}
              placeholder="例：new@example.com"
              className="w-full px-3 py-2.5 rounded-xl text-sm mb-3"
              style={{ background: "var(--color-paper-100)", border: "1.5px solid var(--color-paper-300)", color: "var(--color-ink-800)" }}
            />

            {error && (
              <p className="text-xs mb-3 px-2.5 py-1.5 rounded-lg" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>{error}</p>
            )}

            <div className="flex gap-2">
              <button onClick={onClose}
                className="flex-1 py-2.5 rounded-2xl text-sm font-medium"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                キャンセル
              </button>
              <button onClick={submit} disabled={request.isPending || newEmail.trim().length === 0}
                className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-1.5"
                style={{ background: "var(--color-brand)" }}>
                {request.isPending && <Loader2 size={14} className="animate-spin" />}
                確認メールを送る
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
