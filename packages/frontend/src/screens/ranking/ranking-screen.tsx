// =============================================================
// ランキング画面
// =============================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useSettings } from "@/hooks/use-settings";
import type { Season, SeasonRankingEntry, TeamRankingEntry } from "@shared/types";

type RankingEntry = {
  rank: number;
  member: { id: string; name: string; furigana: string; emoji: string; bgColor: string; category: string };
  points: number;
  lastPointedAt: number | null;
};
type RankingResponse = { data: RankingEntry[] };
type SeasonRankingResponse = { data: SeasonRankingEntry[]; season: Season | null };
type ActiveSeasonResponse = { data: Season | null };
type TeamRankingResponse = { data: TeamRankingEntry[] };

const RANK_MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export function RankingScreen() {
  const me = useAuthStore((s) => s.user);
  const { termQuest } = useSettings();
  const [tab, setTab] = useState<"overall" | "season" | "team">("overall");

  const { data, isLoading } = useQuery({
    queryKey: ["ranking"],
    queryFn: () => api.get<RankingResponse>("/ranking"),
    enabled: tab === "overall",
  });

  const { data: activeSeason } = useQuery({
    queryKey: ["season"],
    queryFn: () => api.get<ActiveSeasonResponse>("/season"),
  });

  const { data: seasonRankData, isLoading: seasonLoading } = useQuery({
    queryKey: ["ranking", "season"],
    queryFn: () => api.get<SeasonRankingResponse>("/season/ranking"),
    enabled: tab === "season",
  });

  const { data: teamRankData, isLoading: teamLoading } = useQuery({
    queryKey: ["teams", "ranking"],
    queryFn: () => api.get<TeamRankingResponse>("/teams/ranking"),
    enabled: tab === "team",
  });

  const entries = data?.data ?? [];
  const seasonEntries = seasonRankData?.data ?? [];
  const currentSeason = activeSeason?.data ?? null;
  const teamEntries = teamRankData?.data ?? [];

  return (
    <div className="px-4 py-6 pb-24">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          🏆 ランキング
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-ink-500)" }}>
          1to1・{termQuest}クリアでポイントを稼ごう
        </p>
      </div>

      {/* タブ */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab("overall")}
          className="flex-1 py-2 rounded-2xl text-sm font-medium transition"
          style={{
            background: tab === "overall" ? "var(--color-brand)" : "var(--color-paper-200)",
            color: tab === "overall" ? "white" : "var(--color-ink-600)",
          }}
        >
          🏆 総合
        </button>
        <button
          onClick={() => setTab("season")}
          className="flex-1 py-2 rounded-2xl text-sm font-medium transition"
          style={{
            background: tab === "season" ? "var(--color-brand)" : "var(--color-paper-200)",
            color: tab === "season" ? "white" : "var(--color-ink-600)",
          }}
        >
          🌸 シーズン
        </button>
        <button
          onClick={() => setTab("team")}
          className="flex-1 py-2 rounded-2xl text-sm font-medium transition"
          style={{
            background: tab === "team" ? "var(--color-brand)" : "var(--color-paper-200)",
            color: tab === "team" ? "white" : "var(--color-ink-600)",
          }}
        >
          🦊 チーム
        </button>
      </div>

      {/* シーズン情報 */}
      {tab === "season" && currentSeason && (
        <div className="mb-4 p-3 rounded-2xl text-sm"
          style={{ background: "rgba(181,56,75,0.06)", border: "1px solid rgba(181,56,75,0.2)" }}>
          <p className="font-semibold" style={{ color: "var(--color-brand)" }}>🌸 {currentSeason.name}</p>
          {currentSeason.theme && <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-600)" }}>{currentSeason.theme}</p>}
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>
            開始: {new Date(currentSeason.startsAt * 1000).toLocaleDateString("ja-JP")}
          </p>
        </div>
      )}
      {tab === "season" && !currentSeason && (
        <div className="mb-4 p-3 rounded-2xl text-sm text-center" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
          現在アクティブなシーズンはありません
        </div>
      )}

      {/* ローディング */}
      {(tab === "overall" ? isLoading : tab === "season" ? seasonLoading : teamLoading) && (
        <div className="flex justify-center py-12">
          <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
        </div>
      )}

      {/* 総合ランキング */}
      {tab === "overall" && !isLoading && (
        <RankingList entries={entries} meId={me?.id} />
      )}

      {/* シーズンランキング */}
      {tab === "season" && !seasonLoading && (
        <RankingList entries={seasonEntries} meId={me?.id} />
      )}

      {/* チームランキング */}
      {tab === "team" && !teamLoading && (
        <div className="space-y-2">
          {teamEntries.length === 0 ? (
            <div className="text-center py-12">
              <p style={{ color: "var(--color-ink-400)" }}>チームがまだありません</p>
            </div>
          ) : (
            teamEntries.map((entry) => (
              <div key={entry.team.id} className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3">
                <div className="w-9 text-center shrink-0">
                  <span className="font-bold text-sm" style={{ color: "var(--color-ink-400)" }}>{entry.rank}</span>
                </div>
                <span className="text-2xl">{entry.team.emblemEmoji}</span>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-sm" style={{ color: "var(--color-ink-900)" }}>{entry.team.name}</span>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-lg" style={{ fontFamily: "var(--font-klee)", color: "var(--color-accent)" }}>
                    {entry.totalPoints}
                  </div>
                  <div className="text-xs" style={{ color: "var(--color-ink-400)" }}>pt</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function RankingList({
  entries,
  meId,
}: {
  entries: Array<{ rank: number; member: { id: string; name: string; emoji: string; bgColor: string; category: string }; points: number }>;
  meId?: string;
}) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-12">
        <Trophy size={40} className="mx-auto mb-3 opacity-30" />
        <p style={{ color: "var(--color-ink-400)" }}>まだランキングデータがありません</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const isMe = entry.member.id === meId;
        const medal = RANK_MEDAL[entry.rank];
        return (
          <div
            key={`${entry.rank}-${entry.member.id}`}
            className={`card-paper rounded-2xl px-4 py-3 flex items-center gap-3 ${isMe ? "ring-2" : ""}`}
            style={isMe ? { "--tw-ring-color": "var(--color-brand)" } as React.CSSProperties : {}}
          >
            <div className="w-9 text-center shrink-0">
              {medal
                ? <span className="text-2xl">{medal}</span>
                : <span className="font-bold text-sm" style={{ color: "var(--color-ink-400)" }}>{entry.rank}</span>
              }
            </div>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${entry.member.bgColor}`}>
              {entry.member.emoji}
            </div>
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
            <div className="text-right shrink-0">
              <div className="font-bold text-lg" style={{ fontFamily: "var(--font-klee)", color: "var(--color-accent)" }}>
                {entry.points}
              </div>
              <div className="text-xs" style={{ color: "var(--color-ink-400)" }}>pt</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
