// =============================================================
// 協働マップ — 「チームを検討してみる」：検討中のチーム案の一覧と、新しい案の作成
// チーム案は、作った本人だけに見える（他のユーザーには見えない）
// =============================================================
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { DialogCloseButton } from "@/components/dialog-close-button";
import { useTimezone } from "@/hooks/use-timezone";
import { fmtDateShort } from "@/lib/date";

export type TeamDraftListItem = { id: string; title: string; memberCount: number; hasIdeas: boolean; updatedAt: number };

export function TeamDraftsScreen() {
  const navigate = useNavigate();
  const tz = useTimezone();
  const [showCreate, setShowCreate] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["collab", "team-drafts"],
    queryFn: () => api.get<{ data: TeamDraftListItem[] }>("/collab/team-drafts"),
  });
  const drafts = data?.data ?? [];

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-2">
        <Link to="/collab" className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "var(--color-paper-200)" }} aria-label="協働マップに戻る">
          <ChevronLeft size={20} style={{ color: "var(--color-ink-600)" }} />
        </Link>
        <h1 className="text-lg font-bold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>🔍 チームを検討してみる</h1>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--color-ink-500)" }}>
        一緒に組めそうなメンバーや、自分の外部人脈の方を選んで、協働事業のイメージと、それぞれの役割をまとめられます。
        ここに保存するチーム案は<b>あなただけに見える</b>ので、他のメンバーには知られません。十分に検討できたら、緩いチームやパワーチームとして正式に結成できます。
      </p>

      <button onClick={() => setShowCreate(true)}
        className="w-full py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-1.5 mb-4"
        style={{ background: "var(--color-brand)" }}>
        <Plus size={15} /> 新しいチーム案を作る
      </button>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin" style={{ color: "var(--color-brand)" }} /></div>
      ) : error ? (
        <p className="text-sm text-center py-8" style={{ color: "var(--color-brand)" }}>チーム案を取得できませんでした。時間をおいてもう一度お試しください。</p>
      ) : drafts.length === 0 ? (
        <div className="card-paper rounded-2xl p-8 text-center">
          <p className="text-3xl mb-2">🧪</p>
          <p className="text-sm font-medium mb-1" style={{ color: "var(--color-ink-700)" }}>検討中のチーム案はまだありません</p>
          <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>「新しいチーム案を作る」から、気になる組み合わせを試してみましょう</p>
        </div>
      ) : (
        <div className="space-y-2">
          {drafts.map((d) => (
            <Link key={d.id} to={`/collab/drafts/${d.id}`} className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80">
              <span className="text-2xl shrink-0">🧪</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: "var(--color-ink-800)" }}>{d.title}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
                  {d.memberCount}名（自分を含む）　{d.hasIdeas ? "協働事業をまとめ済み" : "まだ協働事業をまとめていません"}　{fmtDateShort(d.updatedAt, tz)}更新
                </p>
              </div>
              <ChevronRight size={16} className="shrink-0" style={{ color: "var(--color-ink-400)" }} />
            </Link>
          ))}
        </div>
      )}

      {showCreate && <CreateDraftModal onClose={() => setShowCreate(false)} onCreated={(id) => navigate(`/collab/drafts/${id}`)} />}
    </div>
  );
}

function CreateDraftModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<{ data: { id: string } }>("/collab/team-drafts", { title: title.trim(), goal: goal.trim() }),
    onSuccess: (res) => onCreated(res.data.id),
    onError: (e) => setError(e instanceof ApiError ? e.message : "作成できませんでした。もう一度お試しください。"),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-3">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>🧪 新しいチーム案</h2>
          <DialogCloseButton onClick={onClose} />
        </div>
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>チーム案のタイトル *</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="例：相続まるごとサポートチーム案"
          className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }} />
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>どんな協業を考えたいか（任意）</label>
        <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} maxLength={1000}
          placeholder="例：ご家族を亡くされた方の、手続きから実家の整理・売却までを一緒に支えたい"
          className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }} />
        {error && <p className="text-xs mb-3" style={{ color: "var(--color-brand)" }}>{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} data-dialog-cancel className="flex-1 py-2.5 rounded-2xl text-sm font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button onClick={() => { setError(null); if (!title.trim()) { setError("タイトルを入力してください"); return; } create.mutate(); }}
            disabled={create.isPending}
            className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-1.5"
            style={{ background: "var(--color-brand)" }}>
            {create.isPending && <Loader2 size={14} className="animate-spin" />}作成して、メンバーを選ぶ
          </button>
        </div>
      </div>
    </div>
  );
}
