// =============================================================
// お題一覧画面 + 挑戦モーダル
// =============================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, X, CheckCircle2, XCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import type { PublicMember, Skill } from "@shared/types";

type Quest = {
  id: string; title: string; story: string; emoji: string;
  level: "normal" | "hard"; skillCount: number; reward: number;
  deadline: number | null; status: string;
};
type QuestsResponse = { data: Quest[] };
type MembersResponse = { data: PublicMember[] };
type AttemptResult = { data: { isCorrect: boolean; reward: number; message: string; isFirstCorrect: boolean } };

export function QuestsScreen() {
  const { data, isLoading } = useQuery({
    queryKey: ["quests"],
    queryFn: () => api.get<QuestsResponse>("/quests"),
  });

  const [selectedQuest, setSelectedQuest] = useState<Quest | null>(null);

  const quests = data?.data ?? [];

  return (
    <div className="px-4 py-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          📜 お題
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-ink-500)" }}>
          スキルを組み合わせて謎を解こう
        </p>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
        </div>
      )}

      {!isLoading && (
        <div className="space-y-4">
          {quests.map((quest) => (
            <QuestCard key={quest.id} quest={quest} onChallenge={() => setSelectedQuest(quest)} />
          ))}
          {quests.length === 0 && (
            <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>
              <p className="text-4xl mb-2">📭</p>
              <p>現在公開中のお題はありません</p>
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
    <div className="card-paper rounded-3xl p-5">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-3xl shrink-0">{quest.emoji}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-semibold text-base" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
              {quest.title}
            </h2>
            {isHard && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: "var(--color-brand)", color: "white" }}>
                🔥 難題
              </span>
            )}
          </div>
          <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--color-ink-600)" }}>
            {quest.story}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-3 text-xs" style={{ color: "var(--color-ink-500)" }}>
          <span>🧩 スキル {quest.skillCount}個</span>
          <span className="font-bold" style={{ color: "var(--color-accent)" }}>
            +{quest.reward}pt
          </span>
          {quest.deadline && (
            <span>📅 {new Date(quest.deadline * 1000).toLocaleDateString("ja-JP")}</span>
          )}
        </div>
        <button
          onClick={onChallenge}
          className="text-sm px-4 py-2 rounded-2xl font-medium transition"
          style={{ background: "var(--color-brand)", color: "white" }}
        >
          挑戦する ⚔️
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

  // 利用可能スキル: 自分 + 入手済みカード
  const allSkills: { skill: Skill; memberName: string; isSelf: boolean }[] = [];

  const members = membersData?.data ?? [];
  for (const member of members) {
    const isSelf = member.id === me?.id;
    const isUnlocked = isSelf || member.connectionStatus === "digital" || member.connectionStatus === "real";
    if (isUnlocked) {
      for (const skill of member.skills) {
        allSkills.push({ skill, memberName: isSelf ? "自分" : member.name, isSelf });
      }
    }
  }

  function toggleSkill(name: string) {
    if (result) return; // 結果表示中は変更不可
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
      qc.invalidateQueries({ queryKey: ["ranking"] });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(26,20,16,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-3xl overflow-hidden"
        style={{ background: "var(--color-paper-100)", maxHeight: "90dvh", overflowY: "auto" }}>
        {/* ヘッダー */}
        <div className="flex items-start justify-between p-5 border-b"
          style={{ borderColor: "var(--color-paper-300)" }}>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{quest.emoji}</span>
              <h2 className="font-semibold text-base" style={{ fontFamily: "var(--font-klee)" }}>
                {quest.title}
              </h2>
            </div>
            <p className="text-xs mt-1" style={{ color: "var(--color-ink-500)" }}>
              {quest.story}
            </p>
          </div>
          <button onClick={onClose} className="ml-3 shrink-0 p-1 rounded-xl"
            style={{ color: "var(--color-ink-400)" }}>
            <X size={20} />
          </button>
        </div>

        <div className="p-5">
          {/* 結果表示 */}
          {result ? (
            <ResultPanel result={result} questSkillCount={quest.skillCount} onClose={onClose} onRetry={() => { setResult(null); setSelected(new Set()); }} />
          ) : (
            <>
              <p className="text-sm font-medium mb-3" style={{ color: "var(--color-ink-700)" }}>
                🧩 スキルを <span className="font-bold" style={{ color: "var(--color-brand)" }}>{quest.skillCount}個</span> 選んで挑戦しよう
                <span className="ml-2 text-xs" style={{ color: "var(--color-ink-400)" }}>
                  ({selected.size}/{quest.skillCount} 選択中)
                </span>
              </p>

              {membersLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 size={24} className="animate-spin" style={{ color: "var(--color-brand)" }} />
                </div>
              ) : (
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {allSkills.map(({ skill, memberName, isSelf }) => {
                    const isSelected = selected.has(skill.name);
                    return (
                      <button
                        key={`${memberName}-${skill.name}`}
                        onClick={() => toggleSkill(skill.name)}
                        className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition border-2 ${
                          isSelected ? "border-current" : "border-transparent"
                        }`}
                        style={{
                          background: isSelected ? "var(--color-paper-200)" : "var(--color-paper-50)",
                          borderColor: isSelected ? "var(--color-brand)" : "transparent",
                        }}
                      >
                        <span className={`text-xs px-2 py-0.5 rounded-full ring-1 font-medium shrink-0 ${skill.color}`}>
                          {skill.emoji} {skill.name}
                        </span>
                        <span className="text-xs" style={{ color: "var(--color-ink-500)" }}>
                          {isSelf ? "🙋 自分" : `👤 ${memberName}`}
                        </span>
                        {isSelected && <CheckCircle2 size={14} className="ml-auto shrink-0" style={{ color: "var(--color-brand)" }} />}
                      </button>
                    );
                  })}
                </div>
              )}

              <button
                onClick={() => attemptMutation.mutate()}
                disabled={selected.size !== quest.skillCount || attemptMutation.isPending}
                className="w-full mt-4 flex items-center justify-center gap-2 rounded-2xl py-3 font-medium text-sm transition disabled:opacity-40"
                style={{ background: "var(--color-brand)", color: "white" }}
              >
                {attemptMutation.isPending
                  ? <><Loader2 size={16} className="animate-spin" /> 判定中...</>
                  : "⚔️ この組み合わせで挑戦！"
                }
              </button>

              {attemptMutation.error && (
                <p className="mt-2 text-xs text-center" style={{ color: "#dc2626" }}>
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
function ResultPanel({
  result,
  questSkillCount,
  onClose,
  onRetry,
}: {
  result: AttemptResult["data"];
  questSkillCount: number;
  onClose: () => void;
  onRetry: () => void;
}) {
  void questSkillCount;
  return (
    <div className="text-center py-4">
      <div className="text-6xl mb-3">{result.isCorrect ? "🎉" : "😔"}</div>
      <p className="font-semibold text-base mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
        {result.isCorrect ? "正解！" : "残念..."}
      </p>
      <p className="text-sm mb-4" style={{ color: "var(--color-ink-600)" }}>
        {result.message}
      </p>
      {result.isCorrect && result.reward > 0 && (
        <div className="inline-flex items-center gap-2 rounded-2xl px-5 py-2 mb-4"
          style={{ background: "var(--color-accent)", color: "white" }}>
          <span className="text-lg font-bold">+{result.reward}pt</span>
          <span className="text-sm">獲得！</span>
        </div>
      )}
      <div className="flex gap-2">
        {!result.isCorrect && (
          <button onClick={onRetry}
            className="flex-1 flex items-center justify-center gap-1 rounded-2xl py-2.5 text-sm font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
            <XCircle size={14} /> もう一度考える
          </button>
        )}
        <button onClick={onClose}
          className="flex-1 rounded-2xl py-2.5 text-sm font-medium"
          style={{ background: "var(--color-brand)", color: "white" }}>
          {result.isCorrect ? "閉じる" : "あとで挑戦する"}
        </button>
      </div>
    </div>
  );
}
