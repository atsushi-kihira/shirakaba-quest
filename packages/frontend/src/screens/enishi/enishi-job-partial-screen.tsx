// =============================================================
// ご縁さがし — 検索の途中の結果
// 裏で実行している検索のうち、照合が終わった分だけの結果を、先に見られる。まだ途中なので、結果は増えたり、順番が変わったりする。
// 終わったら、保存された最終の結果（検索履歴）に切り替える。
// API：/api/enishi/search-jobs/:id/partial（backend: services/enishi-search-job.ts の buildPartialJobView）
// =============================================================
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { ResultGroups, PageSizeSelect } from "./enishi-search-screen";
import type { SearchResult } from "./enishi-search-screen";

type PartialView =
  | { status: "running"; mode: "for-me" | "contact-search"; label: string; stage: string; totalBatches: number; doneBatches: number; failedBatches: number; result: SearchResult | null }
  | { status: "done"; historyId: string | null }
  | { status: "error"; message: string };

const noop = () => { /* 途中の結果は、閲覧だけ */ };

export function EnishiJobPartialScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [pageSize, setPageSize] = useState(10);
  const { data, isLoading, error } = useQuery({
    queryKey: ["enishi", "search-jobs", id, "partial"],
    queryFn: () => api.get<{ data: PartialView }>(`/enishi/search-jobs/${id}/partial`).then((r) => r.data),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 8000 : false),
  });

  // 終わっていたら、保存された最終の結果に切り替える
  useEffect(() => {
    if (data?.status === "done" && data.historyId) navigate(`/enishi/history/${data.historyId}`, { replace: true });
  }, [data, navigate]);

  const running = data?.status === "running" ? data : null;
  const progress = running && running.totalBatches > 0 ? `約${Math.min(99, Math.round(((running.doneBatches + running.failedBatches) / running.totalBatches) * 100))}%` : null;

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h1 className="text-lg font-semibold break-words min-w-0" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          {running ? `「${running.label}」の途中の結果` : "検索の途中の結果"}
        </h1>
        <Link to="/enishi" className="text-xs font-medium px-3 py-1.5 rounded-full shrink-0" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          ご縁さがしへ戻る
        </Link>
      </div>

      {isLoading && <div className="flex justify-center py-10"><Loader2 className="animate-spin" style={{ color: "var(--color-ink-400)" }} /></div>}

      {(error || data?.status === "error") && (
        <div className="card-paper rounded-2xl p-6 text-center mt-4">
          <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
            {data?.status === "error" ? data.message : error instanceof ApiError ? error.message : "途中の結果を読み込めませんでした。時間をおいて、もう一度お試しください。"}
          </p>
        </div>
      )}

      {data?.status === "done" && !data.historyId && (
        <div className="card-paper rounded-2xl p-6 text-center mt-4"><p className="text-sm" style={{ color: "var(--color-ink-500)" }}>検索が終わりました。履歴からご覧ください。</p></div>
      )}

      {running && (
        <>
          <div className="rounded-2xl p-3 mt-2 text-xs" role="status" style={{ background: "rgba(212,160,59,0.14)", color: "var(--color-ink-700)" }}>
            <p className="font-medium flex items-center gap-1.5">
              <Loader2 size={13} className="animate-spin shrink-0" />🔄 検索の途中です{progress ? `（${progress}まで照合が進んでいます）` : ""}
            </p>
            <p className="mt-1">
              ここに出ているのは、照合が終わった分だけです。結果は増えたり、順番が変わったりします。この画面は、自動で新しくなります。
              終わったら、通知とメールでお知らせします。
            </p>
            {running.failedBatches > 0 && <p className="mt-1">AIの検索に時間がかかっている分があり、その分は、今回の結果に含まれないことがあります。</p>}
          </div>

          {!running.result ? (
            <div className="card-paper rounded-2xl p-6 text-center mt-4">
              <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>まだ、照合が終わった分がありません。少し待つと、ここに出てきます。</p>
            </div>
          ) : (
            <>
              <div className="mt-4"><PageSizeSelect value={pageSize} onChange={setPageSize} /></div>
              <ResultGroups result={running.result} historyId={`job-${id}`} mode={running.mode} pageSize={pageSize} readOnly
                onToggleGoodMatch={noop} onRemoveTransacted={noop} onRemoveHidden={noop} onRemoveIntroduced={noop} onCardsRemoved={noop} />
            </>
          )}
        </>
      )}
    </div>
  );
}
