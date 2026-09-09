// =============================================================
// ご縁さがし 検索履歴一覧
// AIコストをかけて検索した結果を保存しておき、再検索せずに見返せるようにする。
// =============================================================
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronRight, Search, Gift, Star, Trash2, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";

type HistoryListItem = { id: string; mode: "for-me" | "giver"; title: string; createdAt: number; hasGoodMatch: boolean };

export function EnishiHistoryScreen() {
  const { termEnishi } = useSettings();
  const qc = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["enishi", "history"],
    queryFn: () => api.get<{ data: HistoryListItem[] }>("/enishi/history"),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["enishi", "history"] });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/enishi/history/${id}`),
    onMutate: (id) => setDeletingId(id),
    onSuccess: (_res, id) => {
      invalidate();
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
    },
    onSettled: () => setDeletingId(null),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => api.delete<{ data: { deleted: number } }>("/enishi/history/bulk", { ids }),
    onSuccess: () => { invalidate(); setSelected(new Set()); },
  });

  const items = data?.data ?? [];
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)));
  }

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h1 className="text-xl font-semibold flex items-center gap-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          📜 {termEnishi}さがしの検索履歴
        </h1>
        <Link to="/enishi" className="text-xs font-medium px-3 py-1.5 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          {termEnishi}さがしへ戻る
        </Link>
      </div>
      <p className="text-sm mt-1 mb-4" style={{ color: "var(--color-ink-500)" }}>
        過去に実施した検索結果です。タップすると、再検索せずにそのときの結果をそのまま確認できます。
      </p>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin" style={{ color: "var(--color-ink-400)" }} /></div>
      ) : items.length === 0 ? (
        <div className="card-paper rounded-2xl p-6 text-center">
          <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>まだ検索履歴がありません。{termEnishi}さがしで検索すると、ここに結果が残ります。</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "var(--color-ink-500)" }}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              すべて選択
            </label>
            {selected.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: "var(--color-ink-600)" }}>{selected.size}件選択中</span>
                <button
                  onClick={() => { if (confirm(`選択した${selected.size}件の検索履歴を削除しますか？`)) bulkDeleteMutation.mutate([...selected]); }}
                  disabled={bulkDeleteMutation.isPending}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium text-white disabled:opacity-50"
                  style={{ background: "var(--color-brand)" }}>
                  <Trash2 size={12} /> まとめて削除
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2.5">
            {items.map((item) => (
              <div key={item.id} className="card-paper rounded-2xl p-3.5 flex items-center gap-3">
                <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} className="shrink-0" />
                <span className="w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0"
                  style={{ background: item.mode === "for-me" ? "var(--color-paper-200)" : "#e7f0dc", color: item.mode === "for-me" ? "var(--color-accent)" : "var(--color-success)" }}>
                  {item.mode === "for-me" ? <Search size={16} /> : <Gift size={16} />}
                </span>
                <Link to={`/enishi/history/${item.id}`} className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate flex items-center gap-1.5" style={{ color: "var(--color-ink-800)" }}>
                    {item.hasGoodMatch && <Star size={12} fill="var(--color-accent)" style={{ color: "var(--color-accent)" }} />}
                    {item.title}
                  </p>
                </Link>
                <Link to={`/enishi/history/${item.id}`} className="shrink-0" style={{ color: "var(--color-ink-400)" }}>
                  <ChevronRight size={16} />
                </Link>
                <button
                  onClick={() => { if (confirm("この検索履歴を削除しますか？")) deleteMutation.mutate(item.id); }}
                  disabled={deletingId === item.id}
                  className="shrink-0 p-1.5 rounded-lg disabled:opacity-50" style={{ color: "var(--color-ink-400)" }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
