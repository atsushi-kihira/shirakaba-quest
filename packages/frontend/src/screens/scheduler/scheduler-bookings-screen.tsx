// SC-05 予約一覧画面
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ArrowLeft, CalendarDays, CheckCircle2, Trash2, Check } from "lucide-react";
import { request, api } from "@/lib/api";

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

type Period = "1m" | "6m" | "1y" | "all";
const PERIOD_LABELS: Record<Period, string> = { "1m": "直近1ヶ月", "6m": "直近6ヶ月", "1y": "直近1年", all: "すべて" };
const PERIOD_DAYS: Record<Period, number | null> = { "1m": 30, "6m": 182, "1y": 365, all: null };

export function SchedulerBookingsScreen() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [period, setPeriod] = useState<Period>("1m");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const now = new Date().toISOString();
  const { data: upcomingData, isLoading: uLoading } = useQuery<{ data: Booking[] }>({
    queryKey: ["scheduler", "bookings", "upcoming"],
    queryFn: () => request(`/scheduler/bookings?from=${now}&status=confirmed`),
  });

  const days = PERIOD_DAYS[period];
  const fromParam = days ? new Date(Date.now() - days * 86400_000).toISOString() : null;
  const { data: pastData, isLoading: pLoading } = useQuery<{ data: Booking[] }>({
    queryKey: ["scheduler", "bookings", "past", period],
    queryFn: () => request(`/scheduler/bookings?to=${now}${fromParam ? `&from=${fromParam}` : ""}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => api.delete<{ data: { deletedCount: number } }>("/scheduler/bookings", { ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduler", "bookings"] });
      setSelected(new Set());
      setSelectMode(false);
    },
  });

  const upcoming = upcomingData?.data ?? [];
  const past = pastData?.data ?? [];

  const isLoading = uLoading || pLoading;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`選択した${selected.size}件の予約記録を削除しますか？`)) return;
    deleteMutation.mutate([...selected]);
  }

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
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold" style={{ color: "var(--color-ink-800)" }}>
            過去の予約 ({past.length}件)
          </h2>
          <button
            onClick={() => { setSelectMode((v) => !v); setSelected(new Set()); }}
            className="text-xs font-medium px-3 py-1.5 rounded-xl"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
          >
            {selectMode ? "キャンセル" : "選択して削除"}
          </button>
        </div>

        {/* 期間フィルタ */}
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

        {pLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={20} className="animate-spin" style={{ color: "var(--color-ink-400)" }} />
          </div>
        ) : past.length === 0 ? (
          <div className="rounded-2xl p-8 text-center" style={{ background: "var(--color-paper-50)", border: "1px dashed var(--color-paper-400)" }}>
            <p className="text-sm" style={{ color: "var(--color-ink-400)" }}>この期間の予約はありません</p>
          </div>
        ) : (
          <div className="space-y-2">
            {past.map((b) => (
              <div key={b.id} className="flex items-center gap-2">
                {selectMode && (
                  <button
                    onClick={() => toggleSelect(b.id)}
                    className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                    style={{
                      background: selected.has(b.id) ? "var(--color-brand)" : "var(--color-paper-200)",
                      border: "1px solid var(--color-paper-300)",
                    }}
                  >
                    {selected.has(b.id) && <Check size={14} color="white" />}
                  </button>
                )}
                <div className="flex-1 min-w-0">
                  <BookingCard
                    booking={b}
                    past
                    onClick={() => selectMode ? toggleSelect(b.id) : navigate(`/scheduler/bookings/${b.id}`)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {selectMode && (
          <button
            onClick={handleBulkDelete}
            disabled={selected.size === 0 || deleteMutation.isPending}
            className="mt-4 w-full py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ background: "var(--color-brand)" }}
          >
            {deleteMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            選択した{selected.size}件を削除
          </button>
        )}
      </section>
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
