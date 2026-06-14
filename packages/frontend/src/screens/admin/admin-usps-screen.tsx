// =============================================================
// 管理画面 — USP管理（追加 / 編集 / 削除 / 並び順変更）
// =============================================================
import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, X, ChevronUp, ChevronDown, Download, Upload } from "lucide-react";
import { api } from "@/lib/api";
import type { Usp } from "@shared/types";

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
      api.post<{ data: { created: number; updated: number } }>("/admin/usps/import", { usps }),
    onSuccess: ({ data }) => {
      setImportMessage({
        type: "success",
        text: `インポートが完了しました（追加 ${data.created} 件 / 更新 ${data.updated} 件）`,
      });
      qc.invalidateQueries({ queryKey: ["admin", "usps"] });
      qc.invalidateQueries({ queryKey: ["usps"] });
    },
    onError: (e: Error) => setImportMessage({ type: "error", text: e.message }),
  });

  const usps = data?.data ?? [];

  function handleExport() {
    const exportData = usps.map((u) => ({
      name: u.name,
      emoji: u.emoji,
      description: u.description ?? "",
      sortOrder: u.sortOrder,
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
        importMutation.mutate(usps);
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
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-10">
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
            <div key={usp.id} className="card-paper flex items-center gap-3 px-4 py-3">
              {/* 並び替えボタン */}
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
