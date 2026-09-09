// =============================================================
// 1to1 セッション詳細画面（1件のみ）
// ホーム画面の「直近の1to1予約」から遷移し、会議URLだけでなく
// 完了記録・キャンセルなど「進行中の1to1申込」と同等の操作をその場で行えるようにする
// =============================================================
import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Check, X, Clock, CheckCircle, Loader2, Calendar, Link2, Pencil } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useTimezone } from "@/hooks/use-timezone";
import { fmtDateISO } from "@/lib/date";
import { CompleteOneOnOneModal } from "../meetings/_complete-oneonone-modal";
import { EditOneOnOneScheduleModal } from "../meetings/_edit-oneonone-schedule-modal";

type Session = {
  id: string;
  requesterId: string;
  responderId: string;
  status: "pending" | "accepted" | "completed" | "rejected" | "cancelled";
  requestedAt: number;
  completedAt: number | null;
  requesterCompletedAt: number | null;
  responderCompletedAt: number | null;
  myRole: "requester" | "responder";
  partner: { id: string; name: string; emoji: string; bgColor: string; category: string } | null;
  requesterSchedulerUrl?: string | null;
  scheduledFor?: number | null;
  conferenceType?: string | null;
  conferenceUrl?: string | null;
  autoTransitionReason?: "pending_timeout" | "date_passed" | null;
};

type SessionsResponse = { data: Session[] };

export function OneOnOneSessionDetailScreen() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tz = useTimezone();
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [showComplete, setShowComplete] = useState(false);
  const [showEditSchedule, setShowEditSchedule] = useState(false);

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }

  const { data, isLoading } = useQuery({
    queryKey: ["oneonone"],
    queryFn: () => api.get<SessionsResponse>("/oneonone"),
    refetchOnMount: "always",
  });

  const session = (data?.data ?? []).find((s) => s.id === sessionId) ?? null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["oneonone"] });
    qc.invalidateQueries({ queryKey: ["scheduler", "bookings", "upcoming"] });
    qc.invalidateQueries({ queryKey: ["ranking", "me"] });
  };

  const acceptMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/oneonone/${id}/accept`),
    onSuccess: () => { invalidate(); showToast("承諾しました", true); },
    onError: (e) => showToast(e instanceof ApiError ? e.message : "エラーが発生しました", false),
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/oneonone/${id}/reject`),
    onSuccess: () => { invalidate(); navigate("/oneonone"); },
    onError: (e) => showToast(e instanceof ApiError ? e.message : "エラーが発生しました", false),
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/oneonone/${id}/cancel`),
    onSuccess: () => { invalidate(); navigate("/oneonone"); },
    onError: (e) => showToast(e instanceof ApiError ? e.message : "エラーが発生しました", false),
  });
  const completeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/oneonone/${id}/complete`),
    onSuccess: () => invalidate(),
    onError: (e) => showToast(e instanceof ApiError ? e.message : "エラーが発生しました", false),
  });
  const uncompleteMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/oneonone/${id}/uncomplete`),
    onSuccess: () => { invalidate(); showToast("完了を取り消しました", true); },
    onError: (e) => showToast(e instanceof ApiError ? e.message : "エラーが発生しました", false),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-64">
        <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="px-4 py-6 max-w-lg mx-auto pb-24 text-center">
        <p className="text-sm py-10" style={{ color: "var(--color-ink-500)" }}>この1to1は見つかりませんでした</p>
        <Link to="/oneonone" className="text-sm font-medium" style={{ color: "var(--color-brand)" }}>1to1一覧に戻る →</Link>
      </div>
    );
  }

  const partner = session.partner;
  const myCompleted = session.myRole === "requester" ? session.requesterCompletedAt : session.responderCompletedAt;
  const partnerCompleted = session.myRole === "requester" ? session.responderCompletedAt : session.requesterCompletedAt;
  const isPendingForMe = session.status === "pending" && session.myRole === "responder";
  const canScheduleInstead = isPendingForMe && !session.scheduledFor && !!session.requesterSchedulerUrl;
  const conferenceLabel = session.conferenceType === "zoom" ? "Zoom" : session.conferenceType === "google_meet" ? "Google Meet" : "会議";

  return (
    <div className="px-4 py-6 max-w-lg mx-auto pb-24">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => navigate(-1)} className="p-2 rounded-2xl hover:opacity-70"
          style={{ background: "var(--color-paper-200)" }}>
          <ChevronLeft size={18} style={{ color: "var(--color-ink-600)" }} />
        </button>
        <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          🤝 1to1の詳細
        </h1>
      </div>

      <div className="card-paper rounded-3xl p-4">
        <div className="flex items-center gap-3">
          {partner ? (
            <>
              <Link to={`/members/${partner.id}`} className="shrink-0">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl ${partner.bgColor}`}>
                  {partner.emoji}
                </div>
              </Link>
              <div className="flex-1 min-w-0">
                <Link to={`/members/${partner.id}`}>
                  <p className="font-semibold truncate" style={{ color: "var(--color-ink-800)" }}>{partner.name}</p>
                </Link>
                <p className="text-xs truncate" style={{ color: "var(--color-ink-500)" }}>{partner.category}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>
                  {session.myRole === "requester" ? "あなたから申込" : `${partner.name}さんから申込`} · {fmtDateISO(session.requestedAt, tz)}
                </p>
              </div>
            </>
          ) : (
            <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>（メンバー情報なし）</p>
          )}
        </div>

        {/* 日程・会議URL */}
        {session.scheduledFor ? (
          <div className="mt-3 p-3 rounded-2xl" style={{ background: "rgba(90,140,92,0.08)", border: "1px solid rgba(90,140,92,0.2)" }}>
            <p className="text-xs font-medium flex items-center gap-1.5" style={{ color: "var(--color-success)" }}>
              <Calendar size={13} />
              日程確定: {fmtDateISO(session.scheduledFor, tz)}
            </p>
            {session.conferenceUrl && (
              <a href={session.conferenceUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs mt-1.5 font-medium underline underline-offset-2 flex items-center gap-1.5 break-all"
                style={{ color: "var(--color-brand)" }}>
                <Link2 size={13} className="shrink-0" />
                {conferenceLabel} URL: {session.conferenceUrl}
              </a>
            )}
            {(session.status === "pending" || session.status === "accepted") && (
              <button onClick={() => setShowEditSchedule(true)} className="text-xs mt-1.5 flex items-center gap-1" style={{ color: "var(--color-ink-400)" }}>
                <Pencil size={11} />
                編集
              </button>
            )}
          </div>
        ) : (
          canScheduleInstead ? (
            <a href={session.requesterSchedulerUrl!} target="_blank" rel="noopener noreferrer"
              className="mt-3 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-sm font-medium"
              style={{ background: "rgba(90,140,92,0.1)", color: "var(--color-success)", border: "1px solid rgba(90,140,92,0.25)" }}>
              <Calendar size={14} />
              {partner?.name ?? "相手"}さんの予約ページで日程を選ぶ
            </a>
          ) : (session.status === "pending" || session.status === "accepted") && (
            <button onClick={() => setShowEditSchedule(true)}
              className="mt-3 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium"
              style={{ background: "rgba(212,160,59,0.18)", color: "var(--color-ink-700)", border: "1px solid rgba(212,160,59,0.4)" }}>
              <Calendar size={13} />
              日時・会議URLを入力する（別途調整済みの場合）
            </button>
          )
        )}

        {/* 申込中：承諾/辞退、または相手の承諾待ち */}
        {session.status === "pending" && (
          isPendingForMe ? (
            <div className="flex gap-2 mt-3">
              <button onClick={() => rejectMutation.mutate(session.id)}
                disabled={rejectMutation.isPending || acceptMutation.isPending}
                className="flex-1 py-2.5 rounded-2xl text-sm font-medium flex items-center justify-center gap-1"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                <X size={14} />
                {canScheduleInstead ? "承諾しない" : "断る"}
              </button>
              {!canScheduleInstead && (
                <button onClick={() => acceptMutation.mutate(session.id)}
                  disabled={acceptMutation.isPending || rejectMutation.isPending}
                  className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-1"
                  style={{ background: "var(--color-success)" }}>
                  <Check size={14} />
                  承諾する
                </button>
              )}
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-1 text-xs" style={{ color: "var(--color-ink-400)" }}>
              <Clock size={12} />
              相手の承諾を待っています
            </div>
          )
        )}

        {/* 承諾済み：完了ボタン・お互いの完了状況 */}
        {session.status === "accepted" && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              {myCompleted ? (
                <><CheckCircle size={14} style={{ color: "var(--color-success)" }} /><span style={{ color: "var(--color-success)" }}>あなたは完了済み</span></>
              ) : (
                <><Clock size={14} style={{ color: "var(--color-ink-400)" }} /><span style={{ color: "var(--color-ink-500)" }}>あなたはまだ未完了</span></>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs">
              {partnerCompleted ? (
                <><CheckCircle size={14} style={{ color: "var(--color-success)" }} /><span style={{ color: "var(--color-success)" }}>{partner?.name ?? "相手"}さんは完了済み</span></>
              ) : (
                <><Clock size={14} style={{ color: "var(--color-ink-400)" }} /><span style={{ color: "var(--color-ink-500)" }}>{partner?.name ?? "相手"}さんはまだ未完了</span></>
              )}
            </div>
            {!myCompleted && (
              <button
                onClick={() => { if (partner) setShowComplete(true); else completeMutation.mutate(session.id); }}
                disabled={completeMutation.isPending}
                className="w-full py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: "var(--color-brand)" }}>
                {completeMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                1to1 完了を記録する
              </button>
            )}
            {myCompleted && !partnerCompleted && (
              <p className="text-xs text-center py-2" style={{ color: "var(--color-ink-400)" }}>
                相手が完了を記録すると +1pt が双方に加算されます
              </p>
            )}
            <button onClick={() => { if (confirm("この1to1をキャンセルしますか？")) cancelMutation.mutate(session.id); }}
              disabled={cancelMutation.isPending}
              className="w-full py-2 rounded-2xl text-xs font-medium disabled:opacity-50"
              style={{ background: "transparent", color: "var(--color-ink-400)", border: "1px solid var(--color-paper-300)" }}>
              この1to1をキャンセルする
            </button>
          </div>
        )}

        {/* 完了済み */}
        {session.status === "completed" && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-1 text-xs">
              <CheckCircle size={12} style={{ color: "var(--color-success)" }} />
              <span style={{ color: "var(--color-success)" }}>
                完了 — {session.completedAt ? fmtDateISO(session.completedAt, tz) : ""}
                {session.autoTransitionReason === "date_passed" && "（実施日から1週間経過し自動完了）"}
              </span>
            </div>
            {myCompleted && (
              <button onClick={() => uncompleteMutation.mutate(session.id)}
                disabled={uncompleteMutation.isPending}
                className="w-full py-2 rounded-2xl text-xs font-medium disabled:opacity-50"
                style={{ background: "transparent", color: "var(--color-ink-400)", border: "1px solid var(--color-paper-300)" }}>
                完了を取り消す
              </button>
            )}
          </div>
        )}

        {/* 辞退・キャンセル済み */}
        {(session.status === "rejected" || session.status === "cancelled") && (
          <div className="mt-3 flex items-center gap-1 text-xs" style={{ color: "var(--color-ink-400)" }}>
            <X size={12} />
            {session.status === "rejected" ? "辞退済み" : "キャンセル済み"}
            {session.autoTransitionReason === "pending_timeout" && "（1週間未回答のため自動キャンセル）"}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-2xl text-sm font-medium text-white z-50"
          style={{ background: toast.ok ? "var(--color-success)" : "var(--color-brand)" }}>
          {toast.msg}
        </div>
      )}

      {showComplete && partner && (
        <CompleteOneOnOneModal
          sessionId={session.id}
          partnerId={partner.id}
          partnerName={partner.name}
          onClose={() => setShowComplete(false)}
        />
      )}

      {showEditSchedule && (
        <EditOneOnOneScheduleModal
          sessionId={session.id}
          currentScheduledFor={session.scheduledFor ?? null}
          currentConferenceUrl={session.conferenceUrl ?? null}
          onClose={() => setShowEditSchedule(false)}
        />
      )}
    </div>
  );
}
