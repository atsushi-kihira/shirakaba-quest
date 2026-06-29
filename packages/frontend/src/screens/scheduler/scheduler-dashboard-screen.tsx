// SC-01 スケジューラーダッシュボード
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Link2, Settings, CalendarDays, CheckCircle2, Copy, ExternalLink, Loader2, Check } from "lucide-react";
import { useState } from "react";
import { request } from "@/lib/api";

type GoogleStatus = { connected: boolean; googleAccountEmail: string | null };
type PublicUrl = { slug: string | null; publicUrl: string | null };
type BookingSummary = { data: { id: string; guestName: string; startAtUtc: string; status: string }[] };

export function SchedulerDashboardScreen() {
  const navigate = useNavigate();
  const [copiedUrl, setCopiedUrl] = useState(false);

  const { data: googleData } = useQuery<{ data: GoogleStatus }>({
    queryKey: ["scheduler", "google-status"],
    queryFn: () => request("/scheduler/oauth/google/status"),
  });

  const { data: publicUrlData } = useQuery<{ data: PublicUrl }>({
    queryKey: ["scheduler", "public-url"],
    queryFn: () => request("/scheduler/me/public-url"),
  });

  const { data: bookingsData, isLoading: bookingsLoading } = useQuery<BookingSummary>({
    queryKey: ["scheduler", "bookings", "upcoming"],
    queryFn: () => request(`/scheduler/bookings?from=${new Date().toISOString()}&status=confirmed`),
  });

  const google = googleData?.data;
  const publicUrl = publicUrlData?.data.publicUrl;
  const upcomingBookings = bookingsData?.data?.slice(0, 3) ?? [];

  const copyUrl = async () => {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const formatDate = (utcStr: string) =>
    new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      month: "numeric", day: "numeric", weekday: "short",
      hour: "2-digit", minute: "2-digit",
    }).format(new Date(utcStr));

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--color-ink-900)" }}>
        🗓️ 日程調整
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-ink-500)" }}>
        公開URLを共有して、外部からの予約を受け付けましょう
      </p>

      {/* 公開 URL カード */}
      {publicUrl ? (
        <div
          className="rounded-2xl p-4 mb-4"
          style={{ background: "var(--color-paper-50)", border: "2px solid var(--color-success)" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={16} style={{ color: "var(--color-success)" }} />
            <span className="text-sm font-bold" style={{ color: "var(--color-success)" }}>
              公開URLが設定されています
            </span>
          </div>
          <div className="flex items-center gap-2">
            <code className="text-xs flex-1 truncate px-2 py-1 rounded-lg"
              style={{ background: "var(--color-paper-100)", color: "var(--color-ink-700)" }}>
              {publicUrl}
            </code>
            <button onClick={copyUrl} className="p-1.5 rounded-lg flex-shrink-0"
              style={{ background: "var(--color-paper-200)" }}>
              {copiedUrl ? <Check size={14} style={{ color: "var(--color-success)" }} /> : <Copy size={14} />}
            </button>
            <a href={publicUrl} target="_blank" rel="noopener noreferrer"
              className="p-1.5 rounded-lg flex-shrink-0"
              style={{ background: "var(--color-paper-200)" }}>
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
      ) : (
        <div
          className="rounded-2xl p-4 mb-4"
          style={{ background: "var(--color-paper-50)", border: "2px dashed var(--color-paper-400)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
            まずは受付時間を設定して、公開URLを作りましょう
          </p>
          <button
            onClick={() => navigate("/scheduler/settings")}
            className="mt-2 text-sm font-bold"
            style={{ color: "var(--color-brand)" }}
          >
            受付時間を設定する →
          </button>
        </div>
      )}

      {/* ステータスカード */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div
          className="rounded-2xl p-4 flex items-center gap-3 cursor-pointer"
          style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}
          onClick={() => navigate("/scheduler/integrations")}
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
            style={{ background: "white", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            📅
          </div>
          <div>
            <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>Google連携</p>
            <p className="text-sm font-bold" style={{ color: google?.connected ? "var(--color-success)" : "var(--color-ink-700)" }}>
              {google?.connected ? "接続済み" : "未設定"}
            </p>
          </div>
        </div>

        <div
          className="rounded-2xl p-4 flex items-center gap-3 cursor-pointer"
          style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}
          onClick={() => navigate("/scheduler/bookings")}
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
            style={{ background: "white", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            🤝
          </div>
          <div>
            <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>予約</p>
            <p className="text-sm font-bold" style={{ color: "var(--color-ink-700)" }}>
              {bookingsLoading ? "..." : `${upcomingBookings.length}件`}
            </p>
          </div>
        </div>
      </div>

      {/* 直近の予約 */}
      {upcomingBookings.length > 0 && (
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold" style={{ color: "var(--color-ink-800)" }}>直近の予約</h2>
            <button onClick={() => navigate("/scheduler/bookings")} className="text-xs"
              style={{ color: "var(--color-brand)" }}>
              すべて見る →
            </button>
          </div>
          <div className="space-y-2">
            {upcomingBookings.map((b) => (
              <div
                key={b.id}
                className="rounded-xl p-3 flex items-center gap-3 cursor-pointer"
                style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-200)" }}
                onClick={() => navigate(`/scheduler/bookings/${b.id}`)}
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0"
                  style={{ background: "var(--color-paper-200)" }}>
                  🤝
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>
                    {b.guestName}
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
                    {formatDate(b.startAtUtc)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* クイックアクション */}
      <div className="space-y-2">
        <h2 className="font-bold mb-3" style={{ color: "var(--color-ink-800)" }}>設定</h2>
        {[
          { icon: <Link2 size={16} />, label: "Google連携", path: "/scheduler/integrations" },
          { icon: <Settings size={16} />, label: "受付時間・基本設定", path: "/scheduler/settings" },
          { icon: <CalendarDays size={16} />, label: "予約一覧", path: "/scheduler/bookings" },
        ].map((item) => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left"
            style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-200)" }}
          >
            <span style={{ color: "var(--color-ink-600)" }}>{item.icon}</span>
            <span className="text-sm" style={{ color: "var(--color-ink-800)" }}>{item.label}</span>
            <span className="ml-auto text-xs" style={{ color: "var(--color-ink-400)" }}>→</span>
          </button>
        ))}
      </div>
    </div>
  );
}
