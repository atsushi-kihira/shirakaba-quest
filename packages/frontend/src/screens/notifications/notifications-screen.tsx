// =============================================================
// 通知画面 — 運営からのお知らせ（管理画面から配信）と、過去のミーティング通知の一覧
// =============================================================
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useTimezone } from "@/hooks/use-timezone";
import { fmtDateShort, fmtTime } from "@/lib/date";
import { useBroadcastNotifications } from "@/hooks/use-broadcast-notifications";
import { LinkifiedText } from "@/components/linkified-text";

type PastNotification = {
  id: string;
  meetingId: string;
  type: string;
  message: string | null;
  createdAt: number;
  readAt: number | null;
};
type PastNotificationsResponse = { data: PastNotification[] };

function notifIcon(type: string): string {
  if (type === "conference_url_set") return "📹";
  if (type === "confirmed") return "✅";
  if (type === "invited") return "📨";
  if (type === "candidates_added") return "🗓️";
  if (type === "candidate_removed") return "🗑️";
  if (type === "candidate_updated") return "🗓️";
  if (type === "declined") return "🙇";
  if (type === "reminder") return "⏰";
  if (type === "unavailable_contact") return "💬";
  return "📝";
}

function notifDefaultMessage(type: string): string {
  if (type === "conference_url_set") return "会議URLが届きました";
  if (type === "confirmed") return "ミーティングの日程が確定しました";
  if (type === "invited") return "ミーティングに招待されました";
  if (type === "candidates_added") return "新しい候補日が追加されました";
  if (type === "candidate_removed") return "候補日が削除されました";
  if (type === "candidate_updated") return "候補日が変更されました";
  if (type === "declined") return "辞退の連絡がありました";
  if (type === "reminder") return "まだご回答いただいていません";
  if (type === "unavailable_contact") return "都合が悪い旨のご連絡がありました";
  return "ミーティングに詳細が追加されました";
}

export function NotificationsScreen() {
  const tz = useTimezone();

  const { data, isLoading } = useQuery({
    queryKey: ["meetings", "notifications", "history"],
    queryFn: () => api.get<PastNotificationsResponse>("/meetings/notifications/history"),
    staleTime: 60_000,
  });

  const notifications = data?.data ?? [];
  const { all: broadcasts, unreadCount, markRead, markAllRead } = useBroadcastNotifications();
  const [openId, setOpenId] = useState<string | null>(null);

  function toggleBroadcast(id: string, isUnread: boolean) {
    setOpenId((cur) => (cur === id ? null : id));
    if (isUnread) markRead(id);
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/home"
          className="w-9 h-9 rounded-xl flex items-center justify-center transition active:opacity-70"
          style={{ background: "rgba(107,125,179,0.12)" }}
        >
          <ChevronLeft size={20} style={{ color: "#6B7DB3" }} />
        </Link>
        <h1 className="text-lg font-bold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
          🔔 通知
        </h1>
      </div>

      {/* 運営からのお知らせ */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
          📣 運営からのお知らせ
        </h2>
        {unreadCount > 0 && (
          <button onClick={markAllRead} className="text-xs font-medium" style={{ color: "var(--color-brand)" }}>
            すべて既読にする
          </button>
        )}
      </div>
      {broadcasts.length === 0 ? (
        <div className="card-paper rounded-2xl p-6 text-center mb-8">
          <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>運営からのお知らせはまだありません</p>
        </div>
      ) : (
        <div className="space-y-2 mb-8">
          {broadcasts.map((n) => {
            const isUnread = n.readAt === null;
            const open = openId === n.id;
            return (
              <div key={n.id} className="card-paper rounded-2xl overflow-hidden"
                style={{ borderLeft: `3px solid ${isUnread ? "var(--color-brand)" : "rgba(181,56,75,0.25)"}` }}>
                <button onClick={() => toggleBroadcast(n.id, isUnread)} className="w-full px-4 py-3 flex items-center gap-3 text-left">
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${isUnread ? "font-bold" : "font-medium"}`} style={{ color: "var(--color-ink-800)" }}>
                      {isUnread && <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: "var(--color-brand)" }} />}
                      {n.title}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>
                      {fmtDateShort(n.createdAt, tz)} {fmtTime(n.createdAt, tz)}
                    </p>
                  </div>
                  <ChevronRight size={16} className="transition-transform shrink-0"
                    style={{ color: "var(--color-ink-400)", transform: open ? "rotate(90deg)" : "none" }} />
                </button>
                {open && (
                  <div className="px-4 pb-4 pt-1" style={{ borderTop: "1px solid var(--color-paper-300)" }}>
                    <LinkifiedText text={n.body} className="text-sm leading-relaxed mt-2" style={{ color: "var(--color-ink-800)" }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <h2 className="text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "#6B7DB3" }}>
        🗓️ ミーティングの過去のお知らせ
      </h2>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin" style={{ color: "#6B7DB3" }} />
        </div>
      ) : notifications.length === 0 ? (
        <div className="card-paper rounded-3xl p-10 text-center">
          <p className="text-4xl mb-3">🔔</p>
          <p className="text-sm font-medium mb-1" style={{ color: "var(--color-ink-700)" }}>
            過去のお知らせはありません
          </p>
          <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
            既読したお知らせがここに表示されます
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <Link
              key={n.id}
              to={`/meetings/${n.meetingId}`}
              className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80"
              style={{ borderLeft: "3px solid rgba(107,125,179,0.35)" }}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                style={{ background: "rgba(107,125,179,0.08)" }}
              >
                {notifIcon(n.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: "var(--color-ink-700)" }}>
                  {n.message ?? notifDefaultMessage(n.type)}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>
                  {fmtDateShort(n.createdAt, tz)} {fmtTime(n.createdAt, tz)}
                </p>
              </div>
              <ChevronRight size={16} style={{ color: "var(--color-ink-400)" }} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
