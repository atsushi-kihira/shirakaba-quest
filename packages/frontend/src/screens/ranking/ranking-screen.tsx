// =============================================================
// ランキング画面 — 個人/チーム × シーズン/累計
// =============================================================
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Trophy, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "@/lib/api";
import { MemberAvatar } from "@/components/member-avatar";
import { useAuthStore } from "@/stores/auth-store";
import { useSettings } from "@/hooks/use-settings";
import { useTimezone } from "@/hooks/use-timezone";
import { fmtDateISO } from "@/lib/date";
import type { Season, SeasonRankingEntry, TeamRankingEntry } from "@shared/types";

type RankingEntry = {
  rank: number;
  member: { id: string; name: string; furigana: string; emoji: string; bgColor: string; category: string; avatarImageKey?: string | null };
  points: number;
  lastPointedAt: number | null;
};
type RankingResponse = { data: RankingEntry[] };
type SeasonRankingResponse = { data: SeasonRankingEntry[]; season: Season | null };
type ActiveSeasonResponse = { data: Season | null };
type TeamRankingResponse = { data: TeamRankingEntry[]; season: Season | null };

const RANK_MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export function RankingScreen() {
  const me = useAuthStore((s) => s.user);
  const { termQuest } = useSettings();
  const tz = useTimezone();

  // 個人 or チーム
  const [view, setView] = useState<"individual" | "team">("individual");
  // シーズン or 累計
  const [scope, setScope] = useState<"season" | "total">("season");
  // 展開中のチームID
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);

  // 個人・累計
  const { data: totalData, isLoading: totalLoading } = useQuery({
    queryKey: ["ranking", "individual", "total"],
    queryFn: () => api.get<RankingResponse>("/ranking"),
    enabled: view === "individual" && scope === "total",
  });

  // アクティブシーズン情報（シーズン表示で使う）
  const { data: activeSeason } = useQuery({
    queryKey: ["season"],
    queryFn: () => api.get<ActiveSeasonResponse>("/season"),
  });

  // 個人・シーズン
  const { data: seasonData, isLoading: seasonLoading } = useQuery({
    queryKey: ["ranking", "individual", "season"],
    queryFn: () => api.get<SeasonRankingResponse>("/season/ranking"),
    enabled: view === "individual" && scope === "season",
  });

  // チーム・累計
  const { data: teamTotalData, isLoading: teamTotalLoading } = useQuery({
    queryKey: ["ranking", "team", "total"],
    queryFn: () => api.get<TeamRankingResponse>("/teams/ranking?scope=total"),
    enabled: view === "team" && scope === "total",
  });

  // チーム・シーズン
  const { data: teamSeasonData, isLoading: teamSeasonLoading } = useQuery({
    queryKey: ["ranking", "team", "season"],
    queryFn: () => api.get<TeamRankingResponse>("/teams/ranking?scope=season"),
    enabled: view === "team" && scope === "season",
  });

  const currentSeason = activeSeason?.data ?? seasonData?.season ?? null;
  const teamCurrentSeason = teamSeasonData?.season ?? null;

  const isLoading =
    (view === "individual" && scope === "total" && totalLoading) ||
    (view === "individual" && scope === "season" && seasonLoading) ||
    (view === "team" && scope === "total" && teamTotalLoading) ||
    (view === "team" && scope === "season" && teamSeasonLoading);

  const individualEntries = scope === "total"
    ? (totalData?.data ?? [])
    : (seasonData?.data ?? []);

  const teamEntries = scope === "total"
    ? (teamTotalData?.data ?? [])
    : (teamSeasonData?.data ?? []);

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

      {/* 第1段タブ: 個人 / チーム */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setView("individual")}
          className="flex-1 py-2 rounded-2xl text-sm font-medium transition"
          style={{
            background: view === "individual" ? "var(--color-brand)" : "var(--color-paper-200)",
            color: view === "individual" ? "white" : "var(--color-ink-600)",
          }}
        >
          👤 個人
        </button>
        <button
          onClick={() => setView("team")}
          className="flex-1 py-2 rounded-2xl text-sm font-medium transition"
          style={{
            background: view === "team" ? "var(--color-brand)" : "var(--color-paper-200)",
            color: view === "team" ? "white" : "var(--color-ink-600)",
          }}
        >
          🦊 チーム
        </button>
      </div>

      {/* 第2段タブ: シーズン / 累計 */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setScope("season")}
          className="flex-1 py-1.5 rounded-xl text-xs font-medium transition"
          style={{
            background: scope === "season" ? "var(--color-accent)" : "var(--color-paper-200)",
            color: scope === "season" ? "white" : "var(--color-ink-600)",
          }}
        >
          🌸 シーズン
        </button>
        <button
          onClick={() => setScope("total")}
          className="flex-1 py-1.5 rounded-xl text-xs font-medium transition"
          style={{
            background: scope === "total" ? "var(--color-ink-600)" : "var(--color-paper-200)",
            color: scope === "total" ? "white" : "var(--color-ink-600)",
          }}
        >
          📊 累計
        </button>
      </div>

      {/* シーズン情報バナー */}
      {scope === "season" && (() => {
        const s = view === "individual" ? currentSeason : teamCurrentSeason;
        return s ? (
          <div className="mb-4 p-3 rounded-2xl text-sm"
            style={{ background: "rgba(181,56,75,0.06)", border: "1px solid rgba(181,56,75,0.2)" }}>
            <p className="font-semibold" style={{ color: "var(--color-brand)" }}>🌸 {s.name}</p>
            {s.theme && <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-600)" }}>{s.theme}</p>}
            <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>
              開始: {fmtDateISO(s.startsAt, tz)}
            </p>
          </div>
        ) : (
          <div className="mb-4 p-3 rounded-2xl text-sm text-center"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
            現在アクティブなシーズンはありません
          </div>
        );
      })()}

      {/* ローディング */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
        </div>
      )}

      {/* 個人ランキング */}
      {view === "individual" && !isLoading && (
        <IndividualRankingList entries={individualEntries} meId={me?.id} />
      )}

      {/* チームランキング */}
      {view === "team" && !isLoading && (
        <div className="space-y-2">
          {teamEntries.length === 0 ? (
            <div className="text-center py-12">
              <p style={{ color: "var(--color-ink-400)" }}>チームがまだありません</p>
            </div>
          ) : (
            teamEntries.map((entry) => {
              const isExpanded = expandedTeamId === entry.team.id;
              return (
                <div key={entry.team.id} className="card-paper rounded-2xl overflow-hidden">
                  {/* チーム行 */}
                  <button
                    className="w-full px-4 py-3 flex items-center gap-3 transition active:opacity-75"
                    onClick={() => setExpandedTeamId(isExpanded ? null : entry.team.id)}
                  >
                    <div className="w-9 text-center shrink-0">
                      {RANK_MEDAL[entry.rank]
                        ? <span className="text-2xl">{RANK_MEDAL[entry.rank]}</span>
                        : <span className="font-bold text-sm" style={{ color: "var(--color-ink-400)" }}>{entry.rank}</span>
                      }
                    </div>
                    <span className="text-2xl">{entry.team.emblemEmoji}</span>
                    <div className="flex-1 min-w-0 text-left">
                      <span className="font-medium text-sm" style={{ color: "var(--color-ink-900)" }}>{entry.team.name}</span>
                      <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>{entry.members.length}名</p>
                    </div>
                    <div className="text-right shrink-0 mr-1">
                      <div className="font-bold text-lg" style={{ fontFamily: "var(--font-klee)", color: "var(--color-accent)" }}>
                        {entry.totalPoints}
                      </div>
                      <div className="text-xs" style={{ color: "var(--color-ink-400)" }}>pt</div>
                    </div>
                    {isExpanded
                      ? <ChevronUp size={16} style={{ color: "var(--color-ink-400)" }} className="shrink-0" />
                      : <ChevronDown size={16} style={{ color: "var(--color-ink-400)" }} className="shrink-0" />
                    }
                  </button>

                  {/* メンバー一覧（展開時） */}
                  {isExpanded && entry.members.length > 0 && (
                    <div style={{ borderTop: "1px solid var(--color-paper-300)" }}>
                      {entry.members.map((m, idx) => (
                        <Link
                          key={m.member.id}
                          to={`/members/${m.member.id}`}
                          className="flex items-center gap-3 px-4 py-2.5 transition active:opacity-75"
                          style={{
                            borderTop: idx > 0 ? "1px solid var(--color-paper-200)" : undefined,
                            background: "rgba(250,245,232,0.5)",
                          }}
                        >
                          <div className="w-9 text-center shrink-0">
                            <span className="text-xs font-medium" style={{ color: "var(--color-ink-400)" }}>{idx + 1}</span>
                          </div>
                          <MemberAvatar
                            memberId={m.member.id}
                            emoji={m.member.emoji}
                            bgColor={m.member.bgColor}
                            avatarImageKey={m.member.avatarImageKey}
                            size="sm"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium" style={{ color: "var(--color-ink-900)" }}>{m.member.name}</span>
                              {m.isLeader && (
                                <span className="text-xs px-1 py-0.5 rounded font-medium"
                                  style={{ background: "var(--color-accent)", color: "white", fontSize: "10px" }}>
                                  リーダー
                                </span>
                              )}
                              {m.member.id === me?.id && (
                                <span className="text-xs px-1 py-0.5 rounded font-medium"
                                  style={{ background: "var(--color-brand)", color: "white", fontSize: "10px" }}>
                                  あなた
                                </span>
                              )}
                            </div>
                            <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>{m.member.category}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="font-bold text-sm" style={{ fontFamily: "var(--font-klee)", color: "var(--color-accent)" }}>
                              {m.points}
                            </span>
                            <span className="text-xs ml-0.5" style={{ color: "var(--color-ink-400)" }}>pt</span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function IndividualRankingList({
  entries,
  meId,
}: {
  entries: Array<{ rank: number; member: { id: string; name: string; emoji: string; bgColor: string; category: string; avatarImageKey?: string | null }; points: number }>;
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
          <Link
            key={`${entry.rank}-${entry.member.id}`}
            to={`/members/${entry.member.id}`}
            className={`card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-75 ${isMe ? "ring-2" : ""}`}
            style={isMe ? { "--tw-ring-color": "var(--color-brand)" } as React.CSSProperties : {}}
          >
            <div className="w-9 text-center shrink-0">
              {medal
                ? <span className="text-2xl">{medal}</span>
                : <span className="font-bold text-sm" style={{ color: "var(--color-ink-400)" }}>{entry.rank}</span>
              }
            </div>
            <MemberAvatar
              memberId={entry.member.id}
              emoji={entry.member.emoji}
              bgColor={entry.member.bgColor}
              avatarImageKey={entry.member.avatarImageKey}
              size="md"
            />
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
          </Link>
        );
      })}
    </div>
  );
}
