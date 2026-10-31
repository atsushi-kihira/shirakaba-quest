// =============================================================
// ご縁さがし — 裏で実行している検索の進み具合と、終わった検索（結果へのリンク）
// 「私のご縁」「人脈をさがす」は、始めたらすぐに画面を離れてよい。終わったら、通知・プッシュ通知・メールで知らせる。
// =============================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Loader2, X } from "lucide-react";
import { api } from "@/lib/api";

export const SEARCH_JOBS_KEY = ["enishi", "search-jobs"] as const;
export type StartSearchResponse = { data: { jobId: string } };

type SearchJob = {
  id: string; mode: "for-me" | "contact-search"; label: string;
  status: "running" | "done" | "error"; stage: string; totalBatches: number; doneBatches: number;
  historyId: string | null; resultCount: number | null; errorMessage: string | null; createdAt: number;
};

const DISMISSED_KEY = "enishi-search-jobs-dismissed";

function readDismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as string[]; } catch { return []; }
}
function saveDismissed(ids: string[]): void {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids.slice(-50))); } catch { /* 覚えられなくても、表示には影響しない */ }
}

/** いま何をしているかを、やさしい言葉で（束の照合中は、何件中何件まで進んだか） */
function progressText(j: SearchJob): string {
  if (j.stage === "prepare") return "さがす人を集めています";
  if (j.stage === "match") return j.totalBatches > 0 ? `照らし合わせています（${j.doneBatches}/${j.totalBatches}）` : "照らし合わせています";
  return "結果をまとめています";
}

export function SearchJobsBanner() {
  const { data } = useQuery({
    queryKey: SEARCH_JOBS_KEY,
    queryFn: () => api.get<{ data: SearchJob[] }>("/enishi/search-jobs/active"),
    refetchInterval: (q) => (q.state.data?.data.some((j) => j.status === "running") ? 3000 : false),
  });
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const jobs = (data?.data ?? []).filter((j) => j.status === "running" || !dismissed.includes(j.id));
  if (jobs.length === 0) return null;

  function dismiss(id: string) {
    const next = [...dismissed, id];
    setDismissed(next);
    saveDismissed(next);
  }

  return (
    <div className="space-y-2 mb-4" aria-live="polite">
      {jobs.map((j) => {
        if (j.status === "running") {
          const pct = j.stage === "match" && j.totalBatches > 0 ? Math.max(5, Math.round((j.doneBatches / j.totalBatches) * 100)) : j.stage === "prepare" ? 3 : 95;
          return (
            <div key={j.id} className="card-paper rounded-2xl p-4" style={{ borderLeft: "3px solid var(--color-accent)" }}>
              <p className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--color-ink-800)" }}>
                <Loader2 size={15} className="animate-spin shrink-0" style={{ color: "var(--color-accent)" }} />
                <span className="min-w-0 break-words">「{j.label}」をさがしています</span>
              </p>
              <div className="h-1.5 rounded-full mt-2.5 overflow-hidden" style={{ background: "var(--color-paper-200)" }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: "var(--color-accent)" }} />
              </div>
              <p className="text-xs mt-2" style={{ color: "var(--color-ink-500)" }}>
                {progressText(j)}。この画面を閉じても大丈夫です。終わったら、通知とメールでお知らせします。
              </p>
            </div>
          );
        }
        const ok = j.status === "done" && j.historyId;
        return (
          <div key={j.id} className="card-paper rounded-2xl p-4 flex items-start gap-3"
            style={{ borderLeft: `3px solid ${ok ? "var(--color-success, #5A8C5C)" : "var(--color-brand)"}` }}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium break-words" style={{ color: "var(--color-ink-800)" }}>
                {ok ? `✅ 「${j.label}」の検索が終わりました（${j.resultCount ?? 0}件）` : `「${j.label}」の検索がうまくいきませんでした`}
              </p>
              {!ok && j.errorMessage && <p className="text-xs mt-1" style={{ color: "var(--color-ink-500)" }}>{j.errorMessage}</p>}
              {ok && (
                <Link to={`/enishi/history/${j.historyId}`} className="inline-block text-xs font-medium px-3 py-1.5 rounded-full mt-2 text-white"
                  style={{ background: "var(--color-brand)" }}>
                  結果を見る
                </Link>
              )}
            </div>
            <button onClick={() => dismiss(j.id)} aria-label="閉じる" className="p-1 rounded-full shrink-0" style={{ color: "var(--color-ink-400)" }}>
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
