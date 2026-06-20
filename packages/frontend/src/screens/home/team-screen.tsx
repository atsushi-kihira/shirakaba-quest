// =============================================================
// チームページ — メンバー一覧 + USP表示
// =============================================================
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useSettings } from "@/hooks/use-settings";

type Skill = {
  name: string;
  emoji: string;
  issue: string;
  connector: string;
  solution: string;
  noEnding?: boolean;
};

type TeamMemberEntry = {
  id: string;
  memberId: string;
  teamId: string;
  isLeader: boolean;
  joinedAt: number;
  member?: {
    id: string;
    name: string;
    furigana: string;
    emoji: string;
    bgColor: string;
    category: string;
    skills: Skill[];
  };
};

type Team = {
  id: string;
  name: string;
  emblemEmoji: string;
  isMine: boolean;
  members: TeamMemberEntry[];
};

type TeamsResponse = { data: Team[] };

export function TeamScreen() {
  const me = useAuthStore((s) => s.user);
  const { termUsp } = useSettings();

  const { data, isLoading } = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.get<TeamsResponse>("/teams"),
  });

  const teams = data?.data ?? [];
  const myTeam = teams.find((t) => t.isMine);
  const displayTeams = myTeam ? [myTeam] : teams;

  return (
    <div className="px-4 py-6 pb-24 max-w-xl mx-auto lg:max-w-none">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          🦊 チームの活動
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-ink-500)" }}>
          チームメンバーの{termUsp}を確認しよう
        </p>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
        </div>
      )}

      {!isLoading && displayTeams.length === 0 && (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">🦊</p>
          <p style={{ color: "var(--color-ink-400)" }}>チームがまだ作成されていません</p>
          <p className="text-sm mt-1" style={{ color: "var(--color-ink-400)" }}>管理者にチームを作ってもらいましょう</p>
        </div>
      )}

      {displayTeams.map((team) => (
        <div key={team.id} className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl">{team.emblemEmoji}</span>
            <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
              {team.name}
              {team.isMine && (
                <span className="ml-2 text-xs px-1.5 py-0.5 rounded-md font-medium"
                  style={{ background: "var(--color-brand)", color: "white" }}>あなたのチーム</span>
              )}
            </h2>
          </div>
          <div className="space-y-3">
            {team.members.map((tm) => {
              const m = tm.member;
              if (!m) return null;
              const isMe = m.id === me?.id;
              return (
                <Link
                  key={tm.id}
                  to={`/members/${m.id}`}
                  className="card-paper rounded-2xl p-4 block transition active:opacity-80"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-2xl shrink-0 ${m.bgColor}`}>
                      {m.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-sm" style={{ color: "var(--color-ink-900)" }}>
                          {m.name}
                        </span>
                        {tm.isLeader && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                            style={{ background: "rgba(212,160,59,0.15)", color: "var(--color-accent)" }}>
                            リーダー
                          </span>
                        )}
                        {isMe && (
                          <span className="text-xs px-1.5 py-0.5 rounded-md font-medium"
                            style={{ background: "var(--color-brand)", color: "white" }}>あなた</span>
                        )}
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>{m.category}</p>
                    </div>
                    <ChevronRight size={16} style={{ color: "var(--color-ink-300)" }} />
                  </div>
                  {m.skills.length > 0 && (
                    <div className="space-y-1.5">
                      {m.skills.map((skill, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <span className="text-base shrink-0">{skill.emoji}</span>
                          <div className="min-w-0">
                            <span className="text-xs font-semibold" style={{ color: "var(--color-brand)" }}>
                              {skill.name}
                            </span>
                            <p className="text-xs leading-snug" style={{ color: "var(--color-ink-600)" }}>
                              {skill.issue}{skill.connector}{skill.solution}{skill.noEnding ? "" : "ことができる"}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
