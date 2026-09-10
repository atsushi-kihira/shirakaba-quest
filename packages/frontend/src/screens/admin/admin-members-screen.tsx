// =============================================================
// 管理画面 — メンバー管理
// =============================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, UserMinus, UserCheck, Trash2, ChevronDown, ChevronUp, Ghost, Ban } from "lucide-react";
import { api } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";
import { fmtDateISO } from "@/lib/date";
import type { Skill } from "@shared/types";

type AdminMember = {
  id: string;
  name: string;
  furigana: string;
  email: string;
  emoji: string;
  bgColor: string;
  category: string;
  businessDescription: string | null;
  company: string | null;
  role: string | null;
  skills: Skill[];
  status: "pending" | "active" | "guest" | "on_leave" | "rejected" | "deleted";
  approvedAt: number | null;
  createdAt: number;
  isPilot1: boolean;
  isPilot2: boolean;
  isPowerTeamCoordinator: boolean;
  isMentorCoordinator: boolean;
  isPersonalMentor: boolean;
  isTopicMentor: boolean;
};

type MemberRoleName = "pilot1" | "pilot2" | "power_team_coordinator" | "mentor_coordinator" | "personal_mentor" | "topic_mentor";

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending:  { label: "承認待ち", color: "var(--color-accent)" },
  active:   { label: "アクティブ", color: "var(--color-success)" },
  guest:    { label: "ゲストユーザー", color: "#6B7DB3" },
  on_leave: { label: "休会中", color: "var(--color-ink-400)" },
  rejected: { label: "利用却下", color: "var(--color-brand)" },
  deleted:  { label: "削除済み", color: "var(--color-ink-300)" },
};

export function AdminMembersScreen() {
  const qc = useQueryClient();
  const { timezone: tz, termEnishi } = useSettings();
  const [filter, setFilter] = useState<"all" | "pending" | "active" | "guest" | "on_leave" | "rejected">("all");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "members"],
    queryFn: () => api.get<{ data: AdminMember[] }>("/admin/members"),
  });

  const approve = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/members/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "members"] }),
  });

  const goOnLeave = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/members/${id}/leave`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "members"] }),
  });

  const reactivate = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/members/${id}/reactivate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "members"] }),
  });

  const markGuest = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/members/${id}/mark-guest`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "members"] }),
  });

  const reject = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/members/${id}/reject`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "members"] }),
  });

  const deleteMember = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/members/${id}`),
    onSuccess: () => {
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ["admin", "members"] });
    },
  });

  const setRole = useMutation({
    mutationFn: ({ id, role, enabled }: { id: string; role: MemberRoleName; enabled: boolean }) =>
      api.patch(`/admin/members/${id}/roles`, { role, enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "members"] }),
  });

  const members = data?.data ?? [];
  // 「すべて」には休会中・ゲストユーザー・利用却下・削除済みは含めない（アクティブなメンバーと
  // 混ざって見づらくなるため、それぞれ専用タブから見る）
  const SIDE_STATUSES = ["deleted", "on_leave", "guest", "rejected"];
  const filtered = filter === "all"
    ? members.filter((m) => !SIDE_STATUSES.includes(m.status))
    : members.filter((m) => m.status === filter);

  const pendingCount = members.filter((m) => m.status === "pending").length;

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-24">
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
        {(["all", "pending", "active", "guest", "on_leave", "rejected"] as const).map((f) => (
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
            {{ all: "すべて", pending: "承認待ち", active: "アクティブ", guest: "ゲストユーザー", on_leave: "休会中", rejected: "利用却下" }[f]}
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
          {filter === "pending" ? "承認待ちのメンバーはいません"
            : filter === "on_leave" ? "休会中のメンバーはいません"
            : filter === "guest" ? "ゲストユーザーはいません"
            : filter === "rejected" ? "利用却下したメンバーはいません"
            : "メンバーがいません"}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((m) => {
            const st = STATUS_LABEL[m.status] ?? { label: m.status, color: "var(--color-ink-400)" };
            const isExpanded = expandedId === m.id;
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
                      登録: {fmtDateISO(m.createdAt, tz)}
                    </div>
                    {m.status === "active" && (
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        <button
                          onClick={() => setRole.mutate({ id: m.id, role: "pilot1", enabled: !m.isPilot1 })}
                          disabled={setRole.isPending}
                          className="px-2.5 py-1 rounded-full text-xs font-medium transition hover:opacity-80"
                          style={{
                            background: m.isPilot1 ? "var(--color-success)" : "var(--color-paper-200)",
                            color: m.isPilot1 ? "white" : "var(--color-ink-500)",
                          }}
                          title={`パイロット1（${termEnishi}さがし機能）への追加/解除`}
                        >
                          🥚 パイロット1{m.isPilot1 ? "中" : ""}
                        </button>
                        <button
                          onClick={() => setRole.mutate({ id: m.id, role: "pilot2", enabled: !m.isPilot2 })}
                          disabled={setRole.isPending}
                          className="px-2.5 py-1 rounded-full text-xs font-medium transition hover:opacity-80"
                          style={{
                            background: m.isPilot2 ? "var(--color-success)" : "var(--color-paper-200)",
                            color: m.isPilot2 ? "white" : "var(--color-ink-500)",
                          }}
                          title="パイロット2（今後の新機能）への追加/解除"
                        >
                          🌱 パイロット2{m.isPilot2 ? "中" : ""}
                        </button>
                        <button
                          onClick={() => setRole.mutate({ id: m.id, role: "power_team_coordinator", enabled: !m.isPowerTeamCoordinator })}
                          disabled={setRole.isPending}
                          className="px-2.5 py-1 rounded-full text-xs font-medium transition hover:opacity-80"
                          style={{
                            background: m.isPowerTeamCoordinator ? "var(--color-accent)" : "var(--color-paper-200)",
                            color: m.isPowerTeamCoordinator ? "white" : "var(--color-ink-500)",
                          }}
                          title="パワーチームコーディネーターの付与/解除"
                        >
                          🛡️ PTC{m.isPowerTeamCoordinator ? "" : "にする"}
                        </button>
                        <button
                          onClick={() => setRole.mutate({ id: m.id, role: "mentor_coordinator", enabled: !m.isMentorCoordinator })}
                          disabled={setRole.isPending}
                          className="px-2.5 py-1 rounded-full text-xs font-medium transition hover:opacity-80"
                          style={{
                            background: m.isMentorCoordinator ? "var(--color-accent)" : "var(--color-paper-200)",
                            color: m.isMentorCoordinator ? "white" : "var(--color-ink-500)",
                          }}
                          title="メンターコーディネーターの付与/解除"
                        >
                          🧭 MTC{m.isMentorCoordinator ? "" : "にする"}
                        </button>
                        <button
                          onClick={() => setRole.mutate({ id: m.id, role: "personal_mentor", enabled: !m.isPersonalMentor })}
                          disabled={setRole.isPending}
                          className="px-2.5 py-1 rounded-full text-xs font-medium transition hover:opacity-80"
                          style={{
                            background: m.isPersonalMentor ? "var(--color-accent)" : "var(--color-paper-200)",
                            color: m.isPersonalMentor ? "white" : "var(--color-ink-500)",
                          }}
                          title="パーソナルメンターの付与/解除"
                        >
                          🧑‍🏫 PM{m.isPersonalMentor ? "" : "にする"}
                        </button>
                        <button
                          onClick={() => setRole.mutate({ id: m.id, role: "topic_mentor", enabled: !m.isTopicMentor })}
                          disabled={setRole.isPending}
                          className="px-2.5 py-1 rounded-full text-xs font-medium transition hover:opacity-80"
                          style={{
                            background: m.isTopicMentor ? "var(--color-accent)" : "var(--color-paper-200)",
                            color: m.isTopicMentor ? "white" : "var(--color-ink-500)",
                          }}
                          title="トピックメンターの付与/解除"
                        >
                          📚 TM{m.isTopicMentor ? "" : "にする"}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* アクション */}
                  <div className="flex gap-2 shrink-0">
                    {(m.status === "pending" || m.status === "guest") && (
                      <>
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : m.id)}
                          className="p-2 rounded-2xl transition hover:opacity-80"
                          style={{ background: "var(--color-paper-200)" }}
                          title="プロフィール確認"
                        >
                          {isExpanded
                            ? <ChevronUp size={16} style={{ color: "var(--color-ink-500)" }} />
                            : <ChevronDown size={16} style={{ color: "var(--color-ink-500)" }} />
                          }
                        </button>
                        <button
                          onClick={() => approve.mutate(m.id)}
                          disabled={approve.isPending}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs font-medium text-white transition hover:opacity-80"
                          style={{ background: "var(--color-success)" }}
                          title={m.status === "guest" ? "白樺のメンバーとして承認する" : "承認"}
                        >
                          <CheckCircle size={14} />
                          承認
                        </button>
                        {m.status === "pending" && (
                          <button
                            onClick={() => markGuest.mutate(m.id)}
                            disabled={markGuest.isPending}
                            className="p-2 rounded-2xl transition hover:opacity-80"
                            style={{ background: "var(--color-paper-200)" }}
                            title="ゲストユーザーにする（スケジューラー等の限定機能のみ。承認待ちからは外れます）"
                          >
                            <Ghost size={16} style={{ color: "#6B7DB3" }} />
                          </button>
                        )}
                        <button
                          onClick={() => reject.mutate(m.id)}
                          disabled={reject.isPending}
                          className="p-2 rounded-2xl transition hover:opacity-80"
                          style={{ background: "var(--color-paper-200)" }}
                          title="利用を却下する（記録は残ります）"
                        >
                          <Ban size={16} style={{ color: "var(--color-brand)" }} />
                        </button>
                      </>
                    )}
                    {m.status === "active" && (
                      <button
                        onClick={() => goOnLeave.mutate(m.id)}
                        disabled={goOnLeave.isPending}
                        className="p-2 rounded-2xl transition hover:opacity-80"
                        style={{ background: "var(--color-paper-200)" }}
                        title="休会にする（記録は残り、いつでもアクティブに戻せます）"
                      >
                        <UserMinus size={16} style={{ color: "var(--color-ink-500)" }} />
                      </button>
                    )}
                    {m.status === "on_leave" && (
                      <button
                        onClick={() => reactivate.mutate(m.id)}
                        disabled={reactivate.isPending}
                        className="p-2 rounded-2xl transition hover:opacity-80"
                        style={{ background: "var(--color-paper-200)" }}
                        title="アクティブに戻す"
                      >
                        <UserCheck size={16} style={{ color: "var(--color-success)" }} />
                      </button>
                    )}
                    {m.status !== "deleted" && (
                      <button
                        onClick={() => setConfirmDelete(m.id)}
                        className="p-2 rounded-2xl transition hover:opacity-80"
                        style={{ background: "var(--color-paper-200)" }}
                        title="完全に削除する（元に戻せません）"
                      >
                        <Trash2 size={16} style={{ color: "var(--color-brand)" }} />
                      </button>
                    )}
                  </div>
                </div>

                {/* 承認待ち・ゲストユーザーのプロフィール展開パネル */}
                {(m.status === "pending" || m.status === "guest") && isExpanded && (
                  <div className="mt-4 pt-4 border-t space-y-3" style={{ borderColor: "var(--color-paper-300)" }}>
                    {/* 基本情報 */}
                    <div className="space-y-1">
                      {m.role && (
                        <div className="text-sm" style={{ color: "var(--color-ink-700)" }}>
                          <span className="font-medium" style={{ color: "var(--color-ink-500)" }}>役職:</span> {m.role}
                        </div>
                      )}
                      {m.businessDescription && (
                        <div className="text-sm" style={{ color: "var(--color-ink-700)" }}>
                          <span className="font-medium" style={{ color: "var(--color-ink-500)" }}>事業内容:</span> {m.businessDescription}
                        </div>
                      )}
                    </div>

                    {/* USP・スキル */}
                    {m.skills && m.skills.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-ink-500)" }}>✨ USP・スキル</p>
                        <div className="space-y-2">
                          {m.skills.map((skill, i) => (
                            <div key={i} className="p-3 rounded-xl text-sm" style={{ background: "var(--color-paper-200)" }}>
                              <div className="flex items-center gap-1.5 font-semibold mb-0.5" style={{ color: "var(--color-ink-800)" }}>
                                <span>{skill.emoji}</span>
                                <span>{skill.name}</span>
                              </div>
                              <div className="text-xs" style={{ color: "var(--color-ink-500)" }}>
                                {skill.issue}{skill.connector}{skill.solution}{skill.noEnding ? "" : "ことができる"}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
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
              メンバーを完全に削除しますか？
            </h3>
            <p className="text-sm mb-4" style={{ color: "var(--color-ink-500)" }}>
              この操作は取り消せません。1to1・ミーティング等の関連データもすべて削除され、
              メールアドレスは新規登録に再度使えるようになります。しばらく戻ってくる可能性がある場合は、
              代わりに「休会」をご利用ください（記録を残したまま、いつでもアクティブに戻せます）。
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
                完全に削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
