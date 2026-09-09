// =============================================================
// ご縁さがし 検索履歴の詳細
// 保存済みの検索結果をそのまま表示する（再検索は行わない）。
// =============================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { ResultGroups, PageSizeSelect, updateCardGoodMatch, removeTransactedCandidate, removeHiddenCandidate, removeIntroducedCandidate } from "./enishi-search-screen";
import type { SearchResult } from "./enishi-search-screen";

type HistoryDetail = { id: string; mode: "for-me" | "giver"; title: string; createdAt: number; result: SearchResult };

export function EnishiHistoryDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ["enishi", "history", id],
    queryFn: () => api.get<{ data: HistoryDetail }>(`/enishi/history/${id}`),
    enabled: !!id,
  });
  // 表示中の履歴IDとセットで保持し、別の履歴に遷移した際は保存済みの結果で正しく初期化し直す
  // （良いご縁フラグの切替はローカルの result state だけを更新するため、単純な「一度だけセット」だと
  // 別の履歴へ遷移してもここが更新されず前の結果が残ってしまう）
  const [resultState, setResultState] = useState<{ historyId: string; result: SearchResult } | null>(null);
  const [pageSize, setPageSize] = useState(10);

  const detail = data?.data;
  if (detail && resultState?.historyId !== detail.id) {
    setResultState({ historyId: detail.id, result: detail.result });
  }
  const result = resultState?.historyId === detail?.id ? resultState?.result ?? null : null;

  function toggleGoodMatch(cardId: string, goodMatch: boolean) {
    setResultState((prev) => prev && { ...prev, result: updateCardGoodMatch(prev.result, cardId, goodMatch) });
  }

  function removeTransacted(candidateId: string) {
    setResultState((prev) => prev && { ...prev, result: removeTransactedCandidate(prev.result, candidateId) });
  }

  function removeHidden(candidateId: string) {
    setResultState((prev) => prev && { ...prev, result: removeHiddenCandidate(prev.result, candidateId) });
  }

  function removeIntroduced(myContactId: string, candidateId: string) {
    setResultState((prev) => prev && { ...prev, result: removeIntroducedCandidate(prev.result, myContactId, candidateId) });
  }

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h1 className="text-lg font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          {detail?.title ?? "検索履歴"}
        </h1>
        <Link to="/enishi/history" className="text-xs font-medium px-3 py-1.5 rounded-full shrink-0" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          履歴一覧へ戻る
        </Link>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin" style={{ color: "var(--color-ink-400)" }} /></div>
      ) : error || !detail ? (
        <div className="card-paper rounded-2xl p-6 text-center mt-4">
          <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>指定された検索履歴が見つかりませんでした。</p>
        </div>
      ) : result ? (
        <>
          <div className="flex items-center gap-2 mt-3">
            <span className="text-xs font-medium" style={{ color: "var(--color-ink-600)" }}>表示件数</span>
            <PageSizeSelect value={pageSize} onChange={setPageSize} />
          </div>
          <ResultGroups result={result} historyId={detail.id} mode={detail.mode} pageSize={pageSize}
            onToggleGoodMatch={toggleGoodMatch} onRemoveTransacted={removeTransacted} onRemoveHidden={removeHidden} onRemoveIntroduced={removeIntroduced} />
        </>
      ) : null}
    </div>
  );
}
