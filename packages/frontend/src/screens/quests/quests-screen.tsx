// =============================================================
// お題一覧 + 挑戦モーダル（達成バッジ・×2ボーナス対応）
// =============================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, X, CheckCircle2, Star, Trophy } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import type { PublicMember, Skill } from "@shared/types";

type Quest = {
  id: string; title: string; story: string; emoji: string;
  level: "normal" | "hard"; skillCount: number; required2x: number | null;
  reward: number; deadline: number | null; status: string; isSolved: boolean;
};
type QuestsResponse  = { data: Quest[] };
type MembersResponse = { data: PublicMember[] };
type AttemptResult   = { data: { isCorrect: boolean; reward: number; message: string; isFirstCorrect: boolean } };

export function QuestsScreen() {
  const { data, isLoading } = useQuery({
    queryKey: ["quests"],
    queryFn: () => api.get<QuestsResponse>("/quests"),
  });

  const [selectedQuest, setSelectedQuest] = useState<Quest | null>(null);
  const [filter, setFilter] = useState<"all" | "unsolved" | "solved">("all");

  const quests = data?.data ?? [];
  const filtered = quests.filter((q) => {
    if (filter === "unsolved") return !q.isSolved;
    if (filter === "solved")   return q.isSolved;
    return true;
  });

  const solvedCount = quests.filter((q) => q.isSolved).length;

  return (
    <div className="px-4 py-6 pb-24 max-w-xl mx-auto">
      {/* ヘッダー */}
      <div className="mb-4">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          📜 お題
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-500)" }}>
          スキルを組み合わせて謎を解こう
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
            <QuestCard key={quest.id} quest={quest} onChallenge={() => setSelectedQuest(quest)} />
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>
              <p className="text-4xl mb-2">📭</p>
              <p>{filter === "solved" ? "まだクリアしたお題がありません" : "現在公開中のお題はありません"}</p>
            </div>
          )}
        </div>
      )}

      {selectedQuest && (
        <ChallengeModal quest={selectedQuest} onClose={() => setSelectedQuest(null)} />
      )}
    </div>
  );
}

// ---- クエストカード ----
function QuestCard({ quest, onChallenge }: { quest: Quest; onChallenge: () => void }) {
  const isHard = quest.level === "hard";
  return (
    <div className="card-paper rounded-3xl p-5"
      style={{ opacity: quest.isSolved ? 0.75 : 1 }}>
      <div className="flex items-start gap-3 mb-3">
        <span className="text-3xl shrink-0">{quest.emoji}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
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
          <p className="text-sm leading-relaxed" style={{ color: "var(--color-ink-600)" }}>
            {quest.story}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs" style={{ color: "var(--color-ink-500)" }}>
          <span>🧩 スキル {quest.skillCount}個</span>
          <span className="font-bold" style={{ color: "var(--color-accent)" }}>+{quest.reward}pt</span>
          {quest.deadline && (
            <span>📅 {new Date(quest.deadline * 1000).toLocaleDateString("ja-JP")}</span>
          )}
        </div>
        <button onClick={onChallenge}
          className="text-sm px-4 py-2 rounded-2xl font-medium transition active:opacity-80"
          style={{ background: quest.isSolved ? "var(--color-paper-300)" : "var(--color-brand)", color: quest.isSolved ? "var(--color-ink-600)" : "white" }}>
          {quest.isSolved ? "再挑戦" : "挑戦する ⚔️"}
        </button>
      </div>
    </div>
  );
}

// ---- 挑戦モーダル ----
function ChallengeModal({ quest, onClose }: { quest: Quest; onClose: () => void }) {
  const me = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ["members"],
    queryFn: () => api.get<MembersResponse>("/members"),
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<AttemptResult["data"] | null>(null);

  // 利用可能スキル（自分 + digital/real 接続メンバー）
  const availableSkills: { skill: Skill; memberName: string; memberId: string; connectionStatus: string }[] = [];
  const members = membersData?.data ?? [];

  for (const member of members) {
    const isSelf = member.id === me?.id;
    const unlocked = isSelf || member.connectionStatus === "digital" || member.connectionStatus === "real";
    if (unlocked) {
      for (const skill of member.skills) {
        availableSkills.push({
          skill,
          memberName: isSelf ? "自分" : member.name,
          memberId: member.id,
          connectionStatus: isSelf ? "self" : (member.connectionStatus ?? "none"),
        });
      }
    }
  }

  function toggleSkill(name: string) {
    if (result) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else if (next.size < quest.skillCount) {
        next.add(name);
      }
      return next;
    });
  }

  const attemptMutation = useMutation({
    mutationFn: () =>
      api.post<AttemptResult>(`/quests/${quest.id}/attempts`, {
        selectedSkillNames: Array.from(selected),
      }),
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
  const realCount = [...selected].filter((name) => {
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
        <div className="flex items-start justify-between p-5 border-b"
          style={{ borderColor: "var(--color-paper-300)" }}>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-2xl">{quest.emoji}</span>
              <h2 className="font-semibold" style={{ fontFamily: "var(--font-klee)" }}>{quest.title}</h2>
              {isHard && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--color-brand)", color: "white" }}>🔥 難題</span>}
            </div>
            <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "var(--color-ink-500)" }}>{quest.story}</p>
            <div className="flex gap-3 mt-1.5 text-xs" style={{ color: "var(--color-ink-500)" }}>
              <span>🧩 {quest.skillCount}個</span>
              <span className="font-bold" style={{ color: "var(--color-accent)" }}>
                +{bonusActive ? quest.reward * 2 : quest.reward}pt
                {bonusActive && <span className="ml-1 text-xs">×2!</span>}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="ml-2 p-1.5 rounded-xl shrink-0" style={{ color: "var(--color-ink-400)" }}>
            <X size={20} />
          </button>
        </div>

        <div className="p-5">
          {result ? (
            <ResultPanel result={result} onClose={onClose} onRetry={() => { setResult(null); setSelected(new Set()); }} />
          ) : (
            <>
              {/* ×2ボーナス説明 */}
              {isHard && required2x > 0 && (
                <div className="mb-3 p-3 rounded-2xl text-xs"
                  style={{ background: bonusActive ? "rgba(212,160,59,0.15)" : "var(--color-paper-200)", color: bonusActive ? "var(--color-accent)" : "var(--color-ink-500)" }}>
                  {bonusActive
                    ? `✨ リアルカード${required2x}枚以上！×2ボーナス発動中！`
                    : `💡 リアルカードを持つ相手のスキルを${required2x}個以上選ぶと報酬×2（現在 ${realCount}/${required2x}）`}
                </div>
              )}

              <p className="text-sm font-medium mb-3" style={{ color: "var(--color-ink-700)" }}>
                🧩 スキルを <span className="font-bold" style={{ color: "var(--color-brand)" }}>{quest.skillCount}個</span> 選ぼう
                <span className="ml-2 text-xs" style={{ color: "var(--color-ink-400)" }}>({selected.size}/{quest.skillCount})</span>
              </p>

              {membersLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 size={24} className="animate-spin" style={{ color: "var(--color-brand)" }} />
                </div>
              ) : availableSkills.length === 0 ? (
                <div className="text-center py-6" style={{ color: "var(--color-ink-400)" }}>
                  <p className="text-sm">使えるスキルがありません</p>
                  <p className="text-xs mt-1">1to1を完了するとスキルが増えます</p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto -mx-1 px-1">
                  {availableSkills.map(({ skill, memberName, connectionStatus }) => {
                    const isSelected = selected.has(skill.name);
                    const isReal = connectionStatus === "real";
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
                          <div className="flex items-center gap-1 mt-0.5">
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
                        {isSelected && <CheckCircle2 size={16} style={{ color: "var(--color-brand)" }} />}
                      </button>
                    );
                  })}
                </div>
              )}

              <button onClick={() => attemptMutation.mutate()}
                disabled={selected.size !== quest.skillCount || attemptMutation.isPending}
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
