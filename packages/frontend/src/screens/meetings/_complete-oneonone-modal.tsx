// =============================================================
// 1to1完了時の確認ダイアログ
// 「協業・協働の可能性がありそう」「リファーラルを提供できそう」を
// 完了のタイミングでまとめて確認する（パイロット限定・任意入力）
// =============================================================
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { ActivityPostPrompt } from "@/components/activity-post-prompt";

export function CompleteOneOnOneModal({
  sessionId,
  partnerId,
  partnerName,
  onClose,
}: {
  sessionId: string;
  partnerId: string;
  partnerName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [possible, setPossible] = useState(false);
  const [referral, setReferral] = useState(false);
  const [showPostPrompt, setShowPostPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedOnServer, setCompletedOnServer] = useState(false);

  const submit = useMutation({
    mutationFn: async () => {
      // /complete は一度成功すると再実行できない（already_completed）ため、
      // 再試行時にpossible/referralの送信だけやり直せるよう成功済みかを覚えておく。
      if (!completedOnServer) {
        await api.patch(`/oneonone/${sessionId}/complete`);
        setCompletedOnServer(true);
      }
      // possible/referralは同一の相手リンク行を更新するため、同時実行だと
      // 初回作成時にレースしうる。安全のため順番に送る。
      if (possible) await api.post("/collab/links/possible", { otherMemberId: partnerId, on: true });
      if (referral) await api.post("/collab/links/referral", { otherMemberId: partnerId, on: true });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["oneonone"] });
      qc.invalidateQueries({ queryKey: ["ranking", "me"] });
      qc.invalidateQueries({ queryKey: ["collab", "graph"] });
      setShowPostPrompt(true);
    },
    onError: (e) => {
      // 1to1自体の完了は先にawaitして成功しているため、ここで失敗しても
      // 完了ステータスは既に反映済み。ユーザーには分かる形でエラーを出し、
      // ダイアログが無反応のまま残らないようにする。
      setError(e instanceof ApiError ? e.message : "保存に失敗しました。もう一度お試しください");
    },
  });

  if (showPostPrompt) {
    return (
      <ActivityPostPrompt
        title={`🎉 ${partnerName}さんとの1to1、お疲れさまでした！`}
        description="協働マップの活動タイムラインに、今日の1to1について残しませんか？"
        contextType="link"
        partnerId={partnerId}
        suggestedBody={`${partnerName}さんと1to1をしました！`}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl">
        <h2 className="text-base font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          🤝 {partnerName}さんとの1to1、お疲れさまでした！
        </h2>
        <p className="text-xs mb-4" style={{ color: "var(--color-ink-500)" }}>
          当てはまるものがあればチェックしてください（なくても大丈夫です）
        </p>

        <label className="flex items-start gap-2 py-2.5 px-3 rounded-2xl cursor-pointer mb-2"
          style={{ background: possible ? "rgba(212,160,59,0.15)" : "var(--color-paper-200)" }}>
          <input type="checkbox" className="mt-0.5" checked={possible} onChange={(e) => setPossible(e.target.checked)} />
          <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>
            🌱 協業・協働の可能性がありそう
          </span>
        </label>
        <label className="flex items-start gap-2 py-2.5 px-3 rounded-2xl cursor-pointer mb-4"
          style={{ background: referral ? "rgba(90,140,92,0.12)" : "var(--color-paper-200)" }}>
          <input type="checkbox" className="mt-0.5" checked={referral} onChange={(e) => setReferral(e.target.checked)} />
          <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>
            🤝 リファーラルを提供できそう
          </span>
        </label>

        {error && (
          <p className="text-xs mb-2" style={{ color: "var(--color-brand)" }}>
            1to1の完了は記録されています。{error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => { setError(null); submit.mutate(); }}
            disabled={submit.isPending}
            className="flex-1 py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}
          >
            {submit.isPending && <Loader2 size={14} className="animate-spin" />}
            {error ? "もう一度試す" : "完了"}
          </button>
          {error && (
            <button
              onClick={onClose}
              className="px-4 py-3 rounded-2xl text-sm font-medium"
              style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
            >
              閉じる
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
