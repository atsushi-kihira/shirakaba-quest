// =============================================================
// 管理画面 — お題管理（作成 / AI生成 / 編集 / 削除 / 公開）
// 正解スキルは定義済み USP から選択する
// =============================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Sparkles, Pencil, Trash2, Send, RefreshCw, X, Wand2, Check, CheckSquare, Square } from "lucide-react";
import { api } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";
import { QuestStory } from "@/lib/quest-story";
import type { Usp } from "@shared/types";

type AdminQuest = {
  id: string;
  title: string;
  story: string;
  emoji: string;
  level: "normal" | "hard";
  skillCount: number;
  answerSkills: string[];
  reward: number;
  status: "draft" | "published" | "deleted";
  deadline: number | null;
  source: "manual" | "ai";
  createdAt: number;
};

type QuestDraft = {
  title: string;
  story: string;
  emoji: string;
  level: "normal" | "hard";
  skillCount: number;
  answerSkills: string[];
  reward: number;
};

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  draft:     { label: "下書き",   color: "var(--color-ink-500)" },
  published: { label: "公開中",   color: "var(--color-success)" },
  deleted:   { label: "削除済み", color: "var(--color-ink-300)" },
};

/** USP一覧を取得する共通フック */
function useUsps() {
  return useQuery({
    queryKey: ["admin", "usps"],
    queryFn: () => api.get<{ data: Usp[] }>("/admin/usps"),
    staleTime: 60_000,
  });
}

export function AdminQuestsScreen() {
  const qc = useQueryClient();
  const { termQuest } = useSettings();
  const [showCreate, setShowCreate] = useState(false);
  const [editQuest, setEditQuest] = useState<AdminQuest | null>(null);
  const [aiModal, setAiModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  const { data: uspsData } = useUsps();
  const usps = uspsData?.data ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "quests"],
    queryFn: () => api.get<{ data: AdminQuest[] }>("/admin/quests"),
  });

  const publishMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/quests/${id}/publish`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "quests"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/quests/${id}`),
    onSuccess: () => {
      setDeleteConfirm(null);
      qc.invalidateQueries({ queryKey: ["admin", "quests"] });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => api.delete("/admin/quests", { ids }),
    onSuccess: () => {
      setSelectedIds(new Set());
      setBulkDeleteConfirm(false);
      qc.invalidateQueries({ queryKey: ["admin", "quests"] });
    },
  });

  const quests = (data?.data ?? []).filter((q) => q.status !== "deleted");
  const published = quests.filter((q) => q.status === "published");
  const drafts    = quests.filter((q) => q.status === "draft");

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(quests.map((q) => q.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  const isSelectMode = selectedIds.size > 0;

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-24">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            📜 {termQuest}管理
          </h1>
          {usps.length === 0 && (
            <p className="text-xs mt-1" style={{ color: "var(--color-brand)" }}>
              ⚠️ USPが未登録です。先に「USP管理」でUSPを登録してください。
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {isSelectMode ? (
            <>
              <button
                onClick={clearSelection}
                className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-medium transition hover:opacity-80"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
              >
                <X size={14} />
                選択解除
              </button>
              <button
                onClick={() => setBulkDeleteConfirm(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium text-white transition hover:opacity-80"
                style={{ background: "var(--color-brand)" }}
              >
                <Trash2 size={14} />
                {selectedIds.size}件を削除
              </button>
            </>
          ) : (
            <>
              {quests.length > 0 && (
                <button
                  onClick={selectAll}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-medium transition hover:opacity-80"
                  style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
                >
                  <CheckSquare size={14} />
                  まとめて選択
                </button>
              )}
              <button
                onClick={() => setAiModal(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium text-white transition hover:opacity-80"
                style={{ background: "var(--color-accent)" }}
              >
                <Sparkles size={15} />
                AI生成
              </button>
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium text-white transition hover:opacity-80"
                style={{ background: "var(--color-brand)" }}
              >
                <Plus size={15} />
                手動作成
              </button>
            </>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>読み込み中...</div>
      ) : (
        <>
          {published.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold mb-2 px-1" style={{ color: "var(--color-success)" }}>
                公開中 ({published.length})
              </h2>
              <div className="flex flex-col gap-3">
                {published.map((q) => (
                  <QuestRow key={q.id} quest={q}
                    selected={selectedIds.has(q.id)}
                    selectMode={isSelectMode}
                    onToggleSelect={() => toggleSelect(q.id)}
                    onEdit={() => setEditQuest(q)}
                    onDelete={() => setDeleteConfirm(q.id)}
                    onPublish={() => publishMutation.mutate(q.id)}
                    publishing={publishMutation.isPending}
                  />
                ))}
              </div>
            </section>
          )}

          {drafts.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold mb-2 px-1" style={{ color: "var(--color-ink-500)" }}>
                下書き ({drafts.length})
              </h2>
              <div className="flex flex-col gap-3">
                {drafts.map((q) => (
                  <QuestRow key={q.id} quest={q}
                    selected={selectedIds.has(q.id)}
                    selectMode={isSelectMode}
                    onToggleSelect={() => toggleSelect(q.id)}
                    onEdit={() => setEditQuest(q)}
                    onDelete={() => setDeleteConfirm(q.id)}
                    onPublish={() => publishMutation.mutate(q.id)}
                    publishing={publishMutation.isPending}
                  />
                ))}
              </div>
            </section>
          )}

          {quests.length === 0 && (
            <div className="text-center py-16" style={{ color: "var(--color-ink-400)" }}>
              <div className="text-4xl mb-3">📭</div>
              <p>{termQuest}がまだありません</p>
              <p className="text-sm mt-1">「AI生成」か「手動作成」で{termQuest}を作成しましょう</p>
            </div>
          )}
        </>
      )}

      {aiModal && (
        <AiGenerateModal
          usps={usps}
          onClose={() => setAiModal(false)}
          onCreated={() => {
            setAiModal(false);
            qc.invalidateQueries({ queryKey: ["admin", "quests"] });
          }}
        />
      )}

      {showCreate && (
        <QuestFormModal
          title={`${termQuest}を手動作成`}
          usps={usps}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ["admin", "quests"] });
          }}
        />
      )}

      {editQuest && (
        <QuestFormModal
          title={`${termQuest}を編集`}
          usps={usps}
          initial={editQuest}
          questId={editQuest.id}
          onClose={() => setEditQuest(null)}
          onSaved={() => {
            setEditQuest(null);
            qc.invalidateQueries({ queryKey: ["admin", "quests"] });
          }}
        />
      )}

      {deleteConfirm && (
        <ConfirmModal
          message={`この${termQuest}を削除しますか？`}
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={() => deleteMutation.mutate(deleteConfirm)}
          loading={deleteMutation.isPending}
        />
      )}

      {bulkDeleteConfirm && (
        <ConfirmModal
          message={`選択した ${selectedIds.size} 件の${termQuest}を削除しますか？`}
          onCancel={() => setBulkDeleteConfirm(false)}
          onConfirm={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}
          loading={bulkDeleteMutation.isPending}
        />
      )}
    </div>
  );
}

// ---- QuestRow ----
function QuestRow({
  quest, selected, selectMode, onToggleSelect, onEdit, onDelete, onPublish, publishing,
}: {
  quest: AdminQuest;
  selected: boolean;
  selectMode: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPublish: () => void;
  publishing: boolean;
}) {
  const st = STATUS_STYLE[quest.status];
  return (
    <div
      className="card-paper p-4 transition"
      style={{ outline: selected ? "2px solid var(--color-brand)" : "none", outlineOffset: "-2px" }}
    >
      <div className="flex items-start gap-3">
        {/* チェックボックス（選択モード時は常に表示、非選択モードでもホバーで表示） */}
        <button
          type="button"
          onClick={onToggleSelect}
          className="shrink-0 mt-0.5 transition hover:opacity-80"
          title={selected ? "選択解除" : "選択"}
        >
          {selected
            ? <CheckSquare size={20} style={{ color: "var(--color-brand)" }} />
            : <Square size={20} style={{ color: selectMode ? "var(--color-ink-400)" : "var(--color-paper-300)" }} />}
        </button>

        <span className="text-2xl">{quest.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold" style={{ color: "var(--color-ink-800)" }}>{quest.title}</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ background: "var(--color-paper-200)", color: st.color }}>
              {st.label}
            </span>
            {quest.source === "ai" && (
              <span className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: "var(--color-paper-200)", color: "var(--color-accent)" }}>
                ✨ AI
              </span>
            )}
          </div>
          <p className="text-xs mt-1 line-clamp-2" style={{ color: "var(--color-ink-500)" }}>{quest.story.replace(/\[\[([^[\]]+)\]\]/g, "$1")}</p>
          <div className="flex gap-3 mt-1.5 text-xs" style={{ color: "var(--color-ink-400)" }}>
            <span>USP {quest.skillCount}個</span>
            <span>報酬 {quest.reward}pt</span>
            <span>{quest.level === "hard" ? "🔥 ハード" : "⚔️ ノーマル"}</span>
          </div>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {quest.answerSkills.map((s) => (
              <span key={s} className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: "var(--color-paper-300)", color: "var(--color-ink-600)" }}>
                {s}
              </span>
            ))}
          </div>
        </div>
        {!selectMode && (
          <div className="flex gap-1.5 shrink-0">
            {quest.status === "draft" && (
              <button
                onClick={onPublish} disabled={publishing}
                className="flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs font-medium text-white transition hover:opacity-80"
                style={{ background: "var(--color-success)" }}
              >
                <Send size={12} />
                公開
              </button>
            )}
            <button onClick={onEdit}
              className="p-2 rounded-2xl transition hover:opacity-80"
              style={{ background: "var(--color-paper-200)" }} title="編集">
              <Pencil size={14} style={{ color: "var(--color-ink-500)" }} />
            </button>
            <button onClick={onDelete}
              className="p-2 rounded-2xl transition hover:opacity-80"
              style={{ background: "var(--color-paper-200)" }} title="削除">
              <Trash2 size={14} style={{ color: "var(--color-brand)" }} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- USP 選択コンポーネント ----
function UspPicker({
  usps,
  selected,
  onChange,
}: {
  usps: Usp[];
  selected: string[];
  onChange: (names: string[]) => void;
}) {
  function toggle(name: string) {
    if (selected.includes(name)) {
      onChange(selected.filter((n) => n !== name));
    } else {
      onChange([...selected, name]);
    }
  }

  if (usps.length === 0) {
    return (
      <p className="text-sm py-2" style={{ color: "var(--color-brand)" }}>
        ⚠️ USPが登録されていません。先にUSP管理画面でUSPを登録してください。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── 選択中エリア ── */}
      <div className="rounded-2xl p-3 min-h-[52px]"
        style={{ background: "var(--color-paper-200)", border: "1.5px solid var(--color-paper-300)" }}>
        <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-ink-500)" }}>
          ✅ 選択中の正解USP（{selected.length}個）
        </p>
        {selected.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
            下のリストからUSPをタップして選んでください
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((name) => {
              const usp = usps.find((u) => u.name === name);
              return (
                <span
                  key={name}
                  className="flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-semibold text-white"
                  style={{ background: "var(--color-brand)" }}
                >
                  <span>{usp?.emoji ?? "⭐"}</span>
                  <span>{name}</span>
                  {/* × で解除 */}
                  <button
                    type="button"
                    onClick={() => onChange(selected.filter((n) => n !== name))}
                    className="ml-0.5 w-4 h-4 rounded-full flex items-center justify-center hover:opacity-70 transition"
                    style={{ background: "rgba(255,255,255,0.25)" }}
                    title={`${name}を解除`}
                  >
                    <X size={9} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 全USPリスト ── */}
      <div>
        <p className="text-xs mb-1.5" style={{ color: "var(--color-ink-400)" }}>
          クリックで選択 / もう一度クリックで解除
        </p>
        <div className="flex flex-wrap gap-1.5">
          {usps.map((usp) => {
            const isSelected = selected.includes(usp.name);
            return (
              <button
                key={usp.id}
                type="button"
                onClick={() => toggle(usp.name)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition hover:opacity-80"
                style={{
                  background: isSelected ? "var(--color-brand)" : "var(--color-paper-50)",
                  color: isSelected ? "white" : "var(--color-ink-600)",
                  border: `1.5px solid ${isSelected ? "var(--color-brand)" : "var(--color-paper-300)"}`,
                  fontWeight: isSelected ? 700 : 500,
                }}
                title={usp.description ?? usp.name}
              >
                {isSelected && <Check size={11} strokeWidth={3} />}
                <span>{usp.emoji}</span>
                <span>{usp.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---- AI 生成モーダル ----
function AiGenerateModal({
  usps,
  onClose,
  onCreated,
}: {
  usps: Usp[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const { termQuest } = useSettings();
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<QuestDraft | null>(null);
  const [error, setError] = useState("");
  const [questId, setQuestId] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: () => api.post<{ data: QuestDraft }>("/admin/quests/ai-generate", { userPrompt: prompt || undefined }),
    onSuccess: (res) => { setDraft(res.data); setError(""); },
    onError: (e: Error) => setError(e.message),
  });

  const regenerate = useMutation({
    mutationFn: () => api.post<{ data: QuestDraft }>(`/admin/quests/${questId}/regenerate`, { userPrompt: prompt || undefined }),
    onSuccess: (res) => { setDraft(res.data); setError(""); },
    onError: (e: Error) => setError(e.message),
  });

  const save = useMutation({
    mutationFn: () =>
      api.post<{ data: { id: string } }>("/admin/quests", { ...draft, publishNow: false, source: "ai" }),
    onSuccess: (res) => {
      setQuestId(res.data.id);
      qc.invalidateQueries({ queryKey: ["admin", "quests"] });
    },
  });

  const publish = useMutation({
    mutationFn: () => api.post(`/admin/quests/${questId}/publish`),
    onSuccess: onCreated,
  });

  const isGenerating = generate.isPending || regenerate.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="card-paper w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-klee)" }}>
            ✨ AIで{termQuest}を生成
          </h2>
          <button onClick={onClose} className="p-2 rounded-full hover:opacity-70"><X size={20} /></button>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
            追加の指示（任意）
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例: IT・デジタル系の課題にしてください"
            rows={2}
            className="w-full px-3 py-2 rounded-2xl border text-sm resize-none"
            style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
          />
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-2xl text-sm text-white" style={{ background: "var(--color-brand)" }}>
            {error}
          </div>
        )}

        {!draft ? (
          <button
            onClick={() => generate.mutate()}
            disabled={isGenerating || usps.length === 0}
            className="w-full py-3 rounded-2xl font-semibold text-white transition hover:opacity-80 flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--color-accent)" }}
          >
            {isGenerating ? <><RefreshCw size={16} className="animate-spin" />生成中...</> : <><Sparkles size={16} />AI生成する</>}
          </button>
        ) : (
          <>
            <div className="mb-4 p-4 rounded-2xl" style={{ background: "var(--color-paper-200)" }}>
              <DraftPreview draft={draft} usps={usps} onChange={setDraft} questId={questId} />
            </div>

            <div className="flex flex-wrap gap-2">
              {!questId && (
                <button
                  onClick={() => save.mutate()} disabled={save.isPending}
                  className="flex-1 min-w-[120px] py-2.5 rounded-2xl text-sm font-medium transition hover:opacity-80"
                  style={{ background: "var(--color-paper-300)", color: "var(--color-ink-700)" }}>
                  下書き保存
                </button>
              )}
              <button
                onClick={() => questId ? regenerate.mutate() : generate.mutate()}
                disabled={isGenerating}
                className="flex-1 min-w-[120px] py-2.5 rounded-2xl text-sm font-medium transition hover:opacity-80 flex items-center justify-center gap-1"
                style={{ background: "var(--color-paper-300)", color: "var(--color-ink-700)" }}>
                {isGenerating ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                全体再生成
              </button>
              <button
                onClick={() => {
                  if (questId) {
                    publish.mutate();
                  } else {
                    save.mutateAsync().then(() => publish.mutate());
                  }
                }}
                disabled={save.isPending || publish.isPending}
                className="flex-1 min-w-[120px] py-2.5 rounded-2xl text-sm font-medium text-white transition hover:opacity-80 flex items-center justify-center gap-1"
                style={{ background: "var(--color-success)" }}>
                <Send size={14} />
                公開する
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- AI生成ドラフトプレビュー（編集可能） ----
function DraftPreview({
  draft,
  usps,
  onChange,
  questId,
}: {
  draft: QuestDraft;
  usps: Usp[];
  onChange: (d: QuestDraft) => void;
  questId: string | null;
}) {
  const [skillsLoading, setSkillsLoading] = useState(false);

  async function handleRegenerateSkills() {
    setSkillsLoading(true);
    try {
      let res: { data: { answerSkills: string[]; skillCount: number } };
      if (questId) {
        // 保存済み: questId 指定で再生成
        res = await api.post<{ data: { answerSkills: string[]; skillCount: number } }>(
          `/admin/quests/${questId}/regenerate-skills`
        );
      } else {
        // 未保存ドラフト: タイトル・ストーリーを送信して提案
        res = await api.post<{ data: { answerSkills: string[]; skillCount: number } }>(
          `/admin/quests/regenerate-skills-preview`,
          { title: draft.title, story: draft.story }
        );
      }
      onChange({ ...draft, answerSkills: res.data.answerSkills, skillCount: res.data.skillCount });
    } finally {
      setSkillsLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-2xl">{draft.emoji}</span>
        <input
          className="flex-1 font-semibold px-2 py-1 rounded-xl border text-sm"
          style={{ borderColor: "var(--color-paper-300)", fontFamily: "var(--font-klee)", background: "var(--color-paper-50)" }}
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
      </div>
      <textarea
        rows={3}
        className="w-full text-sm px-2 py-1 rounded-xl border resize-none"
        style={{ borderColor: "var(--color-paper-300)", color: "var(--color-ink-600)", background: "var(--color-paper-50)" }}
        value={draft.story}
        onChange={(e) => onChange({ ...draft, story: e.target.value })}
      />
      <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
        💡 USP名を <code className="px-1 rounded" style={{ background: "var(--color-paper-300)" }}>[[USP名]]</code> のように囲むと強調表示されます
      </p>
      <div className="text-sm px-2 py-1.5 rounded-xl" style={{ background: "var(--color-paper-50)", color: "var(--color-ink-600)" }}>
        <QuestStory text={draft.story} />
      </div>
      <div className="flex gap-4 text-sm flex-wrap">
        <label className="flex items-center gap-1" style={{ color: "var(--color-ink-600)" }}>
          難易度
          <select value={draft.level}
            onChange={(e) => onChange({ ...draft, level: e.target.value as "normal" | "hard" })}
            className="ml-1 px-2 py-0.5 rounded-lg border text-xs"
            style={{ borderColor: "var(--color-paper-300)" }}>
            <option value="normal">ノーマル</option>
            <option value="hard">ハード</option>
          </select>
        </label>
        <label className="flex items-center gap-1" style={{ color: "var(--color-ink-600)" }}>
          報酬
          <input type="number" value={draft.reward}
            onChange={(e) => onChange({ ...draft, reward: Number(e.target.value) })}
            className="ml-1 w-14 px-2 py-0.5 rounded-lg border text-xs"
            style={{ borderColor: "var(--color-paper-300)" }} />
          pt
        </label>
      </div>

      {/* 正解 USP セクション */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium" style={{ color: "var(--color-ink-600)" }}>
            正解USP（クリックで選択/解除）
          </span>
          <button
            type="button"
            onClick={handleRegenerateSkills}
            disabled={skillsLoading || !draft.title || !draft.story}
            className="flex items-center gap-1 px-2 py-1 rounded-xl text-xs transition hover:opacity-80 disabled:opacity-40"
            style={{ background: "var(--color-paper-300)", color: "var(--color-ink-600)" }}
            title={!draft.title || !draft.story ? "タイトルとストーリーを入力してから使えます" : ""}
          >
            {skillsLoading
              ? <RefreshCw size={11} className="animate-spin" />
              : <Wand2 size={11} />}
            AIで選び直す
          </button>
        </div>
        <UspPicker
          usps={usps}
          selected={draft.answerSkills}
          onChange={(names) => onChange({ ...draft, answerSkills: names, skillCount: names.length })}
        />
        {draft.answerSkills.length > 0 && (
          <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
            選択中: {draft.answerSkills.length}個
          </p>
        )}
      </div>
    </div>
  );
}

// ---- 手動作成 / 編集フォームモーダル ----
function QuestFormModal({
  title,
  initial,
  questId,
  usps,
  onClose,
  onSaved,
}: {
  title: string;
  initial?: Partial<AdminQuest>;
  questId?: string;
  usps: Usp[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { termQuest } = useSettings();
  const [form, setForm] = useState({
    title:       initial?.title    ?? "",
    story:       initial?.story    ?? "",
    emoji:       initial?.emoji    ?? "📋",
    level:       (initial?.level   ?? "normal") as "normal" | "hard",
    answerSkills: initial?.answerSkills ?? [] as string[],
    reward:      initial?.reward   ?? 5,
    publishNow:  false,
  });
  const [error, setError] = useState("");

  const regenerateSkills = useMutation({
    mutationFn: () => {
      if (questId) {
        return api.post<{ data: { answerSkills: string[]; skillCount: number } }>(
          `/admin/quests/${questId}/regenerate-skills`
        );
      } else {
        return api.post<{ data: { answerSkills: string[]; skillCount: number } }>(
          `/admin/quests/regenerate-skills-preview`,
          { title: form.title, story: form.story }
        );
      }
    },
    onSuccess: (res) => setForm((prev) => ({ ...prev, answerSkills: res.data.answerSkills })),
    onError: (e: Error) => setError(e.message),
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: form.title,
        story: form.story,
        emoji: form.emoji,
        level: form.level,
        skillCount: form.answerSkills.length,
        answerSkills: form.answerSkills,
        reward: form.reward,
        publishNow: form.publishNow,
      };
      return questId ? api.patch(`/admin/quests/${questId}`, body) : api.post("/admin/quests", body);
    },
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="card-paper w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-klee)" }}>{title}</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:opacity-70"><X size={20} /></button>
        </div>

        {error && (
          <div className="mb-3 p-3 rounded-2xl text-sm text-white" style={{ background: "var(--color-brand)" }}>
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div className="flex gap-2">
            <div className="w-16">
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>絵文字</label>
              <input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })}
                className="w-full text-center text-2xl px-1 py-1 rounded-xl border"
                style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }} maxLength={2} />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>タイトル *</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
                placeholder={`${termQuest}のタイトル`} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>ストーリー *</label>
            <textarea value={form.story} onChange={(e) => setForm({ ...form, story: e.target.value })}
              rows={4} className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
              style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
              placeholder="依頼人の困りごとを2〜3文で" />
            <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
              💡 USP名を <code className="px-1 rounded" style={{ background: "var(--color-paper-200)" }}>[[USP名]]</code> のように二重角括弧で囲むと、その部分が強調表示されます（例: 「[[リスク判断力]]を活かして…」）
            </p>
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>難易度</label>
              <select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value as "normal" | "hard" })}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}>
                <option value="normal">⚔️ ノーマル</option>
                <option value="hard">🔥 ハード</option>
              </select>
            </div>
            <div className="w-20">
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>報酬 (pt)</label>
              <input type="number" min={1} value={form.reward}
                onChange={(e) => setForm({ ...form, reward: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }} />
            </div>
          </div>

          {/* 正解 USP 選択 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--color-ink-600)" }}>
                正解USP（クリックで選択）*
              </label>
              <button
                type="button"
                onClick={() => regenerateSkills.mutate()}
                disabled={regenerateSkills.isPending || !form.title || !form.story}
                className="flex items-center gap-1 px-2 py-1 rounded-xl text-xs transition hover:opacity-80 disabled:opacity-40"
                style={{ background: "var(--color-paper-300)", color: "var(--color-ink-600)" }}
                title={!form.title || !form.story ? "タイトルとストーリーを入力してから使えます" : ""}
              >
                {regenerateSkills.isPending
                  ? <RefreshCw size={11} className="animate-spin" />
                  : <Wand2 size={11} />}
                AIで選び直す
              </button>
            </div>
            <UspPicker
              usps={usps}
              selected={form.answerSkills}
              onChange={(names) => setForm({ ...form, answerSkills: names })}
            />
            {form.answerSkills.length > 0 && (
              <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-400)" }}>
                選択中: {form.answerSkills.length}個
              </p>
            )}
          </div>

          {!questId && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.publishNow}
                onChange={(e) => setForm({ ...form, publishNow: e.target.checked })}
                className="w-4 h-4 rounded" />
              <span style={{ color: "var(--color-ink-600)" }}>すぐに公開する</span>
            </label>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 py-3 rounded-2xl text-sm font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            キャンセル
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || !form.title || !form.story || form.answerSkills.length === 0}
            className="flex-1 py-3 rounded-2xl text-sm font-medium text-white transition hover:opacity-80 disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}>
            {save.isPending ? "保存中..." : "保存する"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- 確認モーダル ----
function ConfirmModal({ message, onCancel, onConfirm, loading }: {
  message: string; onCancel: () => void; onConfirm: () => void; loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }} onClick={onCancel}>
      <div className="card-paper p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <p className="font-medium mb-4" style={{ color: "var(--color-ink-700)" }}>{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel}
            className="flex-1 py-2 rounded-2xl text-sm"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            キャンセル
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 py-2 rounded-2xl text-sm text-white"
            style={{ background: "var(--color-brand)" }}>
            削除する
          </button>
        </div>
      </div>
    </div>
  );
}
