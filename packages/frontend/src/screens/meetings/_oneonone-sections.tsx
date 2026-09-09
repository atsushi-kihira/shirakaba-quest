// =============================================================
// 1to1（メンバー向け）共通セクション
// 「進行中の1to1申込」「1to1の記録」— ミーティング画面・1to1ミーティング画面で共用
// =============================================================
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, Loader2, Check, X, Calendar, CheckCircle, Clock, Pencil } from "lucide-react";
import { api } from "@/lib/api";
import { useTimezone } from "@/hooks/use-timezone";
import { fmtDateISO, fmtDateTimeFull, fmtTime } from "@/lib/date";
import {
  useOneOnOneSessions,
  filterInFlightOneOnOne,
  type OneOnOneSession,
} from "@/hooks/use-oneonone-status";
import { CompleteOneOnOneModal } from "./_complete-oneonone-modal";
import { EditOneOnOneScheduleModal } from "./_edit-oneonone-schedule-modal";
import { AutoSchedulerShareLinkPanel } from "@/components/scheduler-share-link-panel";

type Period = "1m" | "6m" | "1y" | "all";
const PERIOD_LABELS: Record<Period, string> = { "1m": "直近1ヶ月", "6m": "直近6ヶ月", "1y": "直近1年", all: "すべて" };
const PERIOD_DAYS: Record<Period, number | null> = { "1m": 30, "6m": 182, "1y": 365, all: null };

// ----------------------------------------------------------------
// 進行中の1to1申込（申込中・承諾済み）
// 同じ相手と複数同時に進行中でも構わないが、ここで一覧管理・キャンセルできるようにする
// ----------------------------------------------------------------
export function InProgressOneOnOneSection() {
  const qc = useQueryClient();
  const tz = useTimezone();
  const [completingSession, setCompletingSession] = useState<OneOnOneSession | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<OneOnOneSession | null>(null);
  const { data, isLoading } = useOneOnOneSessions();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["oneonone"] });
    qc.invalidateQueries({ queryKey: ["members"] });
    qc.invalidateQueries({ queryKey: ["ranking", "me"] });
  };

  const acceptMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/oneonone/${id}/accept`),
    onSuccess: invalidate,
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/oneonone/${id}/reject`),
    onSuccess: invalidate,
  });
  const completeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/oneonone/${id}/complete`),
    onSuccess: invalidate,
  });
  const removeMutation = useMutation({
    mutationFn: async (s: OneOnOneSession) => {
      // pending かつ自分が responder の場合は「断る」、それ以外は「キャンセル」してから削除する
      if (s.status === "pending" && s.myRole === "responder") {
        await api.patch(`/oneonone/${s.id}/reject`);
      } else {
        await api.patch(`/oneonone/${s.id}/cancel`);
      }
      await api.delete(`/oneonone/${s.id}`);
    },
    onSuccess: invalidate,
  });

  const inProgress = filterInFlightOneOnOne(data?.data ?? [])
    .sort((a, b) => b.requestedAt - a.requestedAt);

  if (isLoading || inProgress.length === 0) return null;

  return (
    <div>
      <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--color-ink-700)" }}>⏳ 進行中の1to1申込</h2>
      <p className="text-xs mb-3" style={{ color: "var(--color-ink-400)" }}>
        申込中・承諾済みで、まだ完了していない1to1です。不要な場合は削除してください。
      </p>
      <div className="space-y-2">
        {inProgress.map((s) => {
          const isPendingForMe = s.status === "pending" && s.myRole === "responder";
          const iAmResponder = s.myRole === "responder";
          const iAmRequester = s.myRole === "requester";
          // 相手（申込者）の予約ページで日程を選べる場合、日程選択＝承諾を意味するため、
          // 別途「承諾する」ボタンは出さず「予約ページで日程を選ぶ」か「承諾しない」の2択にする
          const canScheduleInstead = isPendingForMe && !s.scheduledFor && !!s.requesterSchedulerUrl;
          const statusLabel = s.status === "pending"
            ? (s.myRole === "requester" ? "📨 相手の承諾待ち" : "📨 あなたの承諾待ち")
            : "🤝 進行中（完了待ち）";
          const myCompleted = s.myRole === "requester" ? s.requesterCompletedAt : s.responderCompletedAt;
          const partnerCompleted = s.myRole === "requester" ? s.responderCompletedAt : s.requesterCompletedAt;

          return (
            <div key={s.id} className="px-3 py-2.5 rounded-2xl" style={{ background: "rgba(212,160,59,0.1)" }}>
              <div className="flex items-center gap-3">
                <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-lg shrink-0 ${s.partner?.bgColor ?? "bg-stone-200"}`}>
                  {s.partner?.emoji ?? "🙂"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>
                    {s.partner?.name ?? "（メンバー情報なし）"}
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
                    {statusLabel} ・ {fmtDateISO(s.requestedAt, tz)}申込
                  </p>
                  {s.scheduledFor ? (
                    <>
                      <p className="text-xs mt-0.5 font-medium" style={{ color: "var(--color-success)" }}>
                        📅 確定日時: {fmtDateTimeFull(s.scheduledFor, tz)}
                        {s.scheduledForEndUtc && `〜${fmtTime(s.scheduledForEndUtc, tz)}`}
                      </p>
                      {s.conferenceUrl && (
                        <a
                          href={s.conferenceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs mt-0.5 font-medium underline underline-offset-2 block truncate"
                          style={{ color: "var(--color-brand)" }}
                        >
                          🔗 会議URL: {s.conferenceUrl}
                        </a>
                      )}
                      <button
                        onClick={() => setEditingSchedule(s)}
                        className="text-xs mt-1 flex items-center gap-1"
                        style={{ color: "var(--color-ink-400)" }}
                      >
                        <Pencil size={11} />
                        日時・会議URLを編集
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setEditingSchedule(s)}
                      className="mt-1.5 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium"
                      style={{ background: "rgba(212,160,59,0.18)", color: "var(--color-ink-700)", border: "1px solid rgba(212,160,59,0.4)" }}
                    >
                      <Pencil size={12} />
                      日時・会議URLを入力する（別途調整済みの場合）
                    </button>
                  )}
                </div>
                <button
                  onClick={() => { if (confirm("この1to1申込を取り消して削除しますか？")) removeMutation.mutate(s); }}
                  disabled={removeMutation.isPending}
                  className="p-2 rounded-xl active:opacity-70 transition disabled:opacity-40"
                  style={{ color: "var(--color-ink-400)" }}
                  aria-label="削除"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* 予約リンク：自分が回答者の間はずっと表示する（承諾後も日程調整に使えるように） */}
              {iAmResponder && s.requesterSchedulerUrl && !s.scheduledFor && (
                <div className="mt-2.5">
                  <a
                    href={s.requesterSchedulerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 py-2 rounded-2xl text-sm font-medium"
                    style={{ background: "rgba(90,140,92,0.1)", color: "var(--color-success)", border: "1px solid rgba(90,140,92,0.25)" }}
                  >
                    <Calendar size={14} />
                    {s.partner?.name ?? "相手"}さんの予約ページで日程を選ぶ
                  </a>
                </div>
              )}

              {/* 自分の申込で相手の承諾待ちの場合：あなたの予約URLを共有できるようにする（日程が決まっていない間のみ） */}
              {iAmRequester && s.status === "pending" && !s.scheduledFor && (
                <div className="mt-2.5 p-3 rounded-2xl" style={{ background: "rgba(90,140,92,0.08)", border: "1px solid rgba(90,140,92,0.2)" }}>
                  <p className="text-xs font-medium mb-1.5" style={{ color: "var(--color-success)" }}>
                    📅 あなたの予約URL（{s.partner?.name ?? "相手"}さんに直接共有できます）
                  </p>
                  <AutoSchedulerShareLinkPanel />
                </div>
              )}

              {/* 相手からの申込で回答待ちの場合：承諾/辞退（予約ページで選べる場合は「承諾しない」のみ） */}
              {isPendingForMe && (
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => rejectMutation.mutate(s.id)}
                    disabled={rejectMutation.isPending || acceptMutation.isPending}
                    className="flex-1 py-2 rounded-2xl text-sm font-medium flex items-center justify-center gap-1"
                    style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
                  >
                    <X size={14} />
                    {canScheduleInstead ? "承諾しない" : "断る"}
                  </button>
                  {!canScheduleInstead && (
                    <button
                      onClick={() => acceptMutation.mutate(s.id)}
                      disabled={acceptMutation.isPending || rejectMutation.isPending}
                      className="flex-1 py-2 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-1"
                      style={{ background: "var(--color-success)" }}
                    >
                      <Check size={14} />
                      承諾する
                    </button>
                  )}
                </div>
              )}

              {/* 承諾済み：完了ボタン・お互いの完了状況 */}
              {s.status === "accepted" && (
                <div className="mt-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs">
                    {myCompleted ? (
                      <><CheckCircle size={12} style={{ color: "var(--color-success)" }} /><span style={{ color: "var(--color-success)" }}>あなたは完了済み</span></>
                    ) : (
                      <><Clock size={12} style={{ color: "var(--color-ink-400)" }} /><span style={{ color: "var(--color-ink-500)" }}>あなたはまだ未完了</span></>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    {partnerCompleted ? (
                      <><CheckCircle size={12} style={{ color: "var(--color-success)" }} /><span style={{ color: "var(--color-success)" }}>{s.partner?.name ?? "相手"}さんは完了済み</span></>
                    ) : (
                      <><Clock size={12} style={{ color: "var(--color-ink-400)" }} /><span style={{ color: "var(--color-ink-500)" }}>{s.partner?.name ?? "相手"}さんはまだ未完了</span></>
                    )}
                  </div>
                  {!myCompleted && (
                    <button
                      onClick={() => {
                        if (s.partner) setCompletingSession(s);
                        else completeMutation.mutate(s.id);
                      }}
                      disabled={completeMutation.isPending}
                      className="w-full mt-1 py-2.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
                      style={{ background: "var(--color-brand)" }}
                    >
                      {completeMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      1to1 完了を記録する
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {completingSession && completingSession.partner && (
        <CompleteOneOnOneModal
          sessionId={completingSession.id}
          partnerId={completingSession.partner.id}
          partnerName={completingSession.partner.name}
          onClose={() => setCompletingSession(null)}
        />
      )}

      {editingSchedule && (
        <EditOneOnOneScheduleModal
          sessionId={editingSchedule.id}
          currentScheduledFor={editingSchedule.scheduledFor}
          currentConferenceUrl={editingSchedule.conferenceUrl ?? null}
          onClose={() => setEditingSchedule(null)}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// 1to1の記録（完了済みのみ。キャンセル・未完了は表示しない）
// ----------------------------------------------------------------
export function OneOnOneHistorySection() {
  const qc = useQueryClient();
  const tz = useTimezone();
  const [period, setPeriod] = useState<Period>("1m");
  const { data, isLoading } = useOneOnOneSessions();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/oneonone/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["oneonone"] });
      qc.invalidateQueries({ queryKey: ["members"] });
    },
  });

  const completed = (data?.data ?? []).filter((s) => s.status === "completed" && s.completedAt);
  const days = PERIOD_DAYS[period];
  const cutoff = days ? Math.floor(Date.now() / 1000) - days * 86400 : null;
  const filtered = completed
    .filter((s) => cutoff === null || (s.completedAt ?? 0) >= cutoff)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  return (
    <div>
      <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--color-ink-700)" }}>🤝 1to1の記録</h2>

      <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className="px-3 py-1.5 rounded-2xl text-xs font-medium whitespace-nowrap transition"
            style={{
              background: period === p ? "var(--color-brand)" : "var(--color-paper-200)",
              color: period === p ? "white" : "var(--color-ink-600)",
            }}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 size={18} className="animate-spin" style={{ color: "var(--color-brand)" }} />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-sm py-6" style={{ color: "var(--color-ink-400)" }}>この期間の1to1記録はありません</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl" style={{ background: "var(--color-paper-200)" }}>
              <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-lg shrink-0 ${s.partner?.bgColor ?? "bg-stone-200"}`}>
                {s.partner?.emoji ?? "🙂"}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>
                  {s.partner?.name ?? "（メンバー情報なし）"}
                </p>
                <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
                  {s.completedAt ? fmtDateISO(s.completedAt, tz) : ""} 完了
                  {s.autoTransitionReason === "date_passed" && "（自動）"}
                </p>
              </div>
              <button
                onClick={() => { if (confirm("この1to1記録を削除しますか？")) deleteMutation.mutate(s.id); }}
                disabled={deleteMutation.isPending}
                className="p-2 rounded-xl active:opacity-70 transition disabled:opacity-40"
                style={{ color: "var(--color-ink-400)" }}
                aria-label="削除"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
