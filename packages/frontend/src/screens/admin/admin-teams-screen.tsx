// =============================================================
// 管理画面 — チーム管理
// =============================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Shuffle, Bot, Users, Crown, UserMinus } from "lucide-react";
import { api } from "@/lib/api";
import type { Team } from "@shared/types";

type TeamsResponse = { data: Team[] };
type MembersResponse = { data: Array<{ id: string; name: string; emoji: string; bgColor: string }> };
type TeamRankingResponse = { data: Array<{ rank: number; team: { id: string; name: string; emblemEmoji: string }; totalPoints: number }> };

const DEFAULT_EMOJIS = ["🦊", "🐻", "🐝", "🦉", "🐢", "🐧", "🦁", "🐯"];

export function AdminTeamsScreen() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"teams" | "ranking">("teams");
  const [showCreate, setShowCreate] = useState(false);
  const [showAutoAssign, setShowAutoAssign] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "teams"],
    queryFn: () => api.get<TeamsResponse>("/admin/teams"),
  });

  const { data: rankingData } = useQuery({
    queryKey: ["teams", "ranking"],
    queryFn: () => api.get<TeamRankingResponse>("/teams/ranking"),
    enabled: tab === "ranking",
  });

  const teams = data?.data ?? [];

  const deleteTeam = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/teams/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "teams"] }),
  });

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-24 max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          👥 チーム管理
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAutoAssign(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}
          >
            <Shuffle size={14} />
            自動振り分け
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-medium text-white"
            style={{ background: "var(--color-brand)" }}
          >
            <Plus size={14} />
            手動作成
          </button>
        </div>
      </div>

      {/* タブ */}
      <div className="flex gap-2 mb-4">
        {([["teams", "🦊 チーム一覧"], ["ranking", "🏆 チームランキング"]] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className="flex-1 py-2 rounded-2xl text-sm font-medium transition"
            style={{
              background: tab === t ? "var(--color-brand)" : "var(--color-paper-200)",
              color: tab === t ? "white" : "var(--color-ink-600)",
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* チーム一覧 */}
      {tab === "teams" && (
        <>
          {isLoading ? (
            <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>読み込み中...</div>
          ) : teams.length === 0 ? (
            <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>
              チームがまだありません。自動振り分けか手動で作ってみましょう。
            </div>
          ) : (
            <div className="space-y-3">
              {teams.map((team) => (
                <TeamCard key={team.id} team={team} onDelete={() => deleteTeam.mutate(team.id)} />
              ))}
            </div>
          )}
        </>
      )}

      {/* チームランキング */}
      {tab === "ranking" && (
        <div className="space-y-2">
          {(rankingData?.data ?? []).map((entry) => (
            <div key={entry.team.id} className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3">
              <div className="w-8 text-center font-bold text-sm shrink-0" style={{ color: "var(--color-ink-500)" }}>
                {entry.rank}
              </div>
              <span className="text-2xl">{entry.team.emblemEmoji}</span>
              <div className="flex-1">
                <p className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>{entry.team.name}</p>
              </div>
              <div className="font-bold text-lg" style={{ color: "var(--color-accent)" }}>
                {entry.totalPoints}<span className="text-xs ml-0.5">pt</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateTeamModal onClose={() => setShowCreate(false)} />}
      {showAutoAssign && <AutoAssignModal onClose={() => setShowAutoAssign(false)} />}
    </div>
  );
}

// ---- チームカード ----
function TeamCard({ team, onDelete }: { team: Team; onDelete: () => void }) {
  const qc = useQueryClient();
  const [showMembers, setShowMembers] = useState(false);

  const removeMember = useMutation({
    mutationFn: ({ memberId }: { memberId: string }) =>
      api.delete(`/admin/teams/${team.id}/members/${memberId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "teams"] }),
  });

  const toggleLeader = useMutation({
    mutationFn: ({ memberId, isLeader }: { memberId: string; isLeader: boolean }) =>
      api.patch(`/admin/teams/${team.id}/members/${memberId}/leader`, { isLeader }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "teams"] }),
  });

  return (
    <div className="card-paper p-4">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-3xl">{team.emblemEmoji}</span>
        <div className="flex-1">
          <p className="font-semibold" style={{ color: "var(--color-ink-800)" }}>{team.name}</p>
          <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>{team.members.length}名</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowMembers(!showMembers)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-2xl text-xs"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
          >
            <Users size={12} />
            メンバー
          </button>
          <button
            onClick={onDelete}
            className="p-2 rounded-2xl"
            style={{ background: "var(--color-paper-200)" }}
          >
            <Trash2 size={14} style={{ color: "var(--color-brand)" }} />
          </button>
        </div>
      </div>

      {showMembers && (
        <div className="mt-3 pt-3 border-t space-y-2" style={{ borderColor: "var(--color-paper-300)" }}>
          {team.members.map((tm) => (
            <div key={tm.id} className="flex items-center gap-2">
              <span className="text-lg">{tm.member?.emoji ?? "🙂"}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate" style={{ color: "var(--color-ink-700)" }}>
                  {tm.member?.name ?? tm.memberId}
                  {tm.isLeader && (
                    <span className="ml-1 text-xs font-bold" style={{ color: "var(--color-accent)" }}>👑 リーダー</span>
                  )}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => toggleLeader.mutate({ memberId: tm.memberId, isLeader: !tm.isLeader })}
                  className="p-1.5 rounded-lg"
                  style={{ background: "var(--color-paper-200)" }}
                  title={tm.isLeader ? "リーダー解除" : "リーダーに設定"}
                >
                  <Crown size={12} style={{ color: tm.isLeader ? "var(--color-accent)" : "var(--color-ink-400)" }} />
                </button>
                <button
                  onClick={() => removeMember.mutate({ memberId: tm.memberId })}
                  className="p-1.5 rounded-lg"
                  style={{ background: "var(--color-paper-200)" }}
                  title="チームから外す"
                >
                  <UserMinus size={12} style={{ color: "var(--color-brand)" }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- 手動チーム作成 ----
function CreateTeamModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🦊");

  const create = useMutation({
    mutationFn: () => api.post("/admin/teams", { name: name.trim(), emblemEmoji: emoji }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "teams"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-6 w-full max-w-sm rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4" style={{ fontFamily: "var(--font-klee)" }}>🦊 新しいチーム</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>絵文字</label>
              <input value={emoji} onChange={(e) => setEmoji(e.target.value)}
                maxLength={2} className="w-14 text-center text-2xl px-2 py-2 rounded-xl border"
                style={{ borderColor: "var(--color-paper-300)" }} />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>チーム名 *</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="例: 白樺フォレスト隊"
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)" }} />
            </div>
          </div>
          <div className="flex gap-1 flex-wrap">
            {DEFAULT_EMOJIS.map((e) => (
              <button key={e} onClick={() => setEmoji(e)}
                className="text-xl w-9 h-9 rounded-full flex items-center justify-center"
                style={{ outline: emoji === e ? "2px solid var(--color-brand)" : "none", background: emoji === e ? "var(--color-paper-200)" : "transparent" }}>
                {e}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl text-sm"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}
            className="flex-1 py-2.5 rounded-2xl text-sm text-white disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}>作成する</button>
        </div>
      </div>
    </div>
  );
}

// ---- 自動振り分けウィザード ----
function AutoAssignModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [teamSize, setTeamSize] = useState(6);
  const [mode, setMode] = useState<"random" | "ai">("random");
  const [prompt, setPrompt] = useState("");

  const { data: membersData } = useQuery({
    queryKey: ["admin", "members"],
    queryFn: () => api.get<MembersResponse>("/admin/members"),
  });
  const activeMembers = (membersData?.data ?? []);
  const teamCount = Math.ceil(activeMembers.length / teamSize);

  const assign = useMutation({
    mutationFn: () => api.post("/admin/teams/auto-assign", { teamSize, mode, prompt: prompt.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "teams"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-6 w-full max-w-md rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4" style={{ fontFamily: "var(--font-klee)" }}>
          <Shuffle size={18} className="inline mr-2" />自動振り分け
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
              1チームの人数目安
            </label>
            <div className="flex items-center gap-3">
              <input type="range" min={3} max={10} value={teamSize} onChange={(e) => setTeamSize(+e.target.value)}
                className="flex-1" />
              <span className="font-bold w-8 text-center" style={{ color: "var(--color-ink-800)" }}>{teamSize}名</span>
            </div>
            <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
              アクティブ {activeMembers.length}名 → 約 {teamCount}チーム
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: "var(--color-ink-600)" }}>振り分け方法</label>
            <div className="flex gap-2">
              <button
                onClick={() => setMode("random")}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-2xl text-sm font-medium"
                style={{
                  background: mode === "random" ? "var(--color-brand)" : "var(--color-paper-200)",
                  color: mode === "random" ? "white" : "var(--color-ink-600)",
                }}
              >
                <Shuffle size={14} /> ランダム
              </button>
              <button
                onClick={() => setMode("ai")}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-2xl text-sm font-medium"
                style={{
                  background: mode === "ai" ? "var(--color-brand)" : "var(--color-paper-200)",
                  color: mode === "ai" ? "white" : "var(--color-ink-600)",
                }}
              >
                <Bot size={14} /> AI振り分け
              </button>
            </div>
          </div>

          {mode === "ai" && (
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
                振り分けの方針（AIへの指示）*
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="例: 異業種が同じチームになるようにしてください。不動産・建築系は分けてください。"
                rows={3}
                className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
                style={{ borderColor: "var(--color-paper-300)" }}
              />
            </div>
          )}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl text-sm"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button
            onClick={() => assign.mutate()}
            disabled={(mode === "ai" && !prompt.trim()) || assign.isPending}
            className="flex-1 py-2.5 rounded-2xl text-sm text-white disabled:opacity-50 flex items-center justify-center gap-1.5"
            style={{ background: "var(--color-brand)" }}
          >
            {assign.isPending ? "振り分け中..." : <><Shuffle size={14} /> 振り分ける</>}
          </button>
        </div>
      </div>
    </div>
  );
}
