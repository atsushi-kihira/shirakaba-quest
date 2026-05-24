// =============================================================
// 管理画面 — ポイントリセット
// =============================================================
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { RotateCcw, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";

type ResetResult = { ok: boolean; affectedMembers: number };

export function AdminPointsScreen() {
  const [label, setLabel] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [result, setResult] = useState<ResetResult | null>(null);

  const reset = useMutation({
    mutationFn: () => api.post<ResetResult>("/admin/points/reset", { label: label.trim() || undefined }),
    onSuccess: (res) => {
      setResult(res);
      setShowConfirm(false);
      setLabel("");
    },
  });

  return (
    <div className="px-4 py-6 lg:px-0 max-w-md">
      <h1 className="text-2xl font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
        🔄 ポイントリセット
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-ink-500)" }}>
        全アクティブメンバーのポイントを0にリセットします。この操作は取り消せません。
      </p>

      {result && (
        <div className="mb-6 p-4 rounded-2xl text-sm"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
          ✅ リセット完了！{result.affectedMembers} 名のポイントをリセットしました。
        </div>
      )}

      <div className="card-paper p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
            リセット理由・ラベル（任意）
          </label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例: 2024年度第1期終了"
            className="w-full px-3 py-2 rounded-xl border text-sm"
            style={{ borderColor: "var(--color-paper-300)" }}
          />
          <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
            入力するとポイント履歴の備考として記録されます
          </p>
        </div>

        <div className="p-3 rounded-2xl flex gap-2"
          style={{ background: "rgba(181,56,75,0.08)" }}>
          <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: "var(--color-brand)" }} />
          <p className="text-xs" style={{ color: "var(--color-brand)" }}>
            この操作を実行すると、全アクティブメンバーのポイントが0になります。
            ポイント履歴は削除されません（マイナスの取引として記録されます）。
          </p>
        </div>

        <button
          onClick={() => setShowConfirm(true)}
          className="w-full py-3 rounded-2xl font-semibold text-white transition hover:opacity-80 flex items-center justify-center gap-2"
          style={{ background: "var(--color-brand)" }}
        >
          <RotateCcw size={16} />
          ポイントをリセットする
        </button>
      </div>

      {/* 確認ダイアログ */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => !reset.isPending && setShowConfirm(false)}>
          <div className="card-paper p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={20} style={{ color: "var(--color-brand)" }} />
              <h3 className="font-semibold text-lg" style={{ fontFamily: "var(--font-klee)" }}>
                本当にリセットしますか？
              </h3>
            </div>
            <p className="text-sm mb-1" style={{ color: "var(--color-ink-600)" }}>
              全アクティブメンバーのポイントを0にします。
            </p>
            {label && (
              <p className="text-sm mb-4" style={{ color: "var(--color-ink-500)" }}>
                ラベル: <strong>{label}</strong>
              </p>
            )}
            <p className="text-sm mb-4" style={{ color: "var(--color-brand)" }}>
              この操作は取り消せません。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={reset.isPending}
                className="flex-1 py-2.5 rounded-2xl text-sm font-medium"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
              >
                キャンセル
              </button>
              <button
                onClick={() => reset.mutate()}
                disabled={reset.isPending}
                className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-1"
                style={{ background: "var(--color-brand)" }}
              >
                {reset.isPending ? (
                  <>
                    <RotateCcw size={14} className="animate-spin" />
                    処理中...
                  </>
                ) : "リセットする"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
