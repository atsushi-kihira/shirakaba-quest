// =============================================================
// お題一覧 + 挑戦モーダル（ミッション強調・スキルスロット表示対応）
// =============================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, X, CheckCircle2, Trophy, Star, Target } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";
import { QuestStory } from "@/lib/quest-story";
import type { PublicMember, Skill } from "@shared/types";

const SLOT_NUMS = ["①", "②", "③", "④", "⑤"];

type Quest = {
  id: string; title: string; story: string; mission: string; emoji: string;
  level: "normal" | "hard"; skillCount: number; required2x: number | null;
  reward: number; deadline: number | null; status: string; isSolved: boolean;
};
type TeamMember = {
  id: string; memberId: string; isLeader: boolean;
  member?: { id: string; name: string; emoji: string; bgColor: string; category: string; skills: Skill[] };
};
type Team = { id: string; name: string; emblemEmoji: string; isMine: boolean; members: TeamMember[] };
type QuestsResponse  = { data: Quest[] };
type MembersResponse = { data: PublicMember[] };
type TeamsResponse   = { data: Team[] };
type AttemptResult   = { data: { isCorrect: boolean; reward: number; message: string; isFirstCorrect: boolean } };

export function QuestsScreen() {
  const settings = useSettings();
  const termUsp   = settings.termUsp;
  const termQuest = settings.termQuest;

  const { data, isLoading } = useQuery({
    queryKey: ["quests"],
    queryFn: () => api.get<QuestsResponse>("/quests"),
  });

  const [selectedQuest, setSelectedQuest] = useState<Quest | null>(null);
  const [filter, setFilter] = useState<"all" | "unsolved" | "solved">("all");

  const quests = data?.data ?? [];
  const filtered = (() => {
    const base = quests.filter((q) => {
      if (filter === "unsolved") return !q.isSolved;
      if (filter === "solved")   return q.isSolved;
      return true;
    });
    if (filter === "all") {
      return [...base.filter((q) => !q.isSolved), ...base.filter((q) => q.isSolved)];
    }
    return base;
  })();

  const solvedCount = quests.filter((q) => q.isSolved).length;

  return (
    <div className="px-4 py-6 pb-24 max-w-xl mx-auto">
      {/* ヘッダー */}
      <div className="mb-4">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          📜 {termQuest}
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-500)" }}>
          {termUsp}を組み合わせて謎を解こう
        </p>
      </div>

      {/* 達成状況サマリー */}
      {quests.length > 0 && (
        <div className="card-paper rounded-2xl px-4 py-3 mb-4 flex items-center gap-3">
          <Trophy size={20} style={{ color: "var(--color-accent)" }} />
          <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>
            <span className="font-bold" style={{ color: "var(--color-accent)" }}>{solvedCount}</span>
            <span style={{ color: "var(--color-ink-500)" }}> / {quests.length} クリア</span>
          </span>
          {/* フィルター */}
          <div className="ml-auto flex gap-1">
            {(["all", "unsolved", "solved"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className="text-xs px-2.5 py-1 rounded-full transition"
                style={{
                  background: filter === f ? "var(--color-brand)" : "var(--color-paper-200)",
                  color: filter === f ? "white" : "var(--color-ink-500)",
                }}>
                {{ all: "すべて", unsolved: "未クリア", solved: "クリア済み" }[f]}
              </button>
            ))}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
        </div>
      )}

      {!isLoading && (
        <div className="space-y-4">
          {filtered.map((quest) => (
            <QuestCard key={quest.id} quest={quest} termUsp={termUsp}
              onChallenge={() => setSelectedQuest(quest)} />
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>
              <p className="text-4xl mb-2">📭</p>
              <p>{filter === "solved" ? `まだクリアした${termQuest}がありません` : `現在公開中の${termQuest}はありません`}</p>
            </div>
          )}
        </div>
      )}

      {selectedQuest && (
        <ChallengeModal quest={selectedQuest} termUsp={termUsp} onClose={() => setSelectedQuest(null)} />
      )}
    </div>
  );
}

// ---- クエストカード ----
function QuestCard({ quest, termUsp, onChallenge }: {
  quest: Quest; termUsp: string; onChallenge: () => void;
}) {
  const isHard = quest.level === "hard";
  const [storyExpanded, setStoryExpanded] = useState(false);

  return (
    <div className="card-paper rounded-3xl overflow-hidden" style={{ opacity: quest.isSolved ? 0.78 : 1 }}>
      {/* ヘッダー部 */}
      <div className="p-5 pb-3">
        <div className="flex items-start gap-3">
          <span className="text-3xl shrink-0 mt-0.5">{quest.emoji}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <h2 className="font-semibold text-base" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
                {quest.title}
              </h2>
              {isHard && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: "var(--color-brand)", color: "white" }}>🔥 難題</span>
              )}
              {quest.isSolved && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
                  style={{ background: "rgba(90,140,92,0.15)", color: "var(--color-success)" }}>
                  <CheckCircle2 size={10} /> クリア済み
                </span>
              )}
            </div>

            {/* ストーリー */}
            <QuestStory
              text={quest.story}
              className={`text-sm leading-relaxed${storyExpanded ? "" : " line-clamp-2"}`}
              style={{ color: "var(--color-ink-600)" }}
            />
            <button onClick={() => setStoryExpanded((v) => !v)}
              className="text-xs mt-0.5" style={{ color: "var(--color-brand)" }}>
              {storyExpanded ? "閉じる ▲" : "続きを読む ▼"}
            </button>
          </div>
        </div>
      </div>

      {/* ミッションブロック */}
      {quest.mission && (
        <div className="mx-4 mb-3 px-3.5 py-2.5 rounded-2xl flex gap-2.5 items-start"
          style={{ background: "rgba(181,56,75,0.07)", border: "1px solid rgba(181,56,75,0.18)" }}>
          <Target size={15} className="shrink-0 mt-0.5" style={{ color: "var(--color-brand)" }} />
          <div>
            <p className="text-xs font-semibold mb-0.5" style={{ color: "var(--color-brand)" }}>ミッション</p>
            <p className="text-sm leading-relaxed" style={{ color: "var(--color-ink-700)" }}>{quest.mission}</p>
          </div>
        </div>
      )}

      {/* 必要スキルスロット */}
      <div className="px-4 mb-3">
        <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--color-ink-500)" }}>
          🧩 解決に必要な{termUsp}（{quest.skillCount}個）
        </p>
        <div className="flex gap-1.5 flex-wrap">
          {Array.from({ length: quest.skillCount }, (_, i) => (
            <div key={i} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold"
              style={{ background: "var(--color-paper-300)", color: "var(--color-ink-500)" }}>
              <span>{SLOT_NUMS[i]}</span>
              <span className="tracking-widest">？？？</span>
            </div>
          ))}
        </div>
      </div>

      {/* フッター */}
      <div className="px-4 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs" style={{ color: "var(--color-ink-500)" }}>
          <span className="font-bold text-sm" style={{ color: "var(--color-accent)" }}>+{quest.reward}pt</span>
          {quest.deadline && (
            <span>📅 {new Date(quest.deadline * 1000).toLocaleDateString("ja-JP")}</span>
          )}
        </div>
        <button onClick={onChallenge}
          className="text-sm px-5 py-2 rounded-2xl font-medium transition active:opacity-80"
          style={{
            background: quest.isSolved ? "var(--color-paper-300)" : "var(--color-brand)",
            color: quest.isSolved ? "var(--color-ink-600)" : "white",
          }}>
          {quest.isSolved ? `再挑戦` : "挑戦する ⚔️"}
        </button>
      </div>
    </div>
  );
}

// ---- 挑戦モーダル ----
function ChallengeModal({ quest, termUsp, onClose }: { quest: Quest; termUsp: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"connections" | "team">("connections");

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ["members"],
    queryFn: () => api.get<MembersResponse>("/members"),
  });

  const { data: teamsData, isLoading: teamsLoading } = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.get<TeamsResponse>("/teams"),
    enabled: mode === "team",
  });

  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<AttemptResult["data"] | null>(null);

  const members = membersData?.data ?? [];
  const teams = teamsData?.data ?? [];
  const myTeam = teams.find((t) => t.isMine) ?? (teams.length > 0 ? teams[0] : null);

  const connectionMap = new Map<string, string>(members.map((m) => [m.id, m.connectionStatus]));

  const availableSkills: { skill: Skill; memberName: string; memberId: string; connectionStatus: string }[] = [];

  if (mode === "connections") {
    for (const member of members) {
      const isSelf = member.connectionStatus === "self";
      const unlocked = isSelf || member.connectionStatus === "digital" || member.connectionStatus === "real";
      if (unlocked) {
        for (const skill of member.skills) {
          availableSkills.push({ skill, memberName: isSelf ? "自分" : member.name, memberId: member.id, connectionStatus: member.connectionStatus });
        }
      }
    }
  } else {
    const teamMembers = myTeam?.members ?? [];
    for (const tm of teamMembers) {
      const m = tm.member;
      if (!m) continue;
      const connStatus = connectionMap.get(m.id) ?? "none";
      const isSelf = connStatus === "self";
      for (const skill of m.skills) {
        availableSkills.push({ skill, memberName: isSelf ? "自分" : m.name, memberId: m.id, connectionStatus: connStatus });
      }
    }
  }

  function toggleSkill(name: string) {
    if (result) return;
    setSelected((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      if (prev.length >= quest.skillCount) return prev;
      return [...prev, name];
    });
  }

  const attemptMutation = useMutation({
    mutationFn: () =>
      api.post<AttemptResult>(`/quests/${quest.id}/attempts`, { selectedSkillNames: selected }),
    onSuccess: (res) => {
      setResult(res.data);
      if (res.data.isCorrect) {
        qc.invalidateQueries({ queryKey: ["quests"] });
        qc.invalidateQueries({ queryKey: ["ranking"] });
      }
    },
  });

  const isHard = quest.level === "hard";
  const required2x = quest.required2x ?? 0;
  const realCount = selected.filter((name) => {
    const s = availableSkills.find((a) => a.skill.name === name);
    return s?.connectionStatus === "real";
  }).length;
  const bonusActive = isHard && required2x > 0 && realCount >= required2x;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(26,20,16,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden"
        style={{ background: "var(--color-paper-100)", maxHeight: "92dvh", overflowY: "auto" }}>

        {/* ヘッダー */}
        <div className="p-5 pb-0">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
              <span className="text-2xl">{quest.emoji}</span>
              <h2 className="font-semibold text-base" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
                {quest.title}
              </h2>
              {isHard && (
                <span className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: "var(--color-brand)", color: "white" }}>🔥 難題</span>
              )}
            </div>
            <button onClick={onClose} className="ml-2 p-1.5 rounded-xl shrink-0" style={{ color: "var(--color-ink-400)" }}>
              <X size={20} />
            </button>
          </div>

          {/* ストーリー（折りたたみ） */}
          <details className="mb-3 group">
            <summary className="text-xs cursor-pointer select-none list-none flex items-center gap-1"
              style={{ color: "var(--color-ink-400)" }}>
              <span className="group-open:hidden">📖 ストーリーを読む ▼</span>
              <span className="hidden group-open:inline">📖 ストーリーを閉じる ▲</span>
            </summary>
            <div className="mt-1.5 px-1">
              <QuestStory text={quest.story} className="text-sm leading-relaxed" style={{ color: "var(--color-ink-600)" }} />
            </div>
          </details>

          {/* ミッション（常時強調表示） */}
          {quest.mission && (
            <div className="mb-4 px-3.5 py-3 rounded-2xl flex gap-2.5 items-start"
              style={{ background: "rgba(181,56,75,0.09)", border: "1.5px solid rgba(181,56,75,0.25)" }}>
              <Target size={16} className="shrink-0 mt-0.5" style={{ color: "var(--color-brand)" }} />
              <div>
                <p className="text-xs font-bold mb-0.5" style={{ color: "var(--color-brand)" }}>🎯 ミッション</p>
                <p className="text-sm leading-relaxed font-medium" style={{ color: "var(--color-ink-800)" }}>
                  {quest.mission}
                </p>
              </div>
            </div>
          )}

          {/* 報酬・ボーナス表示 */}
          <div className="flex items-center gap-3 mb-4 text-sm">
            <span className="font-bold text-base" style={{ color: "var(--color-accent)" }}>
              +{bonusActive ? quest.reward * 2 : quest.reward}pt
              {bonusActive && <span className="ml-1 text-xs font-normal" style={{ color: "var(--color-accent)" }}>✨ ×2ボーナス！</span>}
            </span>
            {quest.deadline && (
              <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>
                📅 {new Date(quest.deadline * 1000).toLocaleDateString("ja-JP")}
              </span>
            )}
          </div>

          {/* スキルスロット（選択状況） */}
          <div className="mb-1">
            <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-ink-600)" }}>
              🧩 必要な{termUsp}を {quest.skillCount}個 選択してください
              <span className="ml-1.5 font-normal" style={{ color: "var(--color-ink-400)" }}>
                ({selected.length}/{quest.skillCount})
              </span>
            </p>
            <div className="flex gap-1.5 flex-wrap mb-3">
              {Array.from({ length: quest.skillCount }, (_, i) => {
                const name = selected[i];
                const skill = name ? availableSkills.find((a) => a.skill.name === name)?.skill : undefined;
                const filled = Boolean(name);
                return (
                  <div key={i}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition"
                    style={{
                      background: filled ? "var(--color-brand)" : "var(--color-paper-300)",
                      color: filled ? "white" : "var(--color-ink-400)",
                      minWidth: "4rem",
                    }}>
                    <span className="shrink-0">{SLOT_NUMS[i]}</span>
                    {filled
                      ? <><span>{skill?.emoji ?? ""}</span><span className="truncate max-w-[4rem]">{name}</span></>
                      : <span>？？？</span>
                    }
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="px-5 pb-5">
          {result ? (
            <ResultPanel result={result} onClose={onClose} onRetry={() => { setResult(null); setSelected([]); }} />
          ) : (
            <>
              {/* ×2ボーナス説明 */}
              {isHard && required2x > 0 && (
                <div className="mb-3 p-3 rounded-2xl text-xs"
                  style={{
                    background: bonusActive ? "rgba(212,160,59,0.15)" : "var(--color-paper-200)",
                    color: bonusActive ? "var(--color-accent)" : "var(--color-ink-500)",
                  }}>
                  {bonusActive
                    ? `✨ リアルカード${required2x}枚以上！×2ボーナス発動中！`
                    : `💡 リアルカードを持つ相手のスキルを${required2x}個以上選ぶと報酬×2（現在 ${realCount}/${required2x}）`}
                </div>
              )}

              {/* USP選択モード */}
              <div className="flex gap-2 mb-3">
                <button onClick={() => { setMode("connections"); setSelected([]); }}
                  className="flex-1 py-1.5 text-xs rounded-xl font-medium transition"
                  style={{
                    background: mode === "connections" ? "var(--color-brand)" : "var(--color-paper-200)",
                    color: mode === "connections" ? "white" : "var(--color-ink-600)",
                  }}>
                  🤝 自分+1to1なかま
                </button>
                <button onClick={() => { setMode("team"); setSelected([]); }}
                  className="flex-1 py-1.5 text-xs rounded-xl font-medium transition"
                  style={{
                    background: mode === "team" ? "var(--color-brand)" : "var(--color-paper-200)",
                    color: mode === "team" ? "white" : "var(--color-ink-600)",
                  }}>
                  🦊 チームメンバー
                </button>
              </div>

              {membersLoading || (mode === "team" && teamsLoading) ? (
                <div className="flex justify-center py-8">
                  <Loader2 size={24} className="animate-spin" style={{ color: "var(--color-brand)" }} />
                </div>
              ) : availableSkills.length === 0 ? (
                <div className="text-center py-6" style={{ color: "var(--color-ink-400)" }}>
                  <p className="text-sm">使える{termUsp}がありません</p>
                  <p className="text-xs mt-1">
                    {mode === "connections"
                      ? "1to1を完了すると" + termUsp + "が増えます"
                      : "チームに所属するとメンバーの" + termUsp + "が使えます"}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto -mx-1 px-1">
                  {availableSkills.map(({ skill, memberName, connectionStatus }) => {
                    const isSelected = selected.includes(skill.name);
                    const isReal = connectionStatus === "real";
                    const slotIndex = selected.indexOf(skill.name);
                    return (
                      <button key={`${memberName}-${skill.name}`}
                        onClick={() => toggleSkill(skill.name)}
                        className="w-full flex items-center gap-2.5 p-3 rounded-2xl text-left transition border-2 active:opacity-80"
                        style={{
                          background: isSelected ? "var(--color-paper-300)" : "var(--color-paper-50)",
                          borderColor: isSelected ? "var(--color-brand)" : "transparent",
                        }}>
                        <span className="text-xl">{skill.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>{skill.name}</span>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-xs" style={{ color: "var(--color-ink-500)" }}>
                              {connectionStatus === "self" ? "🙋 自分" : `👤 ${memberName}`}
                            </span>
                            {isReal && (
                              <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                                style={{ background: "rgba(212,160,59,0.2)", color: "var(--color-accent)" }}>
                                🃏 リアル
                              </span>
                            )}
                          </div>
                        </div>
                        {isSelected && (
                          <span className="text-xs font-bold px-2 py-1 rounded-full"
                            style={{ background: "var(--color-brand)", color: "white" }}>
                            {SLOT_NUMS[slotIndex]}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <button onClick={() => attemptMutation.mutate()}
                disabled={selected.length !== quest.skillCount || attemptMutation.isPending}
                className="w-full mt-4 flex items-center justify-center gap-2 rounded-2xl py-3.5 font-semibold text-sm transition disabled:opacity-40 active:opacity-80"
                style={{ background: "var(--color-brand)", color: "white", minHeight: "52px" }}>
                {attemptMutation.isPending
                  ? <><Loader2 size={16} className="animate-spin" /> 判定中...</>
                  : "⚔️ この組み合わせで挑戦！"}
              </button>

              {attemptMutation.error && (
                <p className="mt-2 text-xs text-center" style={{ color: "var(--color-brand)" }}>
                  {attemptMutation.error instanceof ApiError ? attemptMutation.error.message : "エラーが発生しました"}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- 結果パネル ----
function ResultPanel({ result, onClose, onRetry }: {
  result: AttemptResult["data"];
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="text-center py-4">
      <div className="text-6xl mb-3">{result.isCorrect ? "🎉" : "😔"}</div>
      <p className="font-semibold text-lg mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
        {result.isCorrect ? "正解！" : "残念..."}
      </p>
      <p className="text-sm mb-4" style={{ color: "var(--color-ink-600)" }}>{result.message}</p>
      {result.isCorrect && result.reward > 0 && (
        <div className="inline-flex items-center gap-2 rounded-2xl px-6 py-2 mb-5"
          style={{ background: "var(--color-accent)", color: "white" }}>
          <Star size={16} fill="currentColor" />
          <span className="text-lg font-bold">+{result.reward}pt</span>
          <span className="text-sm">獲得！</span>
        </div>
      )}
      <div className="flex gap-2">
        {!result.isCorrect && (
          <button onClick={onRetry}
            className="flex-1 rounded-2xl py-3 text-sm font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
            もう一度考える
          </button>
        )}
        <button onClick={onClose}
          className="flex-1 rounded-2xl py-3 text-sm font-medium"
          style={{ background: "var(--color-brand)", color: "white" }}>
          {result.isCorrect ? "閉じる" : "あとで挑戦する"}
        </button>
      </div>
    </div>
  );
}
