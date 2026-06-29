// SC-05 予約一覧画面
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ArrowLeft, CalendarDays, CheckCircle2 } from "lucide-react";
import { request } from "@/lib/api";

type Booking = {
  id: string;
  guestName: string;
  guestEmail: string;
  startAtUtc: string;
  endAtUtc: string;
  status: string;
  conferenceType: string;
  conferenceUrl: string | null;
};

function formatDate(utcStr: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "numeric", day: "numeric",
    weekday: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(utcStr));
}

export function SchedulerBookingsScreen() {
  const navigate = useNavigate();

  const now = new Date().toISOString();
  const { data: upcomingData, isLoading: uLoading } = useQuery<{ data: Booking[] }>({
    queryKey: ["scheduler", "bookings", "upcoming"],
    queryFn: () => request(`/scheduler/bookings?from=${now}&status=confirmed`),
  });

  const { data: pastData, isLoading: pLoading } = useQuery<{ data: Booking[] }>({
    queryKey: ["scheduler", "bookings", "past"],
    queryFn: () => request(`/scheduler/bookings?to=${now}`),
  });

  const upcoming = upcomingData?.data ?? [];
  const past = pastData?.data ?? [];

  const isLoading = uLoading || pLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin" style={{ color: "var(--color-ink-400)" }} />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <button
        onClick={() => navigate("/scheduler")}
        className="flex items-center gap-1.5 text-sm mb-6"
        style={{ color: "var(--color-ink-500)" }}
      >
        <ArrowLeft size={16} />
        スケジューラーに戻る
      </button>

      <h1 className="text-xl font-bold mb-6" style={{ color: "var(--color-ink-900)" }}>
        📋 予約一覧
      </h1>

      {/* 今後の予約 */}
      <section className="mb-8">
        <h2 className="font-bold mb-3 flex items-center gap-2" style={{ color: "var(--color-ink-800)" }}>
          <CheckCircle2 size={16} style={{ color: "var(--color-success)" }} />
          今後の予約 ({upcoming.length}件)
        </h2>
        {upcoming.length === 0 ? (
          <div className="rounded-2xl p-8 text-center" style={{ background: "var(--color-paper-50)", border: "1px dashed var(--color-paper-400)" }}>
            <CalendarDays size={32} className="mx-auto mb-2" style={{ color: "var(--color-ink-300)" }} />
            <p className="text-sm" style={{ color: "var(--color-ink-400)" }}>予定されている予約はありません</p>
          </div>
        ) : (
          <div className="space-y-2">
            {upcoming.map((b) => (
              <BookingCard key={b.id} booking={b} onClick={() => navigate(`/scheduler/bookings/${b.id}`)} />
            ))}
          </div>
        )}
      </section>

      {/* 過去の予約 */}
      {past.length > 0 && (
        <section>
          <h2 className="font-bold mb-3" style={{ color: "var(--color-ink-800)" }}>
            過去の予約 ({past.length}件)
          </h2>
          <div className="space-y-2">
            {past.slice(0, 10).map((b) => (
              <BookingCard key={b.id} booking={b} past onClick={() => navigate(`/scheduler/bookings/${b.id}`)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function BookingCard({ booking, past, onClick }: { booking: Booking; past?: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="rounded-xl p-4 cursor-pointer flex items-center gap-3"
      style={{
        background: past ? "var(--color-paper-50)" : "white",
        border: `1px solid ${past ? "var(--color-paper-200)" : "var(--color-paper-300)"}`,
        opacity: booking.status === "cancelled" ? 0.6 : 1,
      }}
    >
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0"
        style={{ background: "var(--color-paper-100)" }}
      >
        {booking.status === "cancelled" ? "❌" : "🤝"}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate" style={{ color: "var(--color-ink-800)" }}>
          {booking.guestName}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
          {new Intl.DateTimeFormat("ja-JP", {
            timeZone: "Asia/Tokyo",
            month: "numeric", day: "numeric", weekday: "short",
            hour: "2-digit", minute: "2-digit",
          }).format(new Date(booking.startAtUtc))}
        </p>
        {booking.conferenceUrl && (
          <p className="text-xs mt-0.5" style={{ color: "var(--color-success)" }}>
            {booking.conferenceType === "google_meet" ? "📹 Google Meet" : "📹 会議あり"}
          </p>
        )}
      </div>
      <div className="flex-shrink-0">
        {booking.status === "cancelled" ? (
          <span className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: "rgba(181,56,75,0.1)", color: "var(--color-brand)" }}>
            キャンセル
          </span>
        ) : (
          <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>→</span>
        )}
      </div>
    </div>
  );
}
