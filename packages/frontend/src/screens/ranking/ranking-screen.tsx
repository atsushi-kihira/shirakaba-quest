// =============================================================
// ランキング画面
// =============================================================
import { useQuery } from "@tanstack/react-query";
import { Loader2, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

type RankingEntry = {
  rank: number;
  member: { id: string; name: string; furigana: string; emoji: string; bgColor: string; category: string };
  points: number;
  lastPointedAt: number | null;
};
type RankingResponse = { data: RankingEntry[] };

const RANK_MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export function RankingScreen() {
  const me = useAuthStore((s) => s.user);
  const { data, isLoading } = useQuery({
    queryKey: ["ranking"],
    queryFn: () => api.get<RankingResponse>("/ranking"),
  });

  const entries = data?.data ?? [];

  return (
    <div className="px-4 py-6 pb-24">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          🏆 ランキング
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-ink-500)" }}>
          1to1・お題クリアでポイントを稼ごう
        </p>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
        </div>
      )}

      {!isLoading && (
        <div className="space-y-2">
          {entries.map((entry) => {
            const isMe = entry.member.id === me?.id;
            const medal = RANK_MEDAL[entry.rank];
            return (
              <div
                key={entry.member.id}
                className={`card-paper rounded-2xl px-4 py-3 flex items-center gap-3 ${isMe ? "ring-2" : ""}`}
                style={isMe ? { "--tw-ring-color": "var(--color-brand)" } as React.CSSProperties : {}}
              >
                {/* 順位 */}
                <div className="w-9 text-center shrink-0">
                  {medal
                    ? <span className="text-2xl">{medal}</span>
                    : <span className="font-bold text-sm" style={{ color: "var(--color-ink-400)" }}>{entry.rank}</span>
                  }
                </div>

                {/* アバター */}
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${entry.member.bgColor}`}>
                  {entry.member.emoji}
                </div>

                {/* 名前 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm" style={{ color: "var(--color-ink-900)" }}>
                      {entry.member.name}
                    </span>
                    {isMe && (
                      <span className="text-xs px-1.5 py-0.5 rounded-md font-medium"
                        style={{ background: "var(--color-brand)", color: "white" }}>
                        あなた
                      </span>
                    )}
                  </div>
                  <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
                    {entry.member.category}
                  </p>
                </div>

                {/* ポイント */}
                <div className="text-right shrink-0">
                  <div className="font-bold text-lg" style={{ fontFamily: "var(--font-klee)", color: "var(--color-accent)" }}>
                    {entry.points}
                  </div>
                  <div className="text-xs" style={{ color: "var(--color-ink-400)" }}>pt</div>
                </div>
              </div>
            );
          })}

          {entries.length === 0 && (
            <div className="text-center py-12">
              <Trophy size={40} className="mx-auto mb-3 opacity-30" />
              <p style={{ color: "var(--color-ink-400)" }}>まだランキングデータがありません</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
