// =============================================================
// なかま一覧画面（チーム統合タブ付き）
// タブ: 全員 / 1to1済み / 1to1未 / チームメンバー
// =============================================================
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2, Star, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { MemberAvatar } from "@/components/member-avatar";
import { useAuthStore } from "@/stores/auth-store";
import { useSettings } from "@/hooks/use-settings";
import type { PublicMember } from "@shared/types";

// ---- 型定義 ----
type Skill = { name: string; emoji: string; issue: string; connector: string; solution: string; noEnding?: boolean };
type TeamMemberEntry = {
  id: string; memberId: string; isLeader: boolean;
  member?: { id: string; name: string; furigana: string; emoji: string; bgColor: string; category: string; skills: Skill[]; points: number };
};
type Team = { id: string; name: string; emblemEmoji: string; isMine: boolean; members: TeamMemberEntry[] };
type MembersResponse = { data: PublicMember[] };
type TeamsResponse = { data: Team[] };

// ---- タブ定義 ----
type Tab = "all" | "done" | "undone" | "team";
const TABS: { key: Tab; label: string }[] = [
  { key: "all",   label: "全員" },
  { key: "done",  label: "1to1済み" },
  { key: "undone", label: "1to1未" },
  { key: "team",  label: "チーム" },
];

// ---- カード: 一般メンバー ----
const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  none:    { label: "未交流",   className: "bg-stone-200 text-stone-600 ring-stone-300" },
  digital: { label: "デジタル", className: "bg-amber-200 text-amber-900 ring-amber-300" },
  real:    { label: "リアル✕2", className: "bg-rose-500 text-white ring-rose-300" },
  self:    { label: "自分",     className: "bg-violet-100 text-violet-700 ring-violet-300" },
};

function MemberCard({ member }: { member: PublicMember }) {
  const connStatus = member.connectionStatus;
  const badge = STATUS_LABEL[connStatus] ?? STATUS_LABEL.none;

  return (
    <Link
      to={`/members/${member.id}`}
      className="card-paper rounded-2xl p-4 flex items-start gap-3 block transition hover:opacity-90 active:scale-[0.98]"
    >
      <MemberAvatar
        memberId={member.id} emoji={member.emoji} bgColor={member.bgColor}
        avatarImageKey={member.avatarImageKey} size="lg" rounded="rounded-xl"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm" style={{ color: "var(--color-ink-900)" }}>{member.name}</span>
          <span className={`skill-badge text-xs px-2 py-0.5 rounded-full ring-1 ${badge.className}`}>
            {badge.label}
          </span>
        </div>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
          {member.category}{member.company && ` · ${member.company}`}
        </p>
        <div className="flex flex-wrap gap-1 mt-2">
          {member.skills.map((skill) => (
            <span key={skill.name} className={`text-xs px-2 py-0.5 rounded-full ring-1 ${skill.color}`}>
              {skill.emoji} {skill.name}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}

// ---- カード: チームメンバー（USP付き）----
function TeamMemberCard({ tm, isMe }: { tm: TeamMemberEntry; isMe: boolean }) {
  const m = tm.member;
  if (!m) return null;
  return (
    <Link to={`/members/${m.id}`} className="card-paper rounded-2xl p-4 block transition active:opacity-80">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-2xl shrink-0 ${m.bgColor}`}>
          {m.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-sm" style={{ color: "var(--color-ink-900)" }}>{m.name}</span>
            {tm.isLeader && (
              <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                style={{ background: "rgba(212,160,59,0.15)", color: "var(--color-accent)" }}>リーダー</span>
            )}
            {isMe && (
              <span className="text-xs px-1.5 py-0.5 rounded-md font-medium"
                style={{ background: "var(--color-brand)", color: "white" }}>あなた</span>
            )}
          </div>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>{m.category}</p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Star size={12} style={{ color: "var(--color-accent)" }} />
          <span className="text-sm font-bold" style={{ color: "var(--color-accent)" }}>{m.points}</span>
          <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>pt</span>
        </div>
        <ChevronRight size={16} style={{ color: "var(--color-ink-300)" }} />
      </div>
      {m.skills.length > 0 && (
        <div className="space-y-1.5">
          {m.skills.map((skill, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-base shrink-0">{skill.emoji}</span>
              <div className="min-w-0">
                <span className="text-xs font-semibold" style={{ color: "var(--color-brand)" }}>{skill.name}</span>
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
}

// ---- メイン画面 ----
export function MembersScreen() {
  const me = useAuthStore((s) => s.user);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("all");

  const { data: membersData, isLoading: membersLoading, error } = useQuery({
    queryKey: ["members"],
    queryFn: () => api.get<MembersResponse>("/members"),
  });

  const { data: teamsData, isLoading: teamsLoading } = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.get<TeamsResponse>("/teams"),
    enabled: activeTab === "team",
  });

  const members = membersData?.data ?? [];
  const teams = teamsData?.data ?? [];
  const myTeam = teams.find((t) => t.isMine);
  const { termUsp } = useSettings();

  // タブごとのフィルタ
  const filteredMembers = members.filter((m) => {
    const matchSearch = search === "" || m.name.includes(search) || m.furigana.includes(search) || m.category.includes(search);
    if (!matchSearch) return false;
    if (activeTab === "all") return true;
    if (activeTab === "done") return m.connectionStatus === "digital" || m.connectionStatus === "real";
    if (activeTab === "undone") return m.connectionStatus === "none";
    return false;
  });

  const isLoading = membersLoading || (activeTab === "team" && teamsLoading);

  return (
    <div className="px-4 py-6 pb-24 max-w-xl mx-auto lg:max-w-none">
      {/* ヘッダー */}
      <div className="mb-4">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          👥 なかま
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-500)" }}>
          1to1してカードを集めよう
        </p>
      </div>

      {/* タブバー */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className="px-3 py-1.5 rounded-2xl text-sm font-medium whitespace-nowrap transition"
            style={{
              background: activeTab === key ? "var(--color-brand)" : "var(--color-paper-200)",
              color: activeTab === key ? "white" : "var(--color-ink-600)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 検索（チームタブ以外） */}
      {activeTab !== "team" && (
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-ink-400)" }} />
          <input
            type="text" placeholder="名前・職種で検索..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-2xl pl-9 pr-4 py-2.5 text-sm outline-none"
            style={{ background: "var(--color-paper-50)", border: "1.5px solid var(--color-paper-300)", color: "var(--color-ink-800)" }}
          />
        </div>
      )}

      {/* ローディング */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
        </div>
      )}

      {/* エラー */}
      {error && (
        <div className="rounded-2xl p-4 text-sm" style={{ background: "var(--color-paper-200)", color: "#b91c1c" }}>
          ⚠️ データの取得に失敗しました
        </div>
      )}

      {/* ---- チームタブ ---- */}
      {!isLoading && activeTab === "team" && (
        <>
          {(myTeam ? [myTeam] : teams).length === 0 ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-3">🦊</p>
              <p style={{ color: "var(--color-ink-400)" }}>チームがまだ作成されていません</p>
              <p className="text-sm mt-1" style={{ color: "var(--color-ink-400)" }}>管理者にチームを作ってもらいましょう</p>
            </div>
          ) : (myTeam ? [myTeam] : teams).map((team) => {
            const teamTotal = team.members.reduce((sum, tm) => sum + (tm.member?.points ?? 0), 0);
            return (
              <div key={team.id} className="mb-6">
                {/* チームヘッダー */}
                <div className="card-paper rounded-2xl px-4 py-3 mb-3 flex items-center gap-3">
                  <span className="text-2xl">{team.emblemEmoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
                        {team.name}
                      </h2>
                      {team.isMine && (
                        <span className="text-xs px-1.5 py-0.5 rounded-md font-medium"
                          style={{ background: "var(--color-brand)", color: "white" }}>あなたのチーム</span>
                      )}
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>
                      {team.members.length}名 · {termUsp}を確認しよう
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Star size={14} style={{ color: "var(--color-accent)" }} />
                    <span className="font-bold text-base" style={{ color: "var(--color-accent)" }}>{teamTotal}</span>
                    <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>pt</span>
                  </div>
                </div>
                <div className="space-y-3">
                  {team.members.map((tm) => (
                    <TeamMemberCard key={tm.id} tm={tm} isMe={tm.member?.id === me?.id} />
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* ---- 全員 / 1to1済み / 1to1未 ---- */}
      {!isLoading && !error && activeTab !== "team" && (
        <div className="space-y-3">
          {filteredMembers.length === 0 && (
            <p className="text-center py-8 text-sm" style={{ color: "var(--color-ink-400)" }}>
              {activeTab === "done" ? "1to1を実施した仲間がいません" :
               activeTab === "undone" ? "1to1未実施のメンバーはいません" :
               "見つかりませんでした"}
            </p>
          )}
          {filteredMembers.map((member) => (
            <MemberCard key={member.id} member={member} />
          ))}
        </div>
      )}
    </div>
  );
}
