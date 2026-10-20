// =============================================================
// 管理画面 — メンバー管理
// =============================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, UserMinus, UserCheck, Trash2, ChevronDown, ChevronUp, Ghost, Ban, Eye } from "lucide-react";
import { api } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";
import { fmtDateISO, fmtDateTimeFull } from "@/lib/date";
import { Search, X } from "lucide-react";
import { matchesSearchQuery } from "@/lib/contact-search";
import { JoinedRangeFilter, EMPTY_JOINED_RANGE, inJoinedRange, isJoinedRangeActive, type JoinedRange } from "@/components/joined-range-filter";
import { AdminMemberDetailModal, type AdminMemberDetailBase } from "./_admin-member-detail-modal";
import { AdminChangeEmailModal } from "./_admin-change-email-modal";

type AdminMember = AdminMemberDetailBase & {
  status: "pending" | "active" | "guest" | "on_leave" | "rejected" | "deleted";
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

// ---- 登録を始めたが、確認メールのリンクを開いていない（承認待ちに出てこない）人 ----
type PendingRegistration = { email: string; name: string | null; requestedAt: number; hasDraft: boolean; linkOpened: boolean };

function PendingRegistrationsSection({ tz }: { tz: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin", "registration-pending"],
    queryFn: () => api.get<{ data: PendingRegistration[] }>("/admin/members/registration-pending"),
  });
  const resend = useMutation({
    mutationFn: (email: string) => api.post("/admin/members/registration-pending/resend", { email }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "registration-pending"] }),
  });
  // リンクは開かれているのに登録が作られなかった方を、残っている入力内容から管理者が登録する
  const complete = useMutation({
    mutationFn: (email: string) => api.post("/admin/members/registration-pending/complete", { email }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "registration-pending"] });
      qc.invalidateQueries({ queryKey: ["admin", "members"] });
    },
  });
  const dismiss = useMutation({
    mutationFn: (email: string) => api.delete(`/admin/members/registration-pending?email=${encodeURIComponent(email)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "registration-pending"] }),
  });
  const [sentTo, setSentTo] = useState<string | null>(null);
  const list = data?.data ?? [];
  if (list.length === 0) return null;
  return (
    <div className="card-paper p-4 mb-4" style={{ border: "1.5px solid rgba(212,160,59,0.45)" }}>
      <h2 className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink-800)" }}>
        📧 登録の途中の方（{list.length}名）
      </h2>
      <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
        登録を始めたものの、確認メールのリンクをまだ開いていない方です。リンクが開かれると、承認待ちとして下の一覧に表示されます。
        メールが届いていない・見落としている可能性があるので、ご本人へ声をかけるか、確認メールを再送してください。
      </p>
      <div className="flex flex-col gap-2">
        {list.map((r) => (
          <div key={r.email} className="flex items-center gap-2 flex-wrap rounded-xl px-3 py-2" style={{ background: "var(--color-paper-100)" }}>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>
                {r.name ?? "（お名前は未入力・保存なし）"}
              </div>
              <div className="text-xs truncate" style={{ color: "var(--color-ink-500)" }}>{r.email}</div>
              <div className="text-xs" style={{ color: "var(--color-ink-400)" }}>
                {fmtDateTimeFull(r.requestedAt, tz)} にメール送信　
                <span style={{ color: r.linkOpened ? "var(--color-brand)" : "var(--color-accent)", fontWeight: 600 }}>
                  {r.linkOpened ? "リンクは開かれたが登録は未完了" : "リンク未開封"}
                </span>
              </div>
            </div>
            {r.hasDraft && r.linkOpened && (
              <button
                onClick={() => { if (confirm(`${r.name ?? r.email} さんの登録を、入力内容のまま完了します（承認待ちに追加されます）。よろしいですか？`)) complete.mutate(r.email); }}
                disabled={complete.isPending}
                className="px-3 py-1.5 rounded-full text-xs font-medium text-white disabled:opacity-50"
                style={{ background: "var(--color-brand)" }}>
                {complete.isPending && complete.variables === r.email ? "登録中..." : "登録を完了させる"}
              </button>
            )}
            {r.hasDraft && !r.linkOpened && (
              <button onClick={() => resend.mutate(r.email, { onSuccess: () => setSentTo(r.email) })} disabled={resend.isPending}
                className="px-3 py-1.5 rounded-full text-xs font-medium disabled:opacity-50"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
                {sentTo === r.email ? "再送しました" : "確認メールを再送"}
              </button>
            )}
            <button onClick={() => { if (confirm(`${r.name ?? r.email} さんを、この一覧から外します（入力内容も削除されます）。よろしいですか？`)) dismiss.mutate(r.email); }}
              disabled={dismiss.isPending} className="px-3 py-1.5 rounded-full text-xs font-medium disabled:opacity-50"
              style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
              一覧から外す
            </button>
          </div>
        ))}
      </div>
      {complete.isError && <p className="text-xs mt-2 break-all" style={{ color: "var(--color-brand)" }}>{(complete.error as Error).message}</p>}
      {resend.isError && <p className="text-xs mt-2" style={{ color: "var(--color-brand)" }}>{(resend.error as Error).message}</p>}
    </div>
  );
}

export function AdminMembersScreen() {
  const qc = useQueryClient();
  const { timezone: tz, termEnishi } = useSettings();
  const [filter, setFilter] = useState<"all" | "pending" | "active" | "guest" | "on_leave" | "rejected">("all");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailMemberId, setDetailMemberId] = useState<string | null>(null);
  const [emailEditMemberId, setEmailEditMemberId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [joinedRange, setJoinedRange] = useState<JoinedRange>(EMPTY_JOINED_RANGE);

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
  const byStatus = filter === "all"
    ? members.filter((m) => !SIDE_STATUSES.includes(m.status))
    : members.filter((m) => m.status === filter);
  // キーワード（名前・ふりがな・メール・会社・役職・職種・事業内容・スキル名。スペース区切り=AND、OR・括弧にも対応）と入会日の範囲で絞り込む
  const filtered = byStatus.filter((m) =>
    matchesSearchQuery(
      [m.name, m.furigana, m.romaji, m.email, m.company, m.role, m.category, m.businessDescription, m.phone, ...(m.skills ?? []).map((sk) => sk.name)],
      search
    ) && inJoinedRange(m.businessCommunityJoinedDate, joinedRange)
  );
  const isSearching = search.trim() !== "" || isJoinedRangeActive(joinedRange);

  const pendingCount = members.filter((m) => m.status === "pending").length;
  // 各タブの人数（検索条件にかかわらず、そのステータスの全員）
  const tabCount = (f: typeof filter): number =>
    f === "all" ? members.filter((m) => !SIDE_STATUSES.includes(m.status)).length : members.filter((m) => m.status === f).length;

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-24">
      <div className="flex items-baseline gap-3 flex-wrap mb-1">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
        👥 メンバー管理
        </h1>
        {!isLoading && (
          <span className="text-sm font-semibold px-3 py-1 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
            表示中 {filtered.length} 名{isSearching ? `（このタブの ${byStatus.length} 名中）` : ""}
          </span>
        )}
      </div>
      {pendingCount > 0 && (
        <div className="mb-4 px-4 py-2 rounded-2xl text-sm font-medium text-white"
          style={{ background: "var(--color-brand)" }}>
          ⚠️ 承認待ちのメンバーが {pendingCount} 名います
        </div>
      )}

      <PendingRegistrationsSection tz={tz} />

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
            {!isLoading && <span className="ml-1 text-xs">({tabCount(f)})</span>}
          </button>
        ))}
      </div>

      {/* キーワード検索・入会日の範囲 */}
      <div className="relative mb-3">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-ink-400)" }} />
        <input
          type="text" placeholder="名前・メール・会社・職種・事業内容・スキルで検索（スペース区切りで絞り込み）..."
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-2xl pl-9 pr-9 py-2.5 text-sm outline-none"
          style={{ background: "var(--color-paper-50)", border: "1.5px solid var(--color-paper-300)", color: "var(--color-ink-800)" }}
        />
        {search && (
          <button type="button" onClick={() => setSearch("")} aria-label="検索条件をクリア"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full" style={{ color: "var(--color-ink-400)" }}>
            <X size={14} />
          </button>
        )}
      </div>
      <JoinedRangeFilter value={joinedRange} onChange={setJoinedRange} />

      {/* メンバー一覧 */}
      {isLoading ? (
        <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>読み込み中...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>
          {isSearching ? "条件に合うメンバーが見つかりませんでした"
            : filter === "pending" ? "承認待ちのメンバーはいません"
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
                    <div className="flex items-center gap-2 mt-0.5 min-w-0">
                      <span className="text-xs truncate" style={{ color: "var(--color-ink-400)" }}>{m.email}</span>
                      <button
                        onClick={() => setEmailEditMemberId(m.id)}
                        className="text-xs font-medium shrink-0 underline"
                        style={{ color: "var(--color-brand)" }}
                        title="メールアドレスを代行で変更します">
                        変更
                      </button>
                    </div>
                    {m.category && (
                      <div className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
                        {m.category}{m.company ? ` / ${m.company}` : ""}
                      </div>
                    )}
                    <div className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>
                      登録: {fmtDateISO(m.createdAt, tz)}{m.businessCommunityJoinedDate ? `　入会: ${m.businessCommunityJoinedDate.slice(0, 7).replace("-", "年")}月` : ""}
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
                    <button
                      onClick={() => setDetailMemberId(m.id)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs font-medium transition hover:opacity-80"
                      style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}
                      title="プロフィール・名刺情報・ポイントなど、メンバーの詳細を見る"
                    >
                      <Eye size={14} />
                      詳細
                    </button>
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

      {/* メンバー詳細 */}
      {emailEditMemberId && (() => {
        const target = members.find((x) => x.id === emailEditMemberId);
        return target ? (
          <AdminChangeEmailModal
            member={{ id: target.id, name: target.name, email: target.email }}
            onClose={() => setEmailEditMemberId(null)}
            onDone={() => { setEmailEditMemberId(null); qc.invalidateQueries({ queryKey: ["admin", "members"] }); }}
          />
        ) : null;
      })()}
      {detailMemberId && (() => {
        const target = members.find((x) => x.id === detailMemberId);
        return target ? <AdminMemberDetailModal member={target} onClose={() => setDetailMemberId(null)} /> : null;
      })()}

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
