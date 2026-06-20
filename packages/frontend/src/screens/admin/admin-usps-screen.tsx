// =============================================================
// 管理画面 — USP管理（追加 / 編集 / 削除 / 並び順変更）
// =============================================================
import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, X, ChevronUp, ChevronDown, Download, Upload, Check, ChevronDown as CollapseIcon, GripVertical } from "lucide-react";
import { api } from "@/lib/api";
import type { Usp, UspRequest } from "@shared/types";

type UspForm = {
  name: string;
  emoji: string;
  description: string;
};

const EMPTY_FORM: UspForm = { name: "", emoji: "⭐", description: "" };

export function AdminUspsScreen() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editUsp, setEditUsp] = useState<Usp | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Usp | null>(null);
  const [importMessage, setImportMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [importPending, setImportPending] = useState<Array<{ name: string; emoji?: string; description?: string; sortOrder?: number }> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "usps"],
    queryFn: () => api.get<{ data: Usp[] }>("/admin/usps"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/usps/${id}`),
    onSuccess: () => {
      setDeleteConfirm(null);
      qc.invalidateQueries({ queryKey: ["admin", "usps"] });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (order: string[]) => api.put("/admin/usps/reorder", { order }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "usps"] }),
  });

  const importMutation = useMutation({
    mutationFn: (usps: Array<{ name: string; emoji?: string; description?: string; sortOrder?: number }>) =>
      api.post<{ data: { count: number } }>("/admin/usps/import", { usps }),
    onSuccess: ({ data }) => {
      setImportMessage({
        type: "success",
        text: `インポートが完了しました（${data.count} 件のUSPに置き換えました）`,
      });
      qc.invalidateQueries({ queryKey: ["admin", "usps"] });
      qc.invalidateQueries({ queryKey: ["usps"] });
    },
    onError: (e: Error) => setImportMessage({ type: "error", text: e.message }),
  });

  const usps = data?.data ?? [];
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  function handleDrop(targetIdx: number) {
    if (dragIdx === null || dragIdx === targetIdx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }
    const newOrder = [...usps];
    const [moved] = newOrder.splice(dragIdx, 1);
    newOrder.splice(targetIdx, 0, moved);
    reorderMutation.mutate(newOrder.map((u) => u.id));
    setDragIdx(null);
    setDragOverIdx(null);
  }

  function handleExport() {
    const exportData = usps.map((u, idx) => ({
      name: u.name,
      emoji: u.emoji,
      description: u.description ?? "",
      sortOrder: idx + 1,
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `usps_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed)) {
          throw new Error("ファイルの形式が正しくありません（USPの配列が必要です）");
        }
        const usps = parsed.map((item) => ({
          name: String(item.name ?? "").trim(),
          emoji: item.emoji != null ? String(item.emoji) : undefined,
          description: item.description != null ? String(item.description) : undefined,
          sortOrder: typeof item.sortOrder === "number" ? item.sortOrder : undefined,
        }));
        if (usps.some((u) => !u.name)) {
          throw new Error("名前が空のUSPが含まれています");
        }
        setImportMessage(null);
        setImportPending(usps);
      } catch (err) {
        setImportMessage({
          type: "error",
          text: err instanceof Error ? err.message : "ファイルを読み込めませんでした",
        });
      }
    };
    reader.readAsText(file);
  }

  function moveUsp(idx: number, direction: "up" | "down") {
    const newOrder = [...usps];
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= newOrder.length) return;
    [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
    reorderMutation.mutate(newOrder.map((u) => u.id));
  }

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-24">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            ⭐ USP管理
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-500)" }}>
            カードに表示される能力（USP）の一覧を管理します。お題の正解スキルはここから選ばれます。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={usps.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-medium transition hover:opacity-80 disabled:opacity-40"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
          >
            <Download size={15} />
            一括エクスポート
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-medium transition hover:opacity-80 disabled:opacity-50"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
          >
            <Upload size={15} />
            {importMutation.isPending ? "インポート中..." : "一括インポート"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            onChange={handleImportFileChange}
            className="hidden"
          />
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium text-white transition hover:opacity-80"
            style={{ background: "var(--color-brand)" }}
          >
            <Plus size={15} />
            USPを追加
          </button>
        </div>
      </div>

      {importMessage && (
        <div
          className="mb-4 p-3 rounded-2xl text-sm flex items-start justify-between gap-2"
          style={{
            background: importMessage.type === "success" ? "var(--color-paper-200)" : "var(--color-brand)",
            color: importMessage.type === "success" ? "var(--color-ink-700)" : "white",
          }}
        >
          <span>{importMessage.text}</span>
          <button onClick={() => setImportMessage(null)} className="shrink-0 hover:opacity-70">
            <X size={16} />
          </button>
        </div>
      )}

      {/* ---- USP承認申請セクション ---- */}
      <UspRequestsSection />

      {isLoading ? (
        <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>読み込み中...</div>
      ) : usps.length === 0 ? (
        <div className="text-center py-16" style={{ color: "var(--color-ink-400)" }}>
          <div className="text-4xl mb-3">⭐</div>
          <p className="font-semibold">USPがまだ登録されていません</p>
          <p className="text-sm mt-1">「USPを追加」ボタンから登録してください</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 mt-4">
          {usps.map((usp, idx) => (
            <div
              key={usp.id}
              className="card-paper flex items-center gap-3 px-3 py-3 transition-all"
              draggable={true}
              onDragStart={() => setDragIdx(idx)}
              onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
              onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
              onDrop={(e) => { e.preventDefault(); handleDrop(idx); }}
              style={{
                opacity: dragIdx === idx ? 0.5 : 1,
                borderTop: dragOverIdx === idx && dragIdx !== idx ? "2px solid var(--color-brand)" : undefined,
                cursor: "grab",
              }}
            >
              {/* ドラッグハンドル */}
              <GripVertical size={16} className="shrink-0 cursor-grab" style={{ color: "var(--color-ink-300)" }} />

              {/* 上下ボタン（モバイル用） */}
              <div className="flex flex-col gap-0.5 shrink-0">
                <button
                  onClick={() => moveUsp(idx, "up")}
                  disabled={idx === 0 || reorderMutation.isPending}
                  className="p-0.5 rounded hover:opacity-70 disabled:opacity-20"
                >
                  <ChevronUp size={14} style={{ color: "var(--color-ink-400)" }} />
                </button>
                <button
                  onClick={() => moveUsp(idx, "down")}
                  disabled={idx === usps.length - 1 || reorderMutation.isPending}
                  className="p-0.5 rounded hover:opacity-70 disabled:opacity-20"
                >
                  <ChevronDown size={14} style={{ color: "var(--color-ink-400)" }} />
                </button>
              </div>

              {/* 絵文字 */}
              <span className="text-2xl shrink-0 w-8 text-center">{usp.emoji}</span>

              {/* 名前・説明 */}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>{usp.name}</p>
                {usp.description && (
                  <p className="text-xs mt-0.5 line-clamp-1" style={{ color: "var(--color-ink-500)" }}>{usp.description}</p>
                )}
              </div>

              {/* 操作ボタン */}
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => setEditUsp(usp)}
                  className="p-2 rounded-2xl transition hover:opacity-80"
                  style={{ background: "var(--color-paper-200)" }}
                  title="編集"
                >
                  <Pencil size={14} style={{ color: "var(--color-ink-500)" }} />
                </button>
                <button
                  onClick={() => setDeleteConfirm(usp)}
                  className="p-2 rounded-2xl transition hover:opacity-80"
                  style={{ background: "var(--color-paper-200)" }}
                  title="削除"
                >
                  <Trash2 size={14} style={{ color: "var(--color-brand)" }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 追加モーダル */}
      {showCreate && (
        <UspFormModal
          title="USPを追加"
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ["admin", "usps"] });
            // 公開USP一覧も更新
            qc.invalidateQueries({ queryKey: ["usps"] });
          }}
        />
      )}

      {/* 編集モーダル */}
      {editUsp && (
        <UspFormModal
          title="USPを編集"
          initial={editUsp}
          uspId={editUsp.id}
          onClose={() => setEditUsp(null)}
          onSaved={() => {
            setEditUsp(null);
            qc.invalidateQueries({ queryKey: ["admin", "usps"] });
            qc.invalidateQueries({ queryKey: ["usps"] });
          }}
        />
      )}

      {/* 一括インポート確認 */}
      {importPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setImportPending(null)}
        >
          <div className="card-paper p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <p className="font-medium mb-1" style={{ color: "var(--color-ink-800)" }}>
              現在のUSP一覧をすべて削除して、{importPending.length}件のUSPに置き換えます。
            </p>
            <p className="text-sm mb-4" style={{ color: "var(--color-ink-500)" }}>
              この操作は取り消せません。よろしいですか？
            </p>
            <div className="flex gap-3">
              <button onClick={() => setImportPending(null)}
                className="flex-1 py-2.5 rounded-2xl text-sm"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                キャンセル
              </button>
              <button
                onClick={() => {
                  importMutation.mutate(importPending);
                  setImportPending(null);
                }}
                disabled={importMutation.isPending}
                className="flex-1 py-2.5 rounded-2xl text-sm text-white"
                style={{ background: "var(--color-brand)" }}>
                置き換える
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 削除確認 */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setDeleteConfirm(null)}
        >
          <div className="card-paper p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <p className="font-medium mb-1" style={{ color: "var(--color-ink-800)" }}>
              「{deleteConfirm.emoji} {deleteConfirm.name}」を削除しますか？
            </p>
            <p className="text-sm mb-4" style={{ color: "var(--color-ink-500)" }}>
              このUSPを正解スキルに設定しているお題がある場合は、手動で修正が必要です。
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 rounded-2xl text-sm"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                キャンセル
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm.id)}
                disabled={deleteMutation.isPending}
                className="flex-1 py-2.5 rounded-2xl text-sm text-white"
                style={{ background: "var(--color-brand)" }}>
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- USP 追加・編集フォームモーダル ----
function UspFormModal({
  title,
  initial,
  uspId,
  onClose,
  onSaved,
}: {
  title: string;
  initial?: Usp;
  uspId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<UspForm>({
    name: initial?.name ?? EMPTY_FORM.name,
    emoji: initial?.emoji ?? EMPTY_FORM.emoji,
    description: initial?.description ?? EMPTY_FORM.description,
  });
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: () => {
      if (uspId) {
        return api.patch(`/admin/usps/${uspId}`, form);
      }
      return api.post("/admin/usps", form);
    },
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="card-paper w-full sm:max-w-md max-h-[90dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-6">
        <div className="flex items-center justify-between mb-5">
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
            <div className="w-20">
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>絵文字</label>
              <input
                value={form.emoji}
                onChange={(e) => setForm({ ...form, emoji: e.target.value })}
                className="w-full text-center text-2xl px-1 py-2 rounded-xl border"
                style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
                maxLength={2}
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
                USP名 <span style={{ color: "var(--color-brand)" }}>*</span>
              </label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
                placeholder="例: リスク判断力"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>説明（任意）</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
              style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
              placeholder="このUSPがどんな能力かを簡単に説明してください"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl text-sm font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            キャンセル
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || !form.name.trim()}
            className="flex-1 py-3 rounded-2xl text-sm font-medium text-white transition hover:opacity-80 disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}>
            {save.isPending ? "保存中..." : "保存する"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ================================================================
// USP承認申請レビューセクション
// ================================================================
function UspRequestsSection() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const [rejectModal, setRejectModal] = useState<UspRequest | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const { data } = useQuery({
    queryKey: ["admin", "usp-requests"],
    queryFn: () => api.get<{ data: UspRequest[] }>("/admin/usps/requests"),
  });

  const requests = data?.data ?? [];
  const pending = requests.filter((r) => r.status === "pending");
  const reviewed = requests.filter((r) => r.status !== "pending");

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/usps/requests/${id}/approve`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "usp-requests"] });
      qc.invalidateQueries({ queryKey: ["admin", "usps"] });
      qc.invalidateQueries({ queryKey: ["usps"] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      api.post(`/admin/usps/requests/${id}/reject`, { reviewNote: note }),
    onSuccess: () => {
      setRejectModal(null);
      setRejectNote("");
      qc.invalidateQueries({ queryKey: ["admin", "usp-requests"] });
    },
  });

  if (requests.length === 0) return null;

  return (
    <div className="mb-6 rounded-3xl overflow-hidden" style={{ border: "1.5px solid var(--color-paper-300)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold transition hover:opacity-80"
        style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}
      >
        <span>📨 USP申請</span>
        {pending.length > 0 && (
          <span
            className="px-2 py-0.5 rounded-full text-xs text-white font-bold"
            style={{ background: "var(--color-brand)" }}
          >
            {pending.length}件 承認待ち
          </span>
        )}
        <CollapseIcon size={16} className={`ml-auto transition-transform ${open ? "rotate-180" : ""}`} style={{ color: "var(--color-ink-400)" }} />
      </button>

      {open && (
        <div className="divide-y" style={{ borderColor: "var(--color-paper-300)" }}>
          {pending.length === 0 && reviewed.length > 0 && (
            <p className="px-4 py-3 text-sm" style={{ color: "var(--color-ink-400)" }}>
              承認待ちの申請はありません
            </p>
          )}

          {/* 承認待ち */}
          {pending.map((req) => (
            <div key={req.id} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <span className="text-2xl mt-0.5">{req.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>{req.uspName}</p>
                  {req.description && (
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>{req.description}</p>
                  )}
                  <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
                    申請者: {req.requesterName}（{req.requesterEmail}）
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => approveMutation.mutate(req.id)}
                  disabled={approveMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium text-white transition hover:opacity-80 disabled:opacity-50"
                  style={{ background: "var(--color-success)" }}
                >
                  <Check size={13} />
                  承認してUSPに追加
                </button>
                <button
                  onClick={() => { setRejectModal(req); setRejectNote(""); }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium transition hover:opacity-80"
                  style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
                >
                  却下
                </button>
              </div>
            </div>
          ))}

          {/* 審査済み（折りたたみ） */}
          {reviewed.length > 0 && (
            <details className="px-4 py-2">
              <summary className="text-xs cursor-pointer select-none" style={{ color: "var(--color-ink-400)" }}>
                審査済み {reviewed.length}件 ▼
              </summary>
              <div className="mt-2 space-y-2">
                {reviewed.map((req) => (
                  <div key={req.id} className="flex items-center gap-2 py-1">
                    <span className="text-lg">{req.emoji}</span>
                    <span className="text-sm flex-1" style={{ color: "var(--color-ink-600)" }}>{req.uspName}</span>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{
                        background: req.status === "approved" ? "rgba(90,140,92,0.15)" : "rgba(181,56,75,0.1)",
                        color: req.status === "approved" ? "var(--color-success)" : "var(--color-brand)",
                      }}
                    >
                      {req.status === "approved" ? "承認済み" : "却下済み"}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* 却下モーダル */}
      {rejectModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setRejectModal(null)}
        >
          <div className="card-paper p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-1" style={{ color: "var(--color-ink-800)" }}>
              {rejectModal.emoji} {rejectModal.uspName}を却下
            </h3>
            <p className="text-sm mb-3" style={{ color: "var(--color-ink-500)" }}>
              却下理由をメンバーにお伝えするコメントを入力できます（任意）。
            </p>
            <textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={3}
              placeholder="例: 既存のUSP「リスク判断力」と重複するため"
              className="w-full rounded-2xl border text-sm resize-none px-3 py-2 mb-4"
              style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)", fontSize: "16px" }}
            />
            <div className="flex gap-3">
              <button
                onClick={() => setRejectModal(null)}
                className="flex-1 py-2.5 rounded-2xl text-sm"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
              >
                キャンセル
              </button>
              <button
                onClick={() => rejectMutation.mutate({ id: rejectModal.id, note: rejectNote })}
                disabled={rejectMutation.isPending}
                className="flex-1 py-2.5 rounded-2xl text-sm text-white disabled:opacity-50"
                style={{ background: "var(--color-brand)" }}
              >
                {rejectMutation.isPending ? "処理中..." : "却下する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
