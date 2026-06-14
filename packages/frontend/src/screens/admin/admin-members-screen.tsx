// =============================================================
// 管理画面 — メンバー管理
// =============================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, PauseCircle, PlayCircle, Trash2 } from "lucide-react";
import { api } from "@/lib/api";

type AdminMember = {
  id: string;
  name: string;
  furigana: string;
  email: string;
  emoji: string;
  bgColor: string;
  category: string;
  company: string | null;
  role: string | null;
  status: "pending" | "active" | "suspended" | "deleted";
  approvedAt: number | null;
  createdAt: number;
};

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending:   { label: "承認待ち", color: "var(--color-accent)" },
  active:    { label: "アクティブ", color: "var(--color-success)" },
  suspended: { label: "停止中", color: "var(--color-ink-400)" },
  deleted:   { label: "削除済み", color: "var(--color-ink-300)" },
};

export function AdminMembersScreen() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "pending" | "active" | "suspended">("all");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "members"],
    queryFn: () => api.get<{ data: AdminMember[] }>("/admin/members"),
  });

  const approve = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/members/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "members"] }),
  });

  const suspend = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/members/${id}/suspend`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "members"] }),
  });

  const unsuspend = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/members/${id}/unsuspend`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "members"] }),
  });

  const deleteMember = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/members/${id}`),
    onSuccess: () => {
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ["admin", "members"] });
    },
  });

  const members = data?.data ?? [];
  const filtered = filter === "all"
    ? members.filter((m) => m.status !== "deleted")
    : members.filter((m) => m.status === filter);

  const pendingCount = members.filter((m) => m.status === "pending").length;

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-10">
      <h1 className="text-2xl font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
        👥 メンバー管理
      </h1>
      {pendingCount > 0 && (
        <div className="mb-4 px-4 py-2 rounded-2xl text-sm font-medium text-white"
          style={{ background: "var(--color-brand)" }}>
          ⚠️ 承認待ちのメンバーが {pendingCount} 名います
        </div>
      )}

      {/* フィルター */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(["all", "pending", "active", "suspended"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              filter === f ? "text-white" : ""
            }`}
            style={{
              background: filter === f ? "var(--color-brand)" : "var(--color-paper-200)",
              color: filter === f ? "white" : "var(--color-ink-600)",
            }}
          >
            {{ all: "すべて", pending: "承認待ち", active: "アクティブ", suspended: "停止中" }[f]}
            {f === "pending" && pendingCount > 0 && (
              <span className="ml-1 text-xs">({pendingCount})</span>
            )}
          </button>
        ))}
      </div>

      {/* メンバー一覧 */}
      {isLoading ? (
        <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>読み込み中...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>
          {filter === "pending" ? "承認待ちのメンバーはいません" : "メンバーがいません"}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((m) => {
            const st = STATUS_LABEL[m.status] ?? { label: m.status, color: "var(--color-ink-400)" };
            return (
              <div key={m.id} className="card-paper p-4">
                <div className="flex items-start gap-3">
                  {/* アバター */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0 ${m.bgColor}`}>
                    {m.emoji}
                  </div>

                  {/* 情報 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold" style={{ color: "var(--color-ink-800)" }}>{m.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--color-paper-200)", color: st.color, fontWeight: 600 }}>
                        {st.label}
                      </span>
                    </div>
                    <div className="text-xs mt-0.5 truncate" style={{ color: "var(--color-ink-400)" }}>
                      {m.email}
                    </div>
                    {m.category && (
                      <div className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
                        {m.category}{m.company ? ` / ${m.company}` : ""}
                      </div>
                    )}
                    <div className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>
                      登録: {new Date(m.createdAt * 1000).toLocaleDateString("ja-JP")}
                    </div>
                  </div>

                  {/* アクション */}
                  <div className="flex gap-2 shrink-0">
                    {m.status === "pending" && (
                      <button
                        onClick={() => approve.mutate(m.id)}
                        disabled={approve.isPending}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs font-medium text-white transition hover:opacity-80"
                        style={{ background: "var(--color-success)" }}
                        title="承認"
                      >
                        <CheckCircle size={14} />
                        承認
                      </button>
                    )}
                    {m.status === "active" && (
                      <button
                        onClick={() => suspend.mutate(m.id)}
                        disabled={suspend.isPending}
                        className="p-2 rounded-2xl transition hover:opacity-80"
                        style={{ background: "var(--color-paper-200)" }}
                        title="停止"
                      >
                        <PauseCircle size={16} style={{ color: "var(--color-ink-500)" }} />
                      </button>
                    )}
                    {m.status === "suspended" && (
                      <button
                        onClick={() => unsuspend.mutate(m.id)}
                        disabled={unsuspend.isPending}
                        className="p-2 rounded-2xl transition hover:opacity-80"
                        style={{ background: "var(--color-paper-200)" }}
                        title="停止解除"
                      >
                        <PlayCircle size={16} style={{ color: "var(--color-success)" }} />
                      </button>
                    )}
                    {m.status !== "deleted" && (
                      <button
                        onClick={() => setConfirmDelete(m.id)}
                        className="p-2 rounded-2xl transition hover:opacity-80"
                        style={{ background: "var(--color-paper-200)" }}
                        title="削除"
                      >
                        <Trash2 size={16} style={{ color: "var(--color-brand)" }} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 削除確認モーダル */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setConfirmDelete(null)}>
          <div className="card-paper p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-lg mb-2" style={{ fontFamily: "var(--font-klee)" }}>
              メンバーを削除しますか？
            </h3>
            <p className="text-sm mb-4" style={{ color: "var(--color-ink-500)" }}>
              この操作は取り消せません。メンバーのデータはシステムに残ります。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2 rounded-2xl text-sm font-medium"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
              >
                キャンセル
              </button>
              <button
                onClick={() => deleteMember.mutate(confirmDelete)}
                disabled={deleteMember.isPending}
                className="flex-1 py-2 rounded-2xl text-sm font-medium text-white"
                style={{ background: "var(--color-brand)" }}
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
