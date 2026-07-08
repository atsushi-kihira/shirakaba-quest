// =============================================================
// 過去のお知らせ画面 — 既読済みミーティング通知の一覧
// =============================================================
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useTimezone } from "@/hooks/use-timezone";
import { fmtDateShort, fmtTime } from "@/lib/date";

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
  return "📝";
}

function notifDefaultMessage(type: string): string {
  if (type === "conference_url_set") return "会議URLが届きました";
  if (type === "confirmed") return "ミーティングの日程が確定しました";
  if (type === "invited") return "ミーティングに招待されました";
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

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/"
          className="w-9 h-9 rounded-xl flex items-center justify-center transition active:opacity-70"
          style={{ background: "rgba(107,125,179,0.12)" }}
        >
          <ChevronLeft size={20} style={{ color: "#6B7DB3" }} />
        </Link>
        <h1 className="text-lg font-bold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
          🔔 過去のお知らせ
        </h1>
      </div>

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
