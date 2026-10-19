// =============================================================
// 管理者向け — メンバーのメールアドレスを代行で変更する
// 本人が古いメールアドレスを使えず、確認メールを受け取れない場合に使う
// =============================================================
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";

type AdminChangeEmailModalProps = {
  member: { id: string; name: string; email: string };
  onClose: () => void;
  onDone: () => void;
};

export function AdminChangeEmailModal({ member, onClose, onDone }: AdminChangeEmailModalProps) {
  const [newEmail, setNewEmail] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: () => api.patch(`/admin/members/${member.id}/email`, { email: newEmail.trim() }),
    onSuccess: onDone,
    onError: (e) => {
      setConfirming(false);
      setError(e instanceof ApiError ? e.message : "変更できませんでした。もう一度お試しください。");
    },
  });

  function goConfirm() {
    setError(null);
    if (!newEmail.trim().includes("@")) { setError("メールアドレスを入力してください"); return; }
    setConfirming(true);
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

        <p className="text-sm font-medium mb-1" style={{ color: "var(--color-ink-800)" }}>{member.name} さん</p>
        <p className="text-xs mb-3 break-all" style={{ color: "var(--color-ink-500)" }}>いまのメールアドレス：{member.email}</p>

        {!confirming ? (
          <>
            <p className="text-xs mb-3 px-2.5 py-1.5 rounded-lg" style={{ background: "rgba(212,160,59,0.12)", color: "var(--color-ink-700)" }}>
              本人が確認メールを受け取れない場合のための操作です。メールでの本人確認は行わず、すぐに切り替わります。
              本人がいまのメールアドレスを使える場合は、マイページの「メールアドレスを変更する」から変更してもらってください。
            </p>
            <label className="text-xs font-medium block mb-1" style={{ color: "var(--color-ink-700)" }}>新しいメールアドレス</label>
            <input
              type="email"
              inputMode="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="例：new@example.com"
              className="w-full px-3 py-2.5 rounded-xl text-sm mb-3"
              style={{ background: "var(--color-paper-100)", border: "1.5px solid var(--color-paper-300)", color: "var(--color-ink-800)" }}
            />
            {error && (
              <p className="text-xs mb-3 px-2.5 py-1.5 rounded-lg" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>{error}</p>
            )}
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl text-sm font-medium"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
              <button onClick={goConfirm} disabled={newEmail.trim().length === 0}
                className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "var(--color-brand)" }}>確認へ進む</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm mb-3" style={{ color: "var(--color-ink-800)" }}>
              {member.name} さんのメールアドレスを、次のとおり変更します。よろしいですか？
            </p>
            <div className="text-xs px-3 py-2 rounded-xl mb-3 break-all space-y-1" style={{ background: "var(--color-paper-100)", color: "var(--color-ink-700)" }}>
              <div>変更前：{member.email}</div>
              <div className="font-semibold" style={{ color: "var(--color-ink-900)" }}>変更後：{newEmail.trim().toLowerCase()}</div>
            </div>
            <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
              今後のログインや各種のお知らせは、変更後のメールアドレス宛てになります。変更前のメールアドレスには、変更のお知らせを送ります。
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirming(false)} disabled={change.isPending}
                className="flex-1 py-2.5 rounded-2xl text-sm font-medium"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>戻る</button>
              <button onClick={() => change.mutate()} disabled={change.isPending}
                className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-1.5"
                style={{ background: "var(--color-brand)" }}>
                {change.isPending && <Loader2 size={14} className="animate-spin" />}
                変更する
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
