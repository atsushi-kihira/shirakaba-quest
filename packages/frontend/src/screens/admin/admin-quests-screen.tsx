// =============================================================
// 管理画面 — お題管理（作成 / AI生成 / 編集 / 削除 / 公開）
// =============================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Sparkles, Pencil, Trash2, Send, RefreshCw, X } from "lucide-react";
import { api } from "@/lib/api";

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
  draft:     { label: "下書き",  color: "var(--color-ink-500)" },
  published: { label: "公開中",  color: "var(--color-success)" },
  deleted:   { label: "削除済み", color: "var(--color-ink-300)" },
};

export function AdminQuestsScreen() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editQuest, setEditQuest] = useState<AdminQuest | null>(null);
  const [aiModal, setAiModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

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

  const quests = (data?.data ?? []).filter((q) => q.status !== "deleted");
  const published = quests.filter((q) => q.status === "published");
  const drafts    = quests.filter((q) => q.status === "draft");

  return (
    <div className="px-4 py-6 lg:px-0">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          📜 お題管理
        </h1>
        <div className="flex gap-2">
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
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>読み込み中...</div>
      ) : (
        <>
          {/* 公開中 */}
          {published.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold mb-2 px-1" style={{ color: "var(--color-success)" }}>
                公開中 ({published.length})
              </h2>
              <div className="flex flex-col gap-3">
                {published.map((q) => (
                  <QuestRow key={q.id} quest={q}
                    onEdit={() => setEditQuest(q)}
                    onDelete={() => setDeleteConfirm(q.id)}
                    onPublish={() => publishMutation.mutate(q.id)}
                    publishing={publishMutation.isPending}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 下書き */}
          {drafts.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold mb-2 px-1" style={{ color: "var(--color-ink-500)" }}>
                下書き ({drafts.length})
              </h2>
              <div className="flex flex-col gap-3">
                {drafts.map((q) => (
                  <QuestRow key={q.id} quest={q}
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
              <p>お題がまだありません</p>
              <p className="text-sm mt-1">「AI生成」か「手動作成」でお題を作成しましょう</p>
            </div>
          )}
        </>
      )}

      {/* AI 生成モーダル */}
      {aiModal && (
        <AiGenerateModal
          onClose={() => setAiModal(false)}
          onCreated={() => {
            setAiModal(false);
            qc.invalidateQueries({ queryKey: ["admin", "quests"] });
          }}
        />
      )}

      {/* 手動作成モーダル */}
      {showCreate && (
        <QuestFormModal
          title="お題を手動作成"
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ["admin", "quests"] });
          }}
        />
      )}

      {/* 編集モーダル */}
      {editQuest && (
        <QuestFormModal
          title="お題を編集"
          initial={editQuest}
          questId={editQuest.id}
          onClose={() => setEditQuest(null)}
          onSaved={() => {
            setEditQuest(null);
            qc.invalidateQueries({ queryKey: ["admin", "quests"] });
          }}
        />
      )}

      {/* 削除確認 */}
      {deleteConfirm && (
        <ConfirmModal
          message="このお題を削除しますか？"
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={() => deleteMutation.mutate(deleteConfirm)}
          loading={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

// ---- QuestRow ----
function QuestRow({
  quest,
  onEdit,
  onDelete,
  onPublish,
  publishing,
}: {
  quest: AdminQuest;
  onEdit: () => void;
  onDelete: () => void;
  onPublish: () => void;
  publishing: boolean;
}) {
  const st = STATUS_STYLE[quest.status];
  return (
    <div className="card-paper p-4">
      <div className="flex items-start gap-3">
        <span className="text-2xl">{quest.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold" style={{ color: "var(--color-ink-800)" }}>{quest.title}</span>
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: "var(--color-paper-200)", color: st.color, fontWeight: 600 }}>
              {st.label}
            </span>
            {quest.source === "ai" && (
              <span className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: "var(--color-paper-200)", color: "var(--color-accent)" }}>
                ✨ AI
              </span>
            )}
          </div>
          <p className="text-xs mt-1 line-clamp-2" style={{ color: "var(--color-ink-500)" }}>{quest.story}</p>
          <div className="flex gap-3 mt-1.5 text-xs" style={{ color: "var(--color-ink-400)" }}>
            <span>スキル {quest.skillCount}個</span>
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
        <div className="flex gap-1.5 shrink-0">
          {quest.status === "draft" && (
            <button
              onClick={onPublish}
              disabled={publishing}
              className="flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs font-medium text-white transition hover:opacity-80"
              style={{ background: "var(--color-success)" }}
              title="公開"
            >
              <Send size={12} />
              公開
            </button>
          )}
          <button
            onClick={onEdit}
            className="p-2 rounded-2xl transition hover:opacity-80"
            style={{ background: "var(--color-paper-200)" }}
            title="編集"
          >
            <Pencil size={14} style={{ color: "var(--color-ink-500)" }} />
          </button>
          <button
            onClick={onDelete}
            className="p-2 rounded-2xl transition hover:opacity-80"
            style={{ background: "var(--color-paper-200)" }}
            title="削除"
          >
            <Trash2 size={14} style={{ color: "var(--color-brand)" }} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- AI 生成モーダル ----
function AiGenerateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const qc = useQueryClient();
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
      api.post<{ data: { id: string } }>("/admin/quests", {
        ...draft,
        publishNow: false,
        source: "ai",
      }),
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
            ✨ AIでお題を生成
          </h2>
          <button onClick={onClose} className="p-2 rounded-full hover:opacity-70">
            <X size={20} />
          </button>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
            追加の指示（任意）
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例: IT・デジタル系の課題にしてください"
            rows={3}
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
            disabled={isGenerating}
            className="w-full py-3 rounded-2xl font-semibold text-white transition hover:opacity-80 flex items-center justify-center gap-2"
            style={{ background: "var(--color-accent)" }}
          >
            {isGenerating ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Sparkles size={16} />
                AI生成する
              </>
            )}
          </button>
        ) : (
          <>
            {/* 生成結果プレビュー */}
            <div className="card-paper p-4 mb-4">
              <DraftPreview draft={draft} onChange={setDraft} />
            </div>

            <div className="flex gap-2">
              {!questId && (
                <button
                  onClick={() => save.mutate()}
                  disabled={save.isPending}
                  className="flex-1 py-2.5 rounded-2xl text-sm font-medium transition hover:opacity-80"
                  style={{ background: "var(--color-paper-300)", color: "var(--color-ink-700)" }}
                >
                  下書きに保存
                </button>
              )}

              <button
                onClick={() => questId ? regenerate.mutate() : generate.mutate()}
                disabled={isGenerating}
                className="flex-1 py-2.5 rounded-2xl text-sm font-medium transition hover:opacity-80 flex items-center justify-center gap-1"
                style={{ background: "var(--color-paper-300)", color: "var(--color-ink-700)" }}
              >
                {isGenerating ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                再生成
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
                className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white transition hover:opacity-80 flex items-center justify-center gap-1"
                style={{ background: "var(--color-success)" }}
              >
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

// ---- ドラフトプレビュー（編集可能） ----
function DraftPreview({ draft, onChange }: { draft: QuestDraft; onChange: (d: QuestDraft) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-2xl">{draft.emoji}</span>
        <input
          className="flex-1 font-semibold px-2 py-1 rounded-xl border text-sm"
          style={{ borderColor: "var(--color-paper-300)", fontFamily: "var(--font-klee)" }}
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
      </div>
      <textarea
        rows={3}
        className="w-full text-sm px-2 py-1 rounded-xl border resize-none"
        style={{ borderColor: "var(--color-paper-300)", color: "var(--color-ink-600)" }}
        value={draft.story}
        onChange={(e) => onChange({ ...draft, story: e.target.value })}
      />
      <div className="flex gap-4 text-sm flex-wrap">
        <label className="flex items-center gap-1" style={{ color: "var(--color-ink-600)" }}>
          難易度
          <select
            value={draft.level}
            onChange={(e) => onChange({ ...draft, level: e.target.value as "normal" | "hard" })}
            className="ml-1 px-2 py-0.5 rounded-lg border text-xs"
            style={{ borderColor: "var(--color-paper-300)" }}
          >
            <option value="normal">ノーマル</option>
            <option value="hard">ハード</option>
          </select>
        </label>
        <label className="flex items-center gap-1" style={{ color: "var(--color-ink-600)" }}>
          報酬
          <input
            type="number"
            value={draft.reward}
            onChange={(e) => onChange({ ...draft, reward: Number(e.target.value) })}
            className="ml-1 w-14 px-2 py-0.5 rounded-lg border text-xs"
            style={{ borderColor: "var(--color-paper-300)" }}
          />
          pt
        </label>
      </div>
      <div>
        <div className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>正解スキル</div>
        <div className="flex flex-wrap gap-1">
          {draft.answerSkills.map((s, i) => (
            <div key={i} className="flex items-center gap-1 px-2 py-1 rounded-full text-xs"
              style={{ background: "var(--color-paper-300)", color: "var(--color-ink-700)" }}>
              {s}
              <button onClick={() => onChange({
                ...draft,
                answerSkills: draft.answerSkills.filter((_, idx) => idx !== i),
                skillCount: Math.max(1, draft.skillCount - 1),
              })}>
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- 手動作成 / 編集フォームモーダル ----
function QuestFormModal({
  title,
  initial,
  questId,
  onClose,
  onSaved,
}: {
  title: string;
  initial?: Partial<AdminQuest>;
  questId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    story: initial?.story ?? "",
    emoji: initial?.emoji ?? "📋",
    level: initial?.level ?? "normal" as "normal" | "hard",
    skillCount: initial?.skillCount ?? 3,
    answerSkills: (initial?.answerSkills ?? []).join("、"),
    reward: initial?.reward ?? 5,
    publishNow: false,
  });
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: form.title,
        story: form.story,
        emoji: form.emoji,
        level: form.level,
        skillCount: form.skillCount,
        answerSkills: form.answerSkills.split(/[,、，\s]+/).map((s) => s.trim()).filter(Boolean),
        reward: form.reward,
        publishNow: form.publishNow,
      };
      if (questId) {
        return api.patch(`/admin/quests/${questId}`, body);
      } else {
        return api.post("/admin/quests", body);
      }
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
                style={{ borderColor: "var(--color-paper-300)" }} maxLength={2} />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>タイトル *</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)" }} placeholder="お題のタイトル" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>ストーリー *</label>
            <textarea value={form.story} onChange={(e) => setForm({ ...form, story: e.target.value })}
              rows={4} className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
              style={{ borderColor: "var(--color-paper-300)" }} placeholder="依頼人の困りごとを2〜3文で" />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>難易度</label>
              <select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value as "normal" | "hard" })}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)" }}>
                <option value="normal">⚔️ ノーマル</option>
                <option value="hard">🔥 ハード</option>
              </select>
            </div>
            <div className="w-20">
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>必要スキル数</label>
              <input type="number" min={1} max={8} value={form.skillCount}
                onChange={(e) => setForm({ ...form, skillCount: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)" }} />
            </div>
            <div className="w-20">
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>報酬 (pt)</label>
              <input type="number" min={1} value={form.reward}
                onChange={(e) => setForm({ ...form, reward: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)" }} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
              正解スキル（読点「、」か改行区切り）*
            </label>
            <textarea value={form.answerSkills} onChange={(e) => setForm({ ...form, answerSkills: e.target.value })}
              rows={3} className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
              style={{ borderColor: "var(--color-paper-300)" }} placeholder="リスク判断力、ビジュアル構成力、DX設計力" />
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
          <button onClick={() => save.mutate()} disabled={save.isPending || !form.title || !form.story}
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
