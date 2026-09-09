// =============================================================
// 1to1 管理画面
// 自分の申込・受け取った申込・完了記録をまとめて表示
// =============================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, Clock, CheckCircle, Loader2, Users, Camera, Calendar, Link2, Pencil } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useTimezone } from "@/hooks/use-timezone";
import { fmtDateISO, fmtDateTimeFull, fmtTime } from "@/lib/date";
import { ImportCardModal } from "./import-card-modal";
import { CompleteOneOnOneModal } from "../meetings/_complete-oneonone-modal";
import { EditOneOnOneScheduleModal } from "../meetings/_edit-oneonone-schedule-modal";
import { AutoSchedulerShareLinkPanel } from "@/components/scheduler-share-link-panel";

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
  partner: {
    id: string;
    name: string;
    emoji: string;
    bgColor: string;
    category: string;
  } | null;
  requesterSchedulerUrl?: string | null;
  scheduledFor?: number | null;
  scheduledForEndUtc?: number | null;
  conferenceType?: string | null;
  conferenceUrl?: string | null;
  autoTransitionReason?: "pending_timeout" | "date_passed" | null;
};

type SessionsResponse = { data: Session[] };

export function OneOnOneScreen() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const tz = useTimezone();
  const [tab, setTab] = useState<"pending" | "active" | "done">("pending");
  const [showImport, setShowImport] = useState(false);
  const [completingSession, setCompletingSession] = useState<Session | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<Session | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["oneonone"],
    queryFn: () => api.get<SessionsResponse>("/oneonone"),
    // 外部の予約ページで日程確定してから戻ってきた直後でも必ず最新状態を取得する
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/oneonone/${id}/accept`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["oneonone"] });
      // 承諾すると「申込」タブからは消えるため、続きが見える「進行中」タブへ自動で移動する
      setTab("active");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/oneonone/${id}/reject`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["oneonone"] });
      // 辞退すると「申込」タブからは消えるため、結果が見える「完了」タブへ自動で移動する
      setTab("done");
    },
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/oneonone/${id}/complete`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["oneonone"] });
      qc.invalidateQueries({ queryKey: ["ranking", "me"] });
    },
  });

  const uncompleteMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/oneonone/${id}/uncomplete`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["oneonone"] });
      qc.invalidateQueries({ queryKey: ["ranking", "me"] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/oneonone/${id}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["oneonone"] });
    },
  });

  const sessions = data?.data ?? [];
  const myId = user?.id ?? "";

  // タブ振り分け
  const pendingReceived = sessions.filter(
    (s) => s.status === "pending" && s.myRole === "responder"
  );
  const pendingSent = sessions.filter(
    (s) => s.status === "pending" && s.myRole === "requester"
  );
  const active = sessions.filter((s) => s.status === "accepted");
  const done = sessions.filter((s) => s.status === "completed" || s.status === "rejected" || s.status === "cancelled");

  const pendingCount = pendingReceived.length;
  const activeCount = active.filter((s) => {
    const myCompleted = s.myRole === "requester" ? s.requesterCompletedAt : s.responderCompletedAt;
    return !myCompleted;
  }).length;

  const tabs = [
    { key: "pending" as const, label: "申込", badge: pendingCount },
    { key: "active" as const,  label: "進行中", badge: activeCount },
    { key: "done" as const,    label: "完了", badge: 0 },
  ];

  return (
    <div className="px-4 py-6 max-w-xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          🤝 1to1
        </h1>
        {/* カード画像から登録ボタン */}
        <button
          onClick={() => setShowImport(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-medium transition hover:opacity-80 active:opacity-70"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)", border: "1.5px solid var(--color-paper-300)" }}
        >
          <Camera size={14} />
          カード画像から登録
        </button>
      </div>

      {/* タブ */}
      <div className="flex gap-2 mb-5">
        {tabs.map(({ key, label, badge }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="flex-1 py-2 rounded-2xl text-sm font-medium relative transition"
            style={{
              background: tab === key ? "var(--color-brand)" : "var(--color-paper-200)",
              color: tab === key ? "white" : "var(--color-ink-600)",
            }}
          >
            {label}
            {badge > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-white text-xs flex items-center justify-center font-bold"
                style={{ background: tab === key ? "var(--color-accent)" : "var(--color-brand)" }}
              >
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <Loader2 size={28} className="animate-spin mx-auto" style={{ color: "var(--color-brand)" }} />
        </div>
      ) : (
        <>
          {/* 申込タブ */}
          {tab === "pending" && (
            <div className="space-y-4">
              {pendingReceived.length > 0 && (
                <section>
                  <h2 className="text-xs font-semibold mb-2 px-1" style={{ color: "var(--color-brand)" }}>
                    📬 受け取った申込
                  </h2>
                  {pendingReceived.map((s) => {
                    // 相手（申込者）の予約ページで日程を選べる場合、日程選択＝承諾を意味するため、
                    // 別途「承諾する」ボタンは出さず「予約ページで日程を選ぶ」か「承諾しない」の2択にする
                    const canScheduleInstead = !s.scheduledFor && !!s.requesterSchedulerUrl;
                    return (
                      <SessionCard key={s.id} session={s} myId={myId} tz={tz}>
                        {s.scheduledFor ? (
                          <ScheduledInfo session={s} tz={tz} onEdit={() => setEditingSchedule(s)} />
                        ) : (
                          s.requesterSchedulerUrl && (
                            <a
                              href={s.requesterSchedulerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-3 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-sm font-medium"
                              style={{ background: "rgba(90,140,92,0.1)", color: "var(--color-success)", border: "1px solid rgba(90,140,92,0.25)" }}
                            >
                              <Calendar size={14} />
                              {s.partner?.name ?? "相手"}さんの予約ページで日程を選ぶ
                            </a>
                          )
                        )}
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => rejectMutation.mutate(s.id)}
                            disabled={rejectMutation.isPending || acceptMutation.isPending}
                            className="flex-1 py-2.5 rounded-2xl text-sm font-medium flex items-center justify-center gap-1"
                            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
                          >
                            <X size={14} />
                            {canScheduleInstead ? "承諾しない" : "断る"}
                          </button>
                          {!canScheduleInstead && (
                            <button
                              onClick={() => acceptMutation.mutate(s.id)}
                              disabled={acceptMutation.isPending || rejectMutation.isPending}
                              className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-1"
                              style={{ background: "var(--color-success)" }}
                            >
                              <Check size={14} />
                              承諾する
                            </button>
                          )}
                        </div>
                      </SessionCard>
                    );
                  })}
                </section>
              )}

              {pendingSent.length > 0 && (
                <section>
                  <h2 className="text-xs font-semibold mb-2 px-1" style={{ color: "var(--color-ink-500)" }}>
                    📤 送った申込（承諾待ち）
                  </h2>
                  {pendingSent.map((s) => (
                    <SessionCard key={s.id} session={s} myId={myId} tz={tz}>
                      {s.scheduledFor ? (
                        <ScheduledInfo session={s} tz={tz} onEdit={() => setEditingSchedule(s)} />
                      ) : (
                        <div className="mt-3 p-3 rounded-2xl" style={{ background: "rgba(90,140,92,0.08)", border: "1px solid rgba(90,140,92,0.2)" }}>
                          <p className="text-xs font-medium mb-1.5" style={{ color: "var(--color-success)" }}>
                            📅 あなたの予約URL（{s.partner?.name ?? "相手"}さんに直接共有できます）
                          </p>
                          <AutoSchedulerShareLinkPanel />
                        </div>
                      )}
                      <div className="mt-2 flex items-center gap-1 text-xs" style={{ color: "var(--color-ink-400)" }}>
                        <Clock size={12} />
                        相手の承諾を待っています
                      </div>
                      <button
                        onClick={() => { if (confirm("この1to1申込をキャンセルしますか？")) cancelMutation.mutate(s.id); }}
                        disabled={cancelMutation.isPending}
                        className="w-full mt-2 py-2 rounded-2xl text-xs font-medium transition disabled:opacity-50"
                        style={{ background: "transparent", color: "var(--color-ink-400)", border: "1px solid var(--color-paper-300)" }}
                      >
                        {cancelMutation.isPending ? <Loader2 size={12} className="animate-spin inline mr-1" /> : null}
                        申込をキャンセルする
                      </button>
                    </SessionCard>
                  ))}
                </section>
              )}

              {pendingReceived.length === 0 && pendingSent.length === 0 && (
                <EmptyState icon="📭" message="申込はありません" sub="メンバー詳細から1to1を申し込めます" />
              )}
            </div>
          )}

          {/* 進行中タブ */}
          {tab === "active" && (
            <div className="space-y-3">
              {active.length === 0 ? (
                <EmptyState icon="🤝" message="進行中の1to1はありません" sub="承諾されると「進行中」に移ります" />
              ) : (
                active.map((s) => {
                  const myCompleted = s.myRole === "requester" ? s.requesterCompletedAt : s.responderCompletedAt;
                  const partnerCompleted = s.myRole === "requester" ? s.responderCompletedAt : s.requesterCompletedAt;
                  return (
                    <SessionCard key={s.id} session={s} myId={myId} tz={tz}>
                      {s.scheduledFor ? (
                        <ScheduledInfo session={s} tz={tz} onEdit={() => setEditingSchedule(s)} />
                      ) : (
                        <button
                          onClick={() => setEditingSchedule(s)}
                          className="mt-3 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium"
                          style={{ background: "rgba(212,160,59,0.18)", color: "var(--color-ink-700)", border: "1px solid rgba(212,160,59,0.4)" }}
                        >
                          <Calendar size={13} />
                          日時・会議URLを入力する（別途調整済みの場合）
                        </button>
                      )}
                      <div className="mt-3 space-y-2">
                        {/* 自分の完了状態 */}
                        <div className="flex items-center gap-2 text-xs">
                          {myCompleted ? (
                            <><CheckCircle size={14} style={{ color: "var(--color-success)" }} /><span style={{ color: "var(--color-success)" }}>あなたは完了済み</span></>
                          ) : (
                            <><Clock size={14} style={{ color: "var(--color-ink-400)" }} /><span style={{ color: "var(--color-ink-500)" }}>あなたはまだ未完了</span></>
                          )}
                        </div>
                        {/* 相手の完了状態 */}
                        <div className="flex items-center gap-2 text-xs">
                          {partnerCompleted ? (
                            <><CheckCircle size={14} style={{ color: "var(--color-success)" }} /><span style={{ color: "var(--color-success)" }}>{s.partner?.name}さんは完了済み</span></>
                          ) : (
                            <><Clock size={14} style={{ color: "var(--color-ink-400)" }} /><span style={{ color: "var(--color-ink-500)" }}>{s.partner?.name}さんはまだ未完了</span></>
                          )}
                        </div>
                        {/* 完了ボタン */}
                        {!myCompleted && (
                          <button
                            onClick={() => {
                              if (s.partner) setCompletingSession(s);
                              else completeMutation.mutate(s.id);
                            }}
                            disabled={completeMutation.isPending}
                            className="w-full mt-1 py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-50"
                            style={{ background: "var(--color-brand)" }}
                          >
                            {completeMutation.isPending ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Check size={14} />
                            )}
                            1to1 完了を記録する
                          </button>
                        )}
                        {myCompleted && !partnerCompleted && (
                          <p className="text-xs text-center py-2" style={{ color: "var(--color-ink-400)" }}>
                            相手が完了を記録すると +1pt が双方に加算されます
                          </p>
                        )}
                      </div>
                    </SessionCard>
                  );
                })
              )}
            </div>
          )}

          {/* 完了タブ */}
          {tab === "done" && (
            <div className="space-y-3">
              {done.length === 0 ? (
                <EmptyState icon="📋" message="完了した1to1はありません" sub="" />
              ) : (
                done.map((s) => {
                  const myCompletedAt = s.myRole === "requester" ? s.requesterCompletedAt : s.responderCompletedAt;
                  return (
                    <SessionCard key={s.id} session={s} myId={myId} tz={tz}>
                      <div className="mt-2 space-y-2">
                        {s.status === "completed" ? (
                          <>
                            <div className="flex items-center gap-1 text-xs">
                              <CheckCircle size={12} style={{ color: "var(--color-success)" }} />
                              <span style={{ color: "var(--color-success)" }}>
                                完了 — {s.completedAt ? fmtDateISO(s.completedAt, tz) : ""}
                                {s.autoTransitionReason === "date_passed" && "（実施日から1週間経過し自動完了）"}
                              </span>
                            </div>
                            {myCompletedAt && (
                              <button
                                onClick={() => uncompleteMutation.mutate(s.id)}
                                disabled={uncompleteMutation.isPending}
                                className="w-full py-2 rounded-2xl text-xs font-medium transition disabled:opacity-50"
                                style={{ background: "transparent", color: "var(--color-ink-400)", border: "1px solid var(--color-paper-300)" }}
                              >
                                完了を取り消す
                              </button>
                            )}
                          </>
                        ) : (
                          <div className="flex items-center gap-1 text-xs">
                            <X size={12} style={{ color: "var(--color-ink-400)" }} />
                            <span style={{ color: "var(--color-ink-400)" }}>
                              {s.status === "cancelled" ? "キャンセル済み" : "辞退済み"}
                            </span>
                          </div>
                        )}
                      </div>
                    </SessionCard>
                  );
                })
              )}
            </div>
          )}
        </>
      )}

      {/* カード画像インポートモーダル */}
      {showImport && (
        <ImportCardModal onClose={() => setShowImport(false)} />
      )}

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
          currentScheduledFor={editingSchedule.scheduledFor ?? null}
          currentConferenceUrl={editingSchedule.conferenceUrl ?? null}
          onClose={() => setEditingSchedule(null)}
        />
      )}
    </div>
  );
}

// ---- セッションカード ----
function SessionCard({ session, tz, children }: {
  session: Session;
  myId?: string;
  tz?: string;
  children?: React.ReactNode;
}) {
  const partner = session.partner;
  const requestedDate = fmtDateISO(session.requestedAt, tz ?? "Asia/Tokyo").slice(5).replace("/", "/");

  return (
    <div className="card-paper rounded-3xl p-4">
      <div className="flex items-center gap-3">
        {partner ? (
          <>
            <Link to={`/members/${partner.id}`} className="shrink-0">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl ${partner.bgColor}`}>
                {partner.emoji}
              </div>
            </Link>
            <div className="flex-1 min-w-0">
              <Link to={`/members/${partner.id}`}>
                <p className="font-semibold truncate" style={{ color: "var(--color-ink-800)" }}>{partner.name}</p>
              </Link>
              <p className="text-xs truncate" style={{ color: "var(--color-ink-500)" }}>
                {partner.category}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>
                {session.myRole === "requester" ? "あなたから申込" : `${partner.name}さんから申込`} · {requestedDate}
              </p>
            </div>
          </>
        ) : (
          <div className="flex-1">
            <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>（メンバー情報なし）</p>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// ---- 確定済み日時・会議URL表示 ----
function ScheduledInfo({ session, tz, onEdit }: { session: Session; tz?: string; onEdit?: () => void }) {
  const label = session.conferenceType === "zoom" ? "Zoom" : session.conferenceType === "google_meet" ? "Google Meet" : "会議";
  return (
    <div className="mt-3 p-3 rounded-2xl" style={{ background: "rgba(90,140,92,0.08)", border: "1px solid rgba(90,140,92,0.2)" }}>
      <p className="text-xs font-medium flex items-center gap-1.5" style={{ color: "var(--color-success)" }}>
        <Calendar size={13} />
        日程確定: {fmtDateTimeFull(session.scheduledFor ?? 0, tz ?? "Asia/Tokyo")}
        {session.scheduledForEndUtc && `〜${fmtTime(session.scheduledForEndUtc, tz ?? "Asia/Tokyo")}`}
      </p>
      {session.conferenceUrl && (
        <a
          href={session.conferenceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs mt-1.5 font-medium underline underline-offset-2 flex items-center gap-1.5 break-all"
          style={{ color: "var(--color-brand)" }}
        >
          <Link2 size={13} className="shrink-0" />
          {label} URL: {session.conferenceUrl}
        </a>
      )}
      {onEdit && (
        <button onClick={onEdit} className="text-xs mt-1.5 flex items-center gap-1" style={{ color: "var(--color-ink-400)" }}>
          <Pencil size={11} />
          編集
        </button>
      )}
    </div>
  );
}

// ---- 空状態 ----
function EmptyState({ icon, message, sub }: { icon: string; message: string; sub: string }) {
  return (
    <div className="text-center py-14">
      <div className="text-5xl mb-3">{icon}</div>
      <p className="font-medium" style={{ color: "var(--color-ink-600)" }}>{message}</p>
      {sub && <p className="text-sm mt-1" style={{ color: "var(--color-ink-400)" }}>{sub}</p>}
      {message.includes("申込") && (
        <Link to="/members"
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-medium text-white"
          style={{ background: "var(--color-brand)" }}>
          <Users size={14} />
          なかまを探す
        </Link>
      )}
    </div>
  );
}
