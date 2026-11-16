// =============================================================
// 「日時を選び直す」ボタン（1to1の回答者向け）
// 候補日から選び間違えた・予約ページで違う日時を選んでしまったときに、
// 確定済みの日時と会議URLをいったん取り消して、選択画面に戻す。
// 押したあとは、同じ画面に候補日の一覧（または予約ページへのリンク）が再び表示される。
// =============================================================
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw } from "lucide-react";
import { api, ApiError } from "@/lib/api";

export function ReselectScheduleButton({
  sessionId,
  method,
  partnerName,
  onDone,
  className,
}: {
  sessionId: string;
  method: "candidates" | "public_url";
  partnerName?: string;
  onDone?: () => void;
  className?: string;
}) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.patch(`/oneonone/${sessionId}/reopen-schedule`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["oneonone"] });
      qc.invalidateQueries({ queryKey: ["scheduler", "bookings", "upcoming"] });
      onDone?.();
    },
  });

  function handleClick() {
    const how = method === "candidates"
      ? "取り消したあと、候補日の一覧からもう一度お選びいただけます。"
      : `取り消したあと、${partnerName ?? "相手"}さんの予約ページからもう一度お選びいただけます。`;
    if (!confirm(`いまの日時と会議URLをいったん取り消して、選び直しますか？\n\n${how}`)) return;
    mutation.mutate();
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleClick}
        disabled={mutation.isPending}
        className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-medium disabled:opacity-50"
        style={{ background: "white", color: "var(--color-ink-700)", border: "1px solid var(--color-paper-300)" }}
      >
        {mutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
        日時を選び直す
      </button>
      {mutation.isError && (
        <p className="text-xs mt-1.5 px-2.5 py-1.5 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>
          {mutation.error instanceof ApiError ? mutation.error.message : "エラーが発生しました。時間をおいて、もう一度お試しください。"}
        </p>
      )}
    </div>
  );
}
