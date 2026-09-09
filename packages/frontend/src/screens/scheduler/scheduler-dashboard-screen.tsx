// SC-01 スケジューラーダッシュボード
import type { MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Link2, Settings, CalendarDays, CheckCircle2, ExternalLink } from "lucide-react";
import { request } from "@/lib/api";
import { GoogleNotConnectedWarning } from "@/components/google-not-connected-warning";
import { SchedulerShareLinkPanel, useSchedulerShareLink, useAutoSchedulerShareLink } from "@/components/scheduler-share-link-panel";

type GoogleStatus = { connected: boolean; googleAccountEmail: string | null };
type ZoomStatus = { connected: boolean; zoomAccountEmail: string | null };
type BookingSummary = { data: { id: string; guestName: string; startAtUtc: string; status: string }[] };

export function SchedulerDashboardScreen() {
  const navigate = useNavigate();

  const { data: googleData } = useQuery<{ data: GoogleStatus }>({
    queryKey: ["scheduler", "google-status"],
    queryFn: () => request("/scheduler/oauth/google/status"),
  });

  const { data: zoomData } = useQuery<{ data: ZoomStatus }>({
    queryKey: ["scheduler", "zoom-status"],
    queryFn: () => request("/scheduler/oauth/zoom/status"),
  });

  const { data: shareLinkData } = useSchedulerShareLink();
  const { data: previewShareData, generate: previewGenerate } = useAutoSchedulerShareLink();

  const { data: bookingsData, isLoading: bookingsLoading } = useQuery<BookingSummary>({
    queryKey: ["scheduler", "bookings", "upcoming"],
    queryFn: () => request(`/scheduler/bookings?from=${new Date().toISOString()}&status=confirmed`),
  });

  const google = googleData?.data;
  const zoom = zoomData?.data;
  const publicUrl = shareLinkData?.publicUrl ?? null;
  const upcomingBookings = bookingsData?.data?.slice(0, 3) ?? [];

  // 相手（メンバー・外部ゲストいずれの場合も）に見える予約ページを、事前確認のため新しいタブで開く
  const previewUrl = previewShareData?.publicUrl ?? null;
  function handleCalendarPreviewClick(e: MouseEvent) {
    if (previewUrl) return; // <a href> にまかせる
    e.preventDefault();
    previewGenerate.mutate(undefined, {
      onSuccess: (res) => {
        if (res.data.publicUrl) window.open(res.data.publicUrl, "_blank", "noopener,noreferrer");
      },
    });
  }

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

      {/* Google連携が未設定・連携切れの場合は、共有前に連携を促す */}
      {publicUrl && google && !google.connected && <GoogleNotConnectedWarning />}

      {/* 公開 URL カード（期限付き） */}
      {shareLinkData !== undefined && (
        <div
          className="rounded-2xl p-4 mb-4"
          style={{ background: "var(--color-paper-50)", border: `2px ${publicUrl ? "solid var(--color-success)" : "dashed var(--color-paper-400)"}` }}
        >
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={16} style={{ color: publicUrl ? "var(--color-success)" : "var(--color-ink-400)" }} />
            <span className="text-sm font-bold" style={{ color: publicUrl ? "var(--color-success)" : "var(--color-ink-600)" }}>
              {publicUrl ? "公開URLが発行されています" : "公開URLが未発行です"}
            </span>
          </div>
          <SchedulerShareLinkPanel />
          {!publicUrl && (
            <button
              onClick={() => navigate("/scheduler/settings")}
              className="mt-2 text-xs"
              style={{ color: "var(--color-ink-500)" }}
            >
              まだ受付時間を設定していない場合はこちら →
            </button>
          )}
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
            🔗
          </div>
          <div>
            <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>外部連携</p>
            <p className="text-sm font-bold" style={{ color: (google?.connected || zoom?.connected) ? "var(--color-success)" : "var(--color-ink-700)" }}>
              {[google?.connected && "Google", zoom?.connected && "Zoom"].filter(Boolean).join("・") || "未設定"}
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
        <a
          href={previewUrl ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleCalendarPreviewClick}
          aria-disabled={previewGenerate.isPending}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left disabled:opacity-50"
          style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-200)" }}
        >
          <span style={{ color: "var(--color-ink-600)" }}><ExternalLink size={16} /></span>
          <span className="text-sm" style={{ color: "var(--color-ink-800)" }}>📅 カレンダーページを表示</span>
          <span className="ml-auto text-xs" style={{ color: "var(--color-ink-400)" }}>→</span>
        </a>
        {[
          { icon: <Link2 size={16} />, label: "外部サービス連携", path: "/scheduler/integrations" },
          { icon: <Settings size={16} />, label: "基本設定・受付時間", path: "/scheduler/settings" },
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
