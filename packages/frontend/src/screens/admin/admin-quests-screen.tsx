// =============================================================
// 管理画面 — お題管理
// 手動作成 / AI生成 / CSV一括インポート / CSV一括エクスポート
// USP は順番付きスロット（①〜③ or ①〜⑤）で選択
// =============================================================
import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Sparkles, Pencil, Trash2, Send, RefreshCw,
  X, Wand2, CheckSquare, Square, Upload, Download, Layers, Minus,
} from "lucide-react";
import { api, API_BASE_URL } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";
import { QuestStory } from "@/lib/quest-story";
import type { Usp } from "@shared/types";

// -------------------------------------------------------
// 型定義
// -------------------------------------------------------
type AdminQuest = {
  id: string;
  title: string;
  story: string;
  mission: string;
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
  mission: string;
  emoji: string;
  level: "normal" | "hard";
  answerSkills: string[]; // ordered, length = skillCount
  reward: number;
};

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  draft:     { label: "下書き",   color: "var(--color-ink-500)" },
  published: { label: "公開中",   color: "var(--color-success)" },
  deleted:   { label: "削除済み", color: "var(--color-ink-300)" },
};

const SLOT_NUMS = ["①", "②", "③", "④", "⑤"];

function skillCountForLevel(level: "normal" | "hard") {
  return level === "hard" ? 5 : 3;
}

function useUsps() {
  return useQuery({
    queryKey: ["admin", "usps"],
    queryFn: () => api.get<{ data: Usp[] }>("/admin/usps"),
    staleTime: 60_000,
  });
}

// -------------------------------------------------------
// CSV ユーティリティ（フロントエンド）
// -------------------------------------------------------
type CsvRow = Record<string, string>;

function parseCSV(text: string): CsvRow[] {
  const lines: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i <= src.length; i++) {
    const c = i < src.length ? src[i] : "\n";
    if (inQ) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else { field += c; }
    } else {
      if (c === '"') { inQ = true; }
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") {
        row.push(field); field = "";
        if (row.some((f) => f.trim() !== "")) lines.push(row);
        row = [];
      } else { field += c; }
    }
  }
  if (lines.length < 2) return [];
  const headers = lines[0].map((h) => h.trim());
  return lines.slice(1).map((cols) => {
    const obj: CsvRow = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] ?? "").trim(); });
    return obj;
  });
}

function csvToImportPayload(rows: CsvRow[]) {
  return rows.map((r) => ({
    emoji:       r.emoji || "📋",
    title:       r.title || "",
    story:       r.story || "",
    mission:     r.mission || "",
    level:       (r.level === "hard" ? "hard" : "normal") as "normal" | "hard",
    answerSkills: [r.usp1, r.usp2, r.usp3, r.usp4, r.usp5].filter(Boolean),
    reward:      Number(r.reward) || 5,
  }));
}

// -------------------------------------------------------
// メイン画面
// -------------------------------------------------------
export function AdminQuestsScreen() {
  const qc = useQueryClient();
  const { termQuest } = useSettings();
  const [showCreate, setShowCreate] = useState(false);
  const [editQuest, setEditQuest] = useState<AdminQuest | null>(null);
  const [aiModal, setAiModal] = useState(false);
  const [bulkAiModal, setBulkAiModal] = useState(false);
  const [importModal, setImportModal] = useState(false);
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

  async function handleExport() {
    const token = localStorage.getItem("auth_token");
    const res = await fetch(`${API_BASE_URL}/admin/quests/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quests_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
              <button onClick={() => setSelectedIds(new Set())}
                className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-medium"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                <X size={14} />選択解除
              </button>
              <button onClick={() => setBulkDeleteConfirm(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium text-white"
                style={{ background: "var(--color-brand)" }}>
                <Trash2 size={14} />{selectedIds.size}件を削除
              </button>
            </>
          ) : (
            <>
              {quests.length > 0 && (
                <button onClick={() => setSelectedIds(new Set(quests.map((q) => q.id)))}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-medium"
                  style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                  <CheckSquare size={14} />まとめて選択
                </button>
              )}
              <button onClick={handleExport}
                className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-medium"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                <Download size={14} />CSVエクスポート
              </button>
              <button onClick={() => setImportModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-medium"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                <Upload size={14} />CSVインポート
              </button>
              <button onClick={() => setBulkAiModal(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium text-white"
                style={{ background: "var(--color-accent)" }}>
                <Layers size={15} />AI一括生成
              </button>
              <button onClick={() => setAiModal(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                <Sparkles size={15} />AI生成
              </button>
              <button onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium text-white"
                style={{ background: "var(--color-brand)" }}>
                <Plus size={15} />手動作成
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
                  <QuestRow key={q.id} quest={q} usps={usps}
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
                  <QuestRow key={q.id} quest={q} usps={usps}
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
              <p className="text-sm mt-1">「AI生成」「手動作成」「CSVインポート」で作成できます</p>
            </div>
          )}
        </>
      )}

      {bulkAiModal && (
        <BulkAiGenerateModal
          onClose={() => setBulkAiModal(false)}
          onCreated={() => {
            setBulkAiModal(false);
            qc.invalidateQueries({ queryKey: ["admin", "quests"] });
          }}
        />
      )}

      {aiModal && (
        <AiGenerateModal usps={usps}
          onClose={() => setAiModal(false)}
          onCreated={() => {
            setAiModal(false);
            qc.invalidateQueries({ queryKey: ["admin", "quests"] });
          }}
        />
      )}

      {showCreate && (
        <QuestFormModal title={`${termQuest}を手動作成`} usps={usps}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ["admin", "quests"] });
          }}
        />
      )}

      {editQuest && (
        <QuestFormModal title={`${termQuest}を編集`} usps={usps} initial={editQuest} questId={editQuest.id}
          onClose={() => setEditQuest(null)}
          onSaved={() => {
            setEditQuest(null);
            qc.invalidateQueries({ queryKey: ["admin", "quests"] });
          }}
        />
      )}

      {importModal && (
        <ImportModal usps={usps}
          onClose={() => setImportModal(false)}
          onImported={() => {
            setImportModal(false);
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

// -------------------------------------------------------
// QuestRow
// -------------------------------------------------------
function QuestRow({
  quest, usps, selected, selectMode, onToggleSelect, onEdit, onDelete, onPublish, publishing,
}: {
  quest: AdminQuest;
  usps: Usp[];
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
    <div className="card-paper p-4 transition"
      style={{ outline: selected ? "2px solid var(--color-brand)" : "none", outlineOffset: "-2px" }}>
      <div className="flex items-start gap-3">
        <button type="button" onClick={onToggleSelect} className="shrink-0 mt-0.5 transition hover:opacity-80">
          {selected
            ? <CheckSquare size={20} style={{ color: "var(--color-brand)" }} />
            : <Square size={20} style={{ color: selectMode ? "var(--color-ink-400)" : "var(--color-paper-300)" }} />}
        </button>
        <span className="text-2xl">{quest.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold" style={{ color: "var(--color-ink-800)" }}>{quest.title}</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ background: "var(--color-paper-200)", color: st.color }}>{st.label}</span>
            {quest.source === "ai" && (
              <span className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: "var(--color-paper-200)", color: "var(--color-accent)" }}>✨ AI</span>
            )}
          </div>
          <p className="text-xs mt-1 line-clamp-2" style={{ color: "var(--color-ink-500)" }}>
            {quest.story.replace(/\[\[([^[\]]+)\]\]/g, "$1")}
          </p>
          {quest.mission && (
            <p className="text-xs mt-0.5 line-clamp-1" style={{ color: "var(--color-ink-400)" }}>
              🎯 {quest.mission}
            </p>
          )}
          <div className="flex gap-3 mt-1.5 text-xs" style={{ color: "var(--color-ink-400)" }}>
            <span>{quest.level === "hard" ? "🔥 ハード（USP×5）" : "⚔️ ノーマル（USP×3）"}</span>
            <span>報酬 {quest.reward}pt</span>
          </div>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {quest.answerSkills.map((name, i) => {
              const usp = usps.find((u) => u.name === name);
              return (
                <span key={name} className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: "var(--color-paper-300)", color: "var(--color-ink-600)" }}>
                  {SLOT_NUMS[i]}{usp?.emoji ?? ""} {name}
                </span>
              );
            })}
          </div>
        </div>
        {!selectMode && (
          <div className="flex gap-1.5 shrink-0">
            {quest.status === "draft" && (
              <button onClick={onPublish} disabled={publishing}
                className="flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs font-medium text-white"
                style={{ background: "var(--color-success)" }}>
                <Send size={12} />公開
              </button>
            )}
            <button onClick={onEdit} className="p-2 rounded-2xl" style={{ background: "var(--color-paper-200)" }}>
              <Pencil size={14} style={{ color: "var(--color-ink-500)" }} />
            </button>
            <button onClick={onDelete} className="p-2 rounded-2xl" style={{ background: "var(--color-paper-200)" }}>
              <Trash2 size={14} style={{ color: "var(--color-brand)" }} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------
// USP 順番付きスロット選択
// -------------------------------------------------------
function UspSlotSelector({
  usps,
  selected,    // length <= maxCount
  maxCount,    // 3 or 5
  onChange,
}: {
  usps: Usp[];
  selected: string[];
  maxCount: number;
  onChange: (val: string[]) => void;
}) {
  if (usps.length === 0) {
    return (
      <p className="text-sm py-2" style={{ color: "var(--color-brand)" }}>
        ⚠️ USPが登録されていません。先にUSP管理画面でUSPを登録してください。
      </p>
    );
  }

  const slots = Array.from({ length: maxCount }, (_, i) => selected[i] ?? "");

  function setSlot(idx: number, name: string) {
    const next = [...slots];
    next[idx] = name;
    onChange(next.filter(Boolean));
  }

  return (
    <div className="space-y-2.5">
      {slots.map((name, i) => {
        const usp = usps.find((u) => u.name === name);
        const takenByOthers = new Set(slots.filter((s, j) => j !== i && s));
        const available = usps.filter((u) => !takenByOthers.has(u.name));
        return (
          <div key={i}>
            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--color-ink-600)" }}>
              USP{SLOT_NUMS[i]} *
            </label>
            <select
              value={name}
              onChange={(e) => setSlot(i, e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{
                borderColor: name ? "var(--color-brand)" : "var(--color-paper-300)",
                background: "var(--color-paper-50)",
              }}
            >
              <option value="">— 選択してください —</option>
              {available.map((u) => (
                <option key={u.id} value={u.name}>{u.emoji} {u.name}</option>
              ))}
            </select>
            {usp?.description && (
              <p className="text-xs mt-1 px-1 leading-relaxed" style={{ color: "var(--color-ink-500)" }}>
                {usp.description}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// -------------------------------------------------------
// 手動作成 / 編集フォームモーダル
// -------------------------------------------------------
function QuestFormModal({
  title, initial, questId, usps, onClose, onSaved,
}: {
  title: string;
  initial?: Partial<AdminQuest>;
  questId?: string;
  usps: Usp[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { termQuest } = useSettings();
  const [level, setLevel] = useState<"normal" | "hard">((initial?.level ?? "normal") as "normal" | "hard");
  const [form, setForm] = useState({
    title:        initial?.title   ?? "",
    story:        initial?.story   ?? "",
    mission:      initial?.mission ?? "",
    emoji:        initial?.emoji   ?? "📋",
    answerSkills: initial?.answerSkills ?? [] as string[],
    reward:       initial?.reward  ?? 5,
    publishNow:   false,
  });
  const [error, setError] = useState("");

  const maxCount = skillCountForLevel(level);

  function handleLevelChange(newLevel: "normal" | "hard") {
    setLevel(newLevel);
    // ハード→ノーマルに変えたとき余剰スロットをクリア
    const newMax = skillCountForLevel(newLevel);
    if (form.answerSkills.length > newMax) {
      setForm((f) => ({ ...f, answerSkills: f.answerSkills.slice(0, newMax) }));
    }
  }

  const regenerateSkills = useMutation({
    mutationFn: () => {
      if (questId) {
        return api.post<{ data: { answerSkills: string[]; skillCount: number } }>(
          `/admin/quests/${questId}/regenerate-skills`
        );
      }
      return api.post<{ data: { answerSkills: string[]; skillCount: number } }>(
        `/admin/quests/regenerate-skills-preview`,
        { title: form.title, story: form.story, targetCount: maxCount }
      );
    },
    onSuccess: (res) => setForm((f) => ({ ...f, answerSkills: res.data.answerSkills })),
    onError: (e: Error) => setError(e.message),
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: form.title, story: form.story, mission: form.mission,
        emoji: form.emoji, level,
        answerSkills: form.answerSkills.slice(0, maxCount),
        reward: form.reward, publishNow: form.publishNow,
      };
      return questId ? api.patch(`/admin/quests/${questId}`, body) : api.post("/admin/quests", body);
    },
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });

  const isValid = form.title && form.story && form.answerSkills.length === maxCount;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="card-paper w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-klee)" }}>{title}</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:opacity-70"><X size={20} /></button>
        </div>

        {error && (
          <div className="mb-3 p-3 rounded-2xl text-sm text-white" style={{ background: "var(--color-brand)" }}>{error}</div>
        )}

        <div className="space-y-4">
          {/* 絵文字 + タイトル */}
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
                placeholder={`${termQuest}のタイトル`}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }} />
            </div>
          </div>

          {/* ストーリー */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
              ストーリー（困りごと・課題）*
            </label>
            <textarea value={form.story} onChange={(e) => setForm({ ...form, story: e.target.value })}
              rows={3} className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
              style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
              placeholder="依頼人の困りごとを2〜3文で" />
            <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
              💡 USP名を <code className="px-1 rounded" style={{ background: "var(--color-paper-200)" }}>[[USP名]]</code> で囲むと強調表示されます
            </p>
          </div>

          {/* ミッション */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
              ミッション（対策・解決方針）
            </label>
            <textarea value={form.mission} onChange={(e) => setForm({ ...form, mission: e.target.value })}
              rows={2} className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
              style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
              placeholder="どのように解決するかの方針を1〜2文で" />
          </div>

          {/* 難易度 + 報酬 */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>難易度</label>
              <select value={level} onChange={(e) => handleLevelChange(e.target.value as "normal" | "hard")}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}>
                <option value="normal">⚔️ ノーマル（USP×3）</option>
                <option value="hard">🔥 ハード（USP×5）</option>
              </select>
            </div>
            <div className="w-24">
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>報酬 (pt)</label>
              <input type="number" min={1} value={form.reward}
                onChange={(e) => setForm({ ...form, reward: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }} />
            </div>
          </div>

          {/* USP スロット */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold" style={{ color: "var(--color-ink-600)" }}>
                必要とするUSP（{maxCount}個すべて選択）*
              </label>
              <button type="button"
                onClick={() => regenerateSkills.mutate()}
                disabled={regenerateSkills.isPending || !form.title || !form.story}
                className="flex items-center gap-1 px-2 py-1 rounded-xl text-xs transition hover:opacity-80 disabled:opacity-40"
                style={{ background: "var(--color-paper-300)", color: "var(--color-ink-600)" }}>
                {regenerateSkills.isPending ? <RefreshCw size={11} className="animate-spin" /> : <Wand2 size={11} />}
                AIで選び直す
              </button>
            </div>
            <UspSlotSelector
              usps={usps}
              selected={form.answerSkills}
              maxCount={maxCount}
              onChange={(val) => setForm((f) => ({ ...f, answerSkills: val }))}
            />
            <p className="text-xs mt-1.5" style={{ color: form.answerSkills.length === maxCount ? "var(--color-success)" : "var(--color-ink-400)" }}>
              {form.answerSkills.length}/{maxCount} 選択済み
            </p>
          </div>

          {!questId && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.publishNow}
                onChange={(e) => setForm({ ...form, publishNow: e.target.checked })} className="w-4 h-4 rounded" />
              <span style={{ color: "var(--color-ink-600)" }}>すぐに公開する</span>
            </label>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-3 rounded-2xl text-sm font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            キャンセル
          </button>
          <button onClick={() => save.mutate()} disabled={!isValid || save.isPending}
            className="flex-1 py-3 rounded-2xl text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}>
            {save.isPending ? "保存中..." : "保存する"}
          </button>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------
// AI 生成モーダル
// -------------------------------------------------------
function AiGenerateModal({ usps, onClose, onCreated }: { usps: Usp[]; onClose: () => void; onCreated: () => void }) {
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
    mutationFn: () => api.post<{ data: { id: string } }>("/admin/quests", { ...draft, publishNow: false }),
    onSuccess: (res) => { setQuestId(res.data.id); qc.invalidateQueries({ queryKey: ["admin", "quests"] }); },
  });

  const publish = useMutation({
    mutationFn: () => api.post(`/admin/quests/${questId}/publish`),
    onSuccess: onCreated,
  });

  const isGenerating = generate.isPending || regenerate.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="card-paper w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-klee)" }}>✨ AIで{termQuest}を生成</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:opacity-70"><X size={20} /></button>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>追加の指示（任意）</label>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder="例: IT・デジタル系の課題にしてください"
            rows={2} className="w-full px-3 py-2 rounded-2xl border text-sm resize-none"
            style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }} />
        </div>

        {error && <div className="mb-4 p-3 rounded-2xl text-sm text-white" style={{ background: "var(--color-brand)" }}>{error}</div>}

        {!draft ? (
          <button onClick={() => generate.mutate()} disabled={isGenerating || usps.length === 0}
            className="w-full py-3 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--color-accent)" }}>
            {isGenerating ? <><RefreshCw size={16} className="animate-spin" />生成中...</> : <><Sparkles size={16} />AI生成する</>}
          </button>
        ) : (
          <>
            <div className="mb-4 p-4 rounded-2xl" style={{ background: "var(--color-paper-200)" }}>
              <DraftPreview draft={draft} usps={usps} onChange={setDraft} questId={questId} />
            </div>
            <div className="flex flex-wrap gap-2">
              {!questId && (
                <button onClick={() => save.mutate()} disabled={save.isPending}
                  className="flex-1 min-w-[120px] py-2.5 rounded-2xl text-sm font-medium"
                  style={{ background: "var(--color-paper-300)", color: "var(--color-ink-700)" }}>
                  下書き保存
                </button>
              )}
              <button onClick={() => questId ? regenerate.mutate() : generate.mutate()} disabled={isGenerating}
                className="flex-1 min-w-[120px] py-2.5 rounded-2xl text-sm font-medium flex items-center justify-center gap-1"
                style={{ background: "var(--color-paper-300)", color: "var(--color-ink-700)" }}>
                {isGenerating ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                全体再生成
              </button>
              <button
                onClick={() => {
                  if (questId) { publish.mutate(); }
                  else { save.mutateAsync().then(() => publish.mutate()); }
                }}
                disabled={save.isPending || publish.isPending}
                className="flex-1 min-w-[120px] py-2.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-1"
                style={{ background: "var(--color-success)" }}>
                <Send size={14} />公開する
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- AI 生成ドラフトプレビュー（編集可能） ----
function DraftPreview({
  draft, usps, onChange, questId,
}: {
  draft: QuestDraft;
  usps: Usp[];
  onChange: (d: QuestDraft) => void;
  questId: string | null;
}) {
  const [skillsLoading, setSkillsLoading] = useState(false);
  const maxCount = skillCountForLevel(draft.level);

  async function handleRegenerateSkills() {
    setSkillsLoading(true);
    try {
      const res = questId
        ? await api.post<{ data: { answerSkills: string[]; skillCount: number } }>(`/admin/quests/${questId}/regenerate-skills`)
        : await api.post<{ data: { answerSkills: string[]; skillCount: number } }>("/admin/quests/regenerate-skills-preview", {
            title: draft.title, story: draft.story, targetCount: maxCount,
          });
      onChange({ ...draft, answerSkills: res.data.answerSkills });
    } finally { setSkillsLoading(false); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-2xl">{draft.emoji}</span>
        <input className="flex-1 font-semibold px-2 py-1 rounded-xl border text-sm"
          style={{ borderColor: "var(--color-paper-300)", fontFamily: "var(--font-klee)", background: "var(--color-paper-50)" }}
          value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>ストーリー</label>
        <textarea rows={3}
          className="w-full text-sm px-2 py-1 rounded-xl border resize-none"
          style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
          value={draft.story} onChange={(e) => onChange({ ...draft, story: e.target.value })} />
        <div className="text-sm px-2 py-1.5 rounded-xl mt-1" style={{ background: "var(--color-paper-50)", color: "var(--color-ink-600)" }}>
          <QuestStory text={draft.story} />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>ミッション</label>
        <textarea rows={2}
          className="w-full text-sm px-2 py-1 rounded-xl border resize-none"
          style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
          value={draft.mission} onChange={(e) => onChange({ ...draft, mission: e.target.value })} />
      </div>

      <div className="flex gap-4 text-sm flex-wrap">
        <label className="flex items-center gap-1" style={{ color: "var(--color-ink-600)" }}>
          難易度
          <select value={draft.level}
            onChange={(e) => {
              const newLevel = e.target.value as "normal" | "hard";
              const newMax = skillCountForLevel(newLevel);
              onChange({ ...draft, level: newLevel, answerSkills: draft.answerSkills.slice(0, newMax) });
            }}
            className="ml-1 px-2 py-0.5 rounded-lg border text-xs"
            style={{ borderColor: "var(--color-paper-300)" }}>
            <option value="normal">ノーマル（×3）</option>
            <option value="hard">ハード（×5）</option>
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

      {/* USP スロット */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium" style={{ color: "var(--color-ink-600)" }}>
            必要とするUSP（{maxCount}個）
          </span>
          <button type="button" onClick={handleRegenerateSkills}
            disabled={skillsLoading || !draft.title || !draft.story}
            className="flex items-center gap-1 px-2 py-1 rounded-xl text-xs disabled:opacity-40"
            style={{ background: "var(--color-paper-300)", color: "var(--color-ink-600)" }}>
            {skillsLoading ? <RefreshCw size={11} className="animate-spin" /> : <Wand2 size={11} />}
            AIで選び直す
          </button>
        </div>
        <UspSlotSelector usps={usps} selected={draft.answerSkills} maxCount={maxCount}
          onChange={(val) => onChange({ ...draft, answerSkills: val })} />
      </div>
    </div>
  );
}

// -------------------------------------------------------
// CSV インポートモーダル
// -------------------------------------------------------
function ImportModal({ usps, onClose, onImported }: { usps: Usp[]; onClose: () => void; onImported: () => void }) {
  const { termQuest } = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ReturnType<typeof csvToImportPayload> | null>(null);
  const [parseError, setParseError] = useState("");
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null);

  const importMutation = useMutation({
    mutationFn: (quests: ReturnType<typeof csvToImportPayload>) =>
      api.post<{ imported: number; errors: string[] }>("/admin/quests/import", { quests }),
    onSuccess: (res) => {
      setResult(res);
      if (res.errors.length === 0) { setTimeout(onImported, 1500); }
    },
  });

  function handleFile(file: File) {
    setParseError(""); setParsed(null); setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const rows = parseCSV(text);
        if (rows.length === 0) { setParseError("CSVが空か、ヘッダー行しかありません"); return; }
        setParsed(csvToImportPayload(rows));
      } catch { setParseError("CSVの読み込みに失敗しました"); }
    };
    reader.readAsText(file, "utf-8");
  }

  const validUspNames = new Set(usps.map((u) => u.name));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-6 w-full max-w-md rounded-3xl max-h-[90dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-klee)" }}>📥 CSVインポート</h2>
          <button onClick={onClose} className="p-1.5 rounded-full" style={{ background: "var(--color-paper-200)" }}>
            <X size={16} />
          </button>
        </div>

        <div className="text-xs mb-4 p-3 rounded-2xl space-y-1"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          <p className="font-semibold">CSVのヘッダー行（1行目）</p>
          <code className="block text-xs break-all" style={{ color: "var(--color-ink-800)" }}>
            emoji,title,story,mission,level,usp1,usp2,usp3,usp4,usp5,reward
          </code>
          <p>• <b>level</b>: normal / hard</p>
          <p>• <b>usp1〜usp3</b>: ノーマルは必須（システム登録済みのUSP名）</p>
          <p>• <b>usp4〜usp5</b>: ハードのみ必須</p>
          <p>• インポートした{termQuest}はすべて「下書き」として追加されます</p>
        </div>

        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />

        <button onClick={() => fileRef.current?.click()}
          className="w-full py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-2 mb-4"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)", border: "2px dashed var(--color-paper-300)" }}>
          <Upload size={16} />CSVファイルを選択
        </button>

        {parseError && <p className="text-sm text-red-500 mb-3">{parseError}</p>}

        {parsed && !result && (
          <div className="mb-4 space-y-2">
            <p className="text-sm font-medium" style={{ color: "var(--color-ink-700)" }}>
              {parsed.length} 件の{termQuest}が見つかりました
            </p>
            {/* 事前バリデーション表示 */}
            {parsed.map((q, i) => {
              const required = q.level === "hard" ? 5 : 3;
              const unknownUsps = q.answerSkills.filter((s) => !validUspNames.has(s));
              const hasError = !q.title || q.answerSkills.length < required || unknownUsps.length > 0;
              return (
                <div key={i} className="text-xs px-3 py-2 rounded-xl"
                  style={{ background: hasError ? "rgba(181,56,75,0.07)" : "var(--color-paper-200)" }}>
                  <span className="font-medium">{q.emoji} {q.title || "(タイトルなし)"}</span>
                  {hasError && (
                    <span className="ml-2" style={{ color: "var(--color-brand)" }}>
                      {!q.title ? "タイトル未入力 " : ""}
                      {unknownUsps.length > 0 ? `未登録USP: ${unknownUsps.join(",")} ` : ""}
                      {q.answerSkills.length < required ? `USP不足(${q.answerSkills.length}/${required})` : ""}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {result && (
          <div className="mb-4 p-3 rounded-2xl space-y-1"
            style={{ background: result.errors.length === 0 ? "rgba(90,140,92,0.1)" : "rgba(181,56,75,0.07)" }}>
            <p className="text-sm font-semibold" style={{ color: result.errors.length === 0 ? "var(--color-success)" : "var(--color-brand)" }}>
              {result.imported} 件インポート完了
              {result.errors.length > 0 && `（${result.errors.length} 件エラー）`}
            </p>
            {result.errors.map((e, i) => (
              <p key={i} className="text-xs" style={{ color: "var(--color-brand)" }}>{e}</p>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl text-sm"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            {result ? "閉じる" : "キャンセル"}
          </button>
          {parsed && !result && (
            <button onClick={() => importMutation.mutate(parsed)} disabled={importMutation.isPending}
              className="flex-1 py-2.5 rounded-2xl text-sm text-white font-medium disabled:opacity-50"
              style={{ background: "var(--color-brand)" }}>
              {importMutation.isPending ? "インポート中..." : `${parsed.length}件をインポート`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------
// AI 一括生成モーダル
// -------------------------------------------------------
function BulkAiGenerateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { termQuest } = useSettings();
  const [count, setCount] = useState(3);
  const [items, setItems] = useState<{ instruction: string }[]>(
    Array.from({ length: 3 }, () => ({ instruction: "" }))
  );
  const [additionalPrompt, setAdditionalPrompt] = useState("");
  const [result, setResult] = useState<{ created: { id: string; title: string; emoji: string }[]; count: number } | null>(null);
  const [error, setError] = useState("");

  function handleCountChange(newCount: number) {
    const clamped = Math.max(1, Math.min(10, newCount));
    setCount(clamped);
    setItems((prev) => {
      if (clamped > prev.length) {
        return [...prev, ...Array.from({ length: clamped - prev.length }, () => ({ instruction: "" }))];
      }
      return prev.slice(0, clamped);
    });
  }

  function setInstruction(idx: number, value: string) {
    setItems((prev) => prev.map((item, i) => (i === idx ? { instruction: value } : item)));
  }

  const generate = useMutation({
    mutationFn: () =>
      api.post<{ data: { created: { id: string; title: string; emoji: string }[]; count: number } }>(
        "/admin/quests/ai-bulk-generate",
        { items, additionalPrompt: additionalPrompt || undefined }
      ),
    onSuccess: (res) => { setResult(res.data); setError(""); },
    onError: (e: Error) => setError(e.message),
  });

  if (result) {
    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        style={{ background: "rgba(0,0,0,0.4)" }}>
        <div className="card-paper w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-6">
          <div className="text-center mb-5">
            <div className="text-4xl mb-2">🎉</div>
            <p className="font-semibold text-lg" style={{ fontFamily: "var(--font-klee)" }}>
              {result.count}件の{termQuest}を下書き追加しました
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--color-ink-500)" }}>
              {termQuest}管理の「下書き」から確認・公開できます
            </p>
          </div>
          <div className="space-y-2 mb-5">
            {result.created.map((q) => (
              <div key={q.id} className="flex items-center gap-2 px-3 py-2 rounded-2xl"
                style={{ background: "var(--color-paper-200)" }}>
                <span className="text-lg">{q.emoji}</span>
                <span className="text-sm font-medium" style={{ color: "var(--color-ink-700)" }}>{q.title}</span>
                <span className="ml-auto text-xs px-2 py-0.5 rounded-full"
                  style={{ background: "var(--color-paper-300)", color: "var(--color-ink-500)" }}>下書き</span>
              </div>
            ))}
          </div>
          <button onClick={onCreated}
            className="w-full py-3 rounded-2xl font-semibold text-sm text-white"
            style={{ background: "var(--color-brand)" }}>
            閉じる
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="card-paper w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-klee)" }}>
            ✨ AI一括生成
          </h2>
          <button onClick={onClose} className="p-2 rounded-full hover:opacity-70"><X size={20} /></button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-2xl text-sm text-white" style={{ background: "var(--color-brand)" }}>
            {error}
          </div>
        )}

        {/* 件数設定 */}
        <div className="mb-5">
          <label className="block text-sm font-semibold mb-2" style={{ color: "var(--color-ink-700)" }}>
            生成する{termQuest}の数
          </label>
          <div className="flex items-center gap-3">
            <button onClick={() => handleCountChange(count - 1)} disabled={count <= 1}
              className="w-9 h-9 rounded-full flex items-center justify-center font-bold disabled:opacity-30"
              style={{ background: "var(--color-paper-300)", color: "var(--color-ink-700)" }}>
              <Minus size={16} />
            </button>
            <span className="text-2xl font-bold w-8 text-center" style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
              {count}
            </span>
            <button onClick={() => handleCountChange(count + 1)} disabled={count >= 10}
              className="w-9 h-9 rounded-full flex items-center justify-center font-bold disabled:opacity-30"
              style={{ background: "var(--color-paper-300)", color: "var(--color-ink-700)" }}>
              <Plus size={16} />
            </button>
            <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>件（最大10件）</span>
          </div>
        </div>

        {/* 個別指示 */}
        <div className="mb-5">
          <label className="block text-sm font-semibold mb-1" style={{ color: "var(--color-ink-700)" }}>
            各{termQuest}への指示（業種・分野・テーマなど）
          </label>
          <p className="text-xs mb-3" style={{ color: "var(--color-ink-400)" }}>
            各枠に業種や課題のテーマを入力してください。空欄のままでもAIが自動で決めます。
          </p>
          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-sm font-semibold w-6 shrink-0 text-center"
                  style={{ color: "var(--color-brand)" }}>{i + 1}.</span>
                <input
                  value={item.instruction}
                  onChange={(e) => setInstruction(i, e.target.value)}
                  placeholder={`例: IT・Web業、士業、飲食業、製造業…`}
                  className="flex-1 px-3 py-2 rounded-xl border text-sm"
                  style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* 共通の追加指示 */}
        <div className="mb-6">
          <label className="block text-sm font-semibold mb-1" style={{ color: "var(--color-ink-700)" }}>
            全体への追加指示（任意）
          </label>
          <textarea
            value={additionalPrompt}
            onChange={(e) => setAdditionalPrompt(e.target.value)}
            placeholder="例: すべて中小企業の悩みにしてください"
            rows={2}
            className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
            style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
          />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-3 rounded-2xl text-sm font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            キャンセル
          </button>
          <button onClick={() => generate.mutate()} disabled={generate.isPending}
            className="flex-1 py-3 rounded-2xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--color-accent)" }}>
            {generate.isPending
              ? <><RefreshCw size={15} className="animate-spin" />{count}件を生成中...</>
              : <><Layers size={15} />{count}件を一括生成</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------
// 確認モーダル
// -------------------------------------------------------
function ConfirmModal({ message, onCancel, onConfirm, loading }: {
  message: string; onCancel: () => void; onConfirm: () => void; loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }} onClick={onCancel}>
      <div className="card-paper p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <p className="font-medium mb-4" style={{ color: "var(--color-ink-700)" }}>{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2 rounded-2xl text-sm"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button onClick={onConfirm} disabled={loading} className="flex-1 py-2 rounded-2xl text-sm text-white"
            style={{ background: "var(--color-brand)" }}>削除する</button>
        </div>
      </div>
    </div>
  );
}
