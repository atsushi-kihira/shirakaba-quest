// =============================================================
// 協働マップ — 協働チームの並びに表示する「検討中のチーム案」のカード
// チーム案は、作った本人だけに見える（他のユーザーには見えない）。緩いチーム・パワーチームと同じ並びに表示する。
// =============================================================
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import type { TeamDraftListItem } from "./team-drafts-screen";

export function TeamDraftCards() {
  const { data } = useQuery({
    queryKey: ["collab", "team-drafts"],
    queryFn: () => api.get<{ data: TeamDraftListItem[] }>("/collab/team-drafts"),
  });
  const drafts = data?.data ?? [];
  if (drafts.length === 0) return null;
  return (
    <div className="space-y-2 mb-2">
      {drafts.map((d) => (
        <Link key={d.id} to={`/collab/drafts/${d.id}`}
          className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80"
          style={{ border: "1.5px dashed var(--color-ink-300)" }}>
          <span className="text-xl shrink-0">🧪</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: "var(--color-ink-800)" }}>
              {d.title}
              <span className="text-[10px] font-bold ml-2 px-2 py-0.5 rounded-md align-middle" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>チーム案（検討中）</span>
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>🔒 あなただけに表示　{d.memberCount}名{d.hasIdeas ? "　協働事業をまとめ済み" : ""}</p>
          </div>
          <ChevronRight size={16} className="shrink-0" style={{ color: "var(--color-ink-400)" }} />
        </Link>
      ))}
    </div>
  );
}
