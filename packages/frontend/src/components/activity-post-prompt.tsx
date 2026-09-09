// =============================================================
// 協働の活動タイムラインへの投稿を促すプロンプト（パイロット限定機能）
// 1to1完了時・ミーティング完了時・チーム結成時など、投稿にちょうど良い
// タイミングで能動的に表示する。「あとで」でいつでも見送れる。
// =============================================================
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api } from "@/lib/api";

type Props = {
  title: string;
  description: string;
  contextType: "link" | "team";
  partnerId?: string;
  teamId?: string;
  suggestedBody: string;
  onClose: () => void;
};

export function ActivityPostPrompt({ title, description, contextType, partnerId, teamId, suggestedBody, onClose }: Props) {
  const qc = useQueryClient();
  const [body, setBody] = useState(suggestedBody);
  const [error, setError] = useState("");

  const post = useMutation({
    mutationFn: () => api.post("/collab/posts", {
      contextType,
      partnerId: contextType === "link" ? partnerId : undefined,
      teamId: contextType === "team" ? teamId : undefined,
      body: body.trim() || undefined,
      visibility: "chapter",
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collab", "feed"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message || "投稿に失敗しました"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            {title}
          </h2>
          <button onClick={onClose} className="shrink-0"><X size={18} style={{ color: "var(--color-ink-400)" }} /></button>
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>{description}</p>

        <textarea value={body} onChange={(e) => setBody(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border text-sm resize-none mb-3" rows={3}
          style={{ borderColor: "var(--color-paper-300)" }} />

        {error && <p className="text-xs mb-3" style={{ color: "var(--color-brand)" }}>{error}</p>}

        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-2xl text-sm font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            あとで
          </button>
          <button onClick={() => post.mutate()} disabled={post.isPending}
            className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}>
            投稿する
          </button>
        </div>
      </div>
    </div>
  );
}
