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
import { meetingNotifIcon as notifIcon, meetingNotifDefaultMessage as notifDefaultMessage } from "@/lib/meeting-notification-text";
import { useActionItems, type ActionItem } from "@/hooks/use-action-items";

type PastNotification = {
  id: string;
  meetingId: string;
  type: string;
  message: string | null;
  createdAt: number;
  readAt: number | null;
};
type PastNotificationsResponse = { data: PastNotification[] };

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

      {/* 対応が必要なこと（各メニューのバッジの元になっている出来事を、すべてここにもまとめる） */}
      <ActionItemsSection />

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

// ---- 対応が必要なこと（1to1の申込・日程回答の依頼・協働の新着など。各メニューのバッジと同じ内容） ----
const GROUP_LABEL: Record<ActionItem["group"], string> = {
  oneonone: "🤝 1to1",
  meeting: "📅 ミーティング・定例会",
  collab: "💬 協働・人脈",
};

function ActionItemsSection() {
  const { items, count } = useActionItems();
  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-sm font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
          📌 対応が必要なこと
        </h2>
        {count > 0 && (
          <span className="min-w-[18px] h-[18px] rounded-full text-white text-xs flex items-center justify-center px-1 font-bold"
            style={{ background: "var(--color-brand)" }}>
            {count > 99 ? "99+" : count}
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <div className="card-paper rounded-2xl p-6 text-center">
          <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>いま対応が必要なことはありません 🎉</p>
        </div>
      ) : (
        <div className="space-y-4">
          {(["oneonone", "meeting", "collab"] as const).map((group) => {
            const groupItems = items.filter((it) => it.group === group);
            if (groupItems.length === 0) return null;
            return (
              <div key={group}>
                <p className="text-xs font-medium mb-1.5" style={{ color: "var(--color-ink-500)" }}>{GROUP_LABEL[group]}</p>
                <div className="space-y-2">
                  {groupItems.map((it) => (
                    <Link
                      key={it.key}
                      to={it.to}
                      className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80"
                      style={{ borderLeft: `3px solid ${it.urgent ? "var(--color-brand)" : "rgba(107,125,179,0.5)"}` }}
                    >
                      <span className="text-2xl shrink-0">{it.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold" style={{ color: "var(--color-ink-800)" }}>{it.title}</p>
                        {it.detail && <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "var(--color-ink-500)" }}>{it.detail}</p>}
                      </div>
                      <ChevronRight size={16} className="shrink-0" style={{ color: "var(--color-ink-400)" }} />
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
