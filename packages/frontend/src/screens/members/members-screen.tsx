// =============================================================
// なかま一覧画面（チーム統合タブ付き）
// タブ: 全員 / 1to1済み / 1to1未 / チームメンバー
// =============================================================
import { useState, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2, Star, ChevronRight, Handshake, X, Globe } from "lucide-react";
import { api } from "@/lib/api";
import { MemberAvatar } from "@/components/member-avatar";
import { useAuthStore } from "@/stores/auth-store";
import { useSettings } from "@/hooks/use-settings";
import { useTimezone } from "@/hooks/use-timezone";
import { useIntroRequestCount } from "@/hooks/use-collab-alerts";
import { fmtDateShort } from "@/lib/date";
import { ExternalContactsTab } from "./_external-contacts-tab";
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

// ---- 協働チーム（パイロット限定・所属バッジ表示用） ----
type CollabTeamMember = { id: string; status: "active" | "pending" | "declined" };
type CollabTeam = { id: string; name: string; type: "loose" | "power"; members: CollabTeamMember[] };
type CollabGraphResponse = { data: { teams: CollabTeam[] } };

function useCollabTeamsByMember(enabled: boolean) {
  const { data } = useQuery({
    queryKey: ["collab", "graph"],
    queryFn: () => api.get<CollabGraphResponse>("/collab/graph"),
    enabled,
  });
  return useMemo(() => {
    const map = new Map<string, { name: string; type: "loose" | "power" }[]>();
    for (const team of data?.data.teams ?? []) {
      for (const m of team.members) {
        if (m.status !== "active") continue;
        const list = map.get(m.id) ?? [];
        list.push({ name: team.name, type: team.type });
        map.set(m.id, list);
      }
    }
    return map;
  }, [data]);
}

// ---- タブ定義 ----
type Tab = "all" | "done" | "undone" | "team" | "contacts";
const BASE_TABS: { key: Tab; label: string }[] = [
  { key: "all",   label: "全員" },
  { key: "done",  label: "1to1済み" },
  { key: "undone", label: "1to1未" },
  { key: "team",  label: "ギルド" },
];
const CONTACTS_TAB: { key: Tab; label: string } = { key: "contacts", label: "外部人脈" };

// ---- カード: 一般メンバー ----
const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  none:    { label: "未交流",   className: "bg-stone-200 text-stone-600 ring-stone-300" },
  digital: { label: "デジタル", className: "bg-amber-200 text-amber-900 ring-amber-300" },
  real:    { label: "リアル✕2", className: "bg-rose-500 text-white ring-rose-300" },
  self:    { label: "自分",     className: "bg-violet-100 text-violet-700 ring-violet-300" },
};

function MemberCard({ member, collabTeams }: { member: PublicMember; collabTeams?: { name: string; type: "loose" | "power" }[] }) {
  const connStatus = member.connectionStatus;
  const badge = STATUS_LABEL[connStatus] ?? STATUS_LABEL.none;
  const tz = useTimezone();

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
        {member.oneOnOneCount > 0 && member.lastOneOnOneAt && (
          <p className="text-xs mt-1 flex items-center gap-1" style={{ color: "var(--color-success)" }}>
            <Handshake size={11} />
            直近 {fmtDateShort(member.lastOneOnOneAt, tz)}
            {member.oneOnOneCount > 1 && <span> ・ {member.oneOnOneCount}回</span>}
          </p>
        )}
        {member.externalContactCount > 0 && (
          <span
            className="inline-flex items-center gap-1 text-xs font-semibold mt-1 px-2 py-0.5 rounded-full"
            style={{ background: "rgba(59,130,246,0.15)", color: "#1d4ed8" }}
          >
            <Globe size={11} />
            外部人脈 {member.externalContactCount}件
            {member.externalContactDetailCount > 0 && <span className="font-normal">（詳細公開 {member.externalContactDetailCount}件）</span>}
          </span>
        )}
        {collabTeams && collabTeams.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {collabTeams.map((t) => (
              <span key={t.name} className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{
                  background: t.type === "power" ? "rgba(212,160,59,0.15)" : "rgba(90,140,92,0.12)",
                  color: t.type === "power" ? "var(--color-accent)" : "var(--color-success)",
                }}>
                {t.type === "power" ? "⚡" : "🌿"} {t.name}
              </span>
            ))}
          </div>
        )}
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
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>(searchParams.get("tab") === "contacts" ? "contacts" : "all");
  const introRequestCount = useIntroRequestCount();

  const { data: membersData, isLoading: membersLoading, error } = useQuery({
    queryKey: ["members"],
    queryFn: () => api.get<MembersResponse>("/members"),
  });

  const { data: teamsData, isLoading: teamsLoading } = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.get<TeamsResponse>("/teams"),
    enabled: activeTab === "team",
  });

  const collabTeamsByMember = useCollabTeamsByMember(true);

  const members = membersData?.data ?? [];
  const teams = teamsData?.data ?? [];
  const myTeam = teams.find((t) => t.isMine);
  const { termUsp } = useSettings();

  const TABS = [...BASE_TABS, CONTACTS_TAB];

  // タブごとのフィルタ
  const filteredMembers = members.filter((m) => {
    const matchSearch = search === "" || m.name.includes(search) || m.furigana.includes(search) || m.category.includes(search);
    if (!matchSearch) return false;
    if (activeTab === "all") return true;
    if (activeTab === "done") return m.connectionStatus === "digital" || m.connectionStatus === "real";
    if (activeTab === "undone") return m.connectionStatus === "none";
    return false;
  });

  const isLoading = activeTab !== "contacts" && (membersLoading || (activeTab === "team" && teamsLoading));

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

      {/* タブバー（overflow-x-auto指定時、overflow-yも実質clip/autoになるため、負のtop位置を使うバッジが隠れないようpt-2で余白を確保する） */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pt-2 pb-1">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className="relative px-3 py-1.5 rounded-2xl text-sm font-medium whitespace-nowrap transition"
            style={{
              background: activeTab === key ? "var(--color-brand)" : "var(--color-paper-200)",
              color: activeTab === key ? "white" : "var(--color-ink-600)",
            }}
          >
            {label}
            {key === "contacts" && introRequestCount > 0 ? (
              <span className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] rounded-full text-white flex items-center justify-center px-0.5 font-bold"
                style={{ background: "var(--color-brand)", fontSize: "9px" }}>
                {introRequestCount > 9 ? "9+" : introRequestCount}
              </span>
            ) : key === "contacts" ? (
              <span className="absolute -top-1.5 -right-2 h-[13px] rounded-full text-white flex items-center justify-center px-1.5 font-bold whitespace-nowrap"
                style={{ background: "var(--color-accent)", fontSize: "8px" }}>
                New!
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* 検索（チームタブ・外部人脈タブ以外） */}
      {activeTab !== "team" && activeTab !== "contacts" && (
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-ink-400)" }} />
          <input
            type="text" placeholder="名前・職種で検索..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-2xl pl-9 pr-9 py-2.5 text-sm outline-none"
            style={{ background: "var(--color-paper-50)", border: "1.5px solid var(--color-paper-300)", color: "var(--color-ink-800)" }}
          />
          {search && (
            <button type="button" onClick={() => setSearch("")}
              aria-label="検索条件をクリア"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full"
              style={{ color: "var(--color-ink-400)" }}>
              <X size={14} />
            </button>
          )}
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
              <p style={{ color: "var(--color-ink-400)" }}>ギルドがまだ作成されていません</p>
              <p className="text-sm mt-1" style={{ color: "var(--color-ink-400)" }}>管理者にギルドを作ってもらいましょう</p>
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
                          style={{ background: "var(--color-brand)", color: "white" }}>あなたのギルド</span>
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

      {/* ---- 外部人脈タブ ---- */}
      {activeTab === "contacts" && (
        <div>
          <h2 className="text-lg font-semibold mb-1 flex items-center gap-2"
            style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            🌐 外部人脈を管理
          </h2>
          <ExternalContactsTab />
        </div>
      )}

      {/* ---- 全員 / 1to1済み / 1to1未 ---- */}
      {!isLoading && !error && activeTab !== "team" && activeTab !== "contacts" && (
        <div className="space-y-3">
          {filteredMembers.length === 0 && (
            <p className="text-center py-8 text-sm" style={{ color: "var(--color-ink-400)" }}>
              {activeTab === "done" ? "1to1を実施した仲間がいません" :
               activeTab === "undone" ? "1to1未実施のメンバーはいません" :
               "見つかりませんでした"}
            </p>
          )}
          {filteredMembers.map((member) => (
            <MemberCard key={member.id} member={member} collabTeams={collabTeamsByMember.get(member.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
