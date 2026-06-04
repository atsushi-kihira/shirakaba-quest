// =============================================================
// 1to1 管理画面
// 自分の申込・受け取った申込・完了記録をまとめて表示
// =============================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, Clock, CheckCircle, Loader2, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

type Session = {
  id: string;
  requesterId: string;
  responderId: string;
  status: "pending" | "accepted" | "completed" | "rejected";
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
};

type SessionsResponse = { data: Session[] };

export function OneOnOneScreen() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [tab, setTab] = useState<"pending" | "active" | "done">("pending");

  const { data, isLoading } = useQuery({
    queryKey: ["oneonone"],
    queryFn: () => api.get<SessionsResponse>("/oneonone"),
  });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/oneonone/${id}/accept`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["oneonone"] }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/oneonone/${id}/reject`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["oneonone"] }),
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/oneonone/${id}/complete`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["oneonone"] });
      qc.invalidateQueries({ queryKey: ["ranking", "me"] });
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
  const done = sessions.filter((s) => s.status === "completed" || s.status === "rejected");

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
      <h1 className="text-2xl font-semibold mb-4" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
        🤝 1to1
      </h1>

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
                  {pendingReceived.map((s) => (
                    <SessionCard key={s.id} session={s} myId={myId}>
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => rejectMutation.mutate(s.id)}
                          disabled={rejectMutation.isPending || acceptMutation.isPending}
                          className="flex-1 py-2.5 rounded-2xl text-sm font-medium flex items-center justify-center gap-1"
                          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
                        >
                          <X size={14} />
                          断る
                        </button>
                        <button
                          onClick={() => acceptMutation.mutate(s.id)}
                          disabled={acceptMutation.isPending || rejectMutation.isPending}
                          className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-1"
                          style={{ background: "var(--color-success)" }}
                        >
                          <Check size={14} />
                          承諾する
                        </button>
                      </div>
                    </SessionCard>
                  ))}
                </section>
              )}

              {pendingSent.length > 0 && (
                <section>
                  <h2 className="text-xs font-semibold mb-2 px-1" style={{ color: "var(--color-ink-500)" }}>
                    📤 送った申込（承諾待ち）
                  </h2>
                  {pendingSent.map((s) => (
                    <SessionCard key={s.id} session={s} myId={myId}>
                      <div className="mt-2 flex items-center gap-1 text-xs" style={{ color: "var(--color-ink-400)" }}>
                        <Clock size={12} />
                        相手の承諾を待っています
                      </div>
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
                    <SessionCard key={s.id} session={s} myId={myId}>
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
                            onClick={() => completeMutation.mutate(s.id)}
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
                done.map((s) => (
                  <SessionCard key={s.id} session={s} myId={myId}>
                    <div className="mt-2 flex items-center gap-1 text-xs">
                      {s.status === "completed" ? (
                        <><CheckCircle size={12} style={{ color: "var(--color-success)" }} />
                          <span style={{ color: "var(--color-success)" }}>完了 — {s.completedAt ? new Date(s.completedAt * 1000).toLocaleDateString("ja-JP") : ""}</span>
                        </>
                      ) : (
                        <><X size={12} style={{ color: "var(--color-ink-400)" }} />
                          <span style={{ color: "var(--color-ink-400)" }}>辞退済み</span>
                        </>
                      )}
                    </div>
                  </SessionCard>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- セッションカード ----
function SessionCard({ session, children }: {
  session: Session;
  myId?: string;
  children?: React.ReactNode;
}) {
  const partner = session.partner;
  const requestedDate = new Date(session.requestedAt * 1000).toLocaleDateString("ja-JP", {
    month: "numeric", day: "numeric",
  });

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
