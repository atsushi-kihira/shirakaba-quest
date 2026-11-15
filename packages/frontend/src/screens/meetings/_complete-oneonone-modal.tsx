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
import { DialogCloseButton } from "@/components/dialog-close-button";
import { ProfileSheetImportModal } from "@/components/profile-sheet/profile-sheet-import-modal";
import { todayIso, useProfileSheet } from "@/components/profile-sheet/profile-sheet-shared";
import { useTimezone } from "@/hooks/use-timezone";

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
  // もらった資料（略歴シート・GAINSシートなど）の取り込み
  const tz = useTimezone();
  const { data: existingSheet } = useProfileSheet("member", partnerId);
  const [sheetOpenDate, setSheetOpenDate] = useState<string | null>(null);

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

  // 「完了」ボタンを押すまでは、1to1は完了になりません。閉じる・キャンセル・Esc は、完了せずにダイアログを閉じます。
  // （完了の記録が済んだあとのエラー表示中は、閉じても完了は取り消されません）
  const close = () => { if (!submit.isPending) onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={close}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            🤝 {partnerName}さんとの1to1、お疲れさまでした！
          </h2>
          <DialogCloseButton onClick={close} disabled={submit.isPending} />
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--color-ink-500)" }}>
          当てはまるものがあればチェックしてください（なくても大丈夫です）。
          {!completedOnServer && "「完了」を押すと1to1が完了になります。まだ完了しない場合は「キャンセル」で閉じてください。"}
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

        <div className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-2xl mb-4" style={{ background: existingSheet ? "rgba(90,140,92,0.12)" : "var(--color-paper-200)" }}>
          <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>
            {existingSheet ? "📎 もらった資料を、取り込み済みです" : "📎 もらった資料はありますか？"}
            <span className="block text-[11px] mt-0.5" style={{ color: "var(--color-ink-500)" }}>
              略歴シート・GAINSシート・1to1シートなど。あなただけが見られます（任意）
            </span>
          </span>
          <button onClick={() => setSheetOpenDate(todayIso(tz))} disabled={submit.isPending}
            className="shrink-0 px-3 py-2 rounded-xl text-xs font-medium disabled:opacity-50" style={{ background: "var(--color-brand)", color: "white" }}>
            {existingSheet ? "見る・直す" : "取り込む"}
          </button>
        </div>

        {error && (
          <p className="text-xs mb-2" style={{ color: "var(--color-brand)" }}>
            1to1の完了は記録されています。{error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={close}
            disabled={submit.isPending}
            data-dialog-cancel
            className="px-5 py-3 rounded-2xl text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
          >
            {completedOnServer ? "閉じる" : "キャンセル"}
          </button>
          <button
            onClick={() => { setError(null); submit.mutate(); }}
            disabled={submit.isPending}
            className="flex-1 py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}
          >
            {submit.isPending && <Loader2 size={14} className="animate-spin" />}
            {error ? "もう一度試す" : "完了"}
          </button>
        </div>
      </div>
      {sheetOpenDate !== null && (
        <div onClick={(e) => e.stopPropagation()}>
        <ProfileSheetImportModal
          subject={{ type: "member", id: partnerId, name: partnerName }}
          existing={existingSheet ?? null}
          defaultDate={sheetOpenDate}
          startAtEdit={!!existingSheet}
          onClose={() => setSheetOpenDate(null)}
          onDone={() => setSheetOpenDate(null)}
        />
        </div>
      )}
    </div>
  );
}
