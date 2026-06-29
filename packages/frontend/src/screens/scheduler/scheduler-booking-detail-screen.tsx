// SC-06 予約詳細画面（ホスト向け）
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ArrowLeft, Video, Mail, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { request, ApiError } from "@/lib/api";

type Booking = {
  id: string;
  guestName: string;
  guestEmail: string;
  guestMessage: string | null;
  startAtUtc: string;
  endAtUtc: string;
  timezone: string;
  status: string;
  conferenceType: string;
  conferenceUrl: string | null;
  conferenceMetaJson: string | null;
  cancellationReason: string | null;
  events: { eventType: string; actorKind: string; occurredAt: string }[];
};

function formatDate(utcStr: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "long", day: "numeric",
    weekday: "long", hour: "2-digit", minute: "2-digit",
  }).format(new Date(utcStr));
}

export function SchedulerBookingDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cancelReason, setCancelReason] = useState("");
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ data: Booking }>({
    queryKey: ["scheduler", "bookings", id],
    queryFn: () => request(`/scheduler/bookings/${id}`),
    enabled: !!id,
  });

  const booking = data?.data;

  const cancelMutation = useMutation({
    mutationFn: () =>
      request(`/scheduler/bookings/${id}/cancel`, {
        method: "POST",
        body: { reason: cancelReason || undefined },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduler", "bookings"] });
      setShowCancelConfirm(false);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "キャンセルに失敗しました"),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin" style={{ color: "var(--color-ink-400)" }} />
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="max-w-lg mx-auto px-4 py-6">
        <p style={{ color: "var(--color-ink-500)" }}>予約が見つかりません</p>
      </div>
    );
  }

  const isCancelled = booking.status === "cancelled";

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <button
        onClick={() => navigate("/scheduler/bookings")}
        className="flex items-center gap-1.5 text-sm mb-6"
        style={{ color: "var(--color-ink-500)" }}
      >
        <ArrowLeft size={16} />
        予約一覧に戻る
      </button>

      <div className="flex items-center gap-2 mb-6">
        <h1 className="text-xl font-bold" style={{ color: "var(--color-ink-900)" }}>
          予約詳細
        </h1>
        <span
          className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{
            background: isCancelled ? "rgba(181,56,75,0.1)" : "rgba(90,140,92,0.1)",
            color: isCancelled ? "var(--color-brand)" : "var(--color-success)",
          }}
        >
          {isCancelled ? "キャンセル済み" : "確定"}
        </span>
      </div>

      {error && (
        <div className="p-3 rounded-xl mb-4 text-sm"
          style={{ background: "rgba(181,56,75,0.1)", color: "var(--color-brand)" }}>
          {error}
        </div>
      )}

      {/* 基本情報 */}
      <div className="space-y-3 mb-6">
        <InfoRow label="日時">
          <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>
            {formatDate(booking.startAtUtc)}
          </p>
        </InfoRow>

        <InfoRow label="ゲスト">
          <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>
            {booking.guestName}
          </p>
          <a href={`mailto:${booking.guestEmail}`}
            className="text-xs flex items-center gap-1 mt-0.5"
            style={{ color: "var(--color-brand)" }}>
            <Mail size={11} />
            {booking.guestEmail}
          </a>
        </InfoRow>

        {booking.guestMessage && (
          <InfoRow label="メッセージ">
            <p className="text-sm" style={{ color: "var(--color-ink-700)" }}>
              {booking.guestMessage}
            </p>
          </InfoRow>
        )}

        <InfoRow label="会議">
          {booking.conferenceUrl ? (
            <a
              href={booking.conferenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm font-medium"
              style={{ color: "var(--color-success)" }}
            >
              <Video size={14} />
              {booking.conferenceType === "google_meet" ? "Google Meet で参加" : "会議に参加"}
            </a>
          ) : (
            <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
              会議URLは別途ご連絡ください
            </p>
          )}
        </InfoRow>

        {isCancelled && booking.cancellationReason && (
          <InfoRow label="キャンセル理由">
            <p className="text-sm" style={{ color: "var(--color-ink-700)" }}>
              {booking.cancellationReason}
            </p>
          </InfoRow>
        )}
      </div>

      {/* キャンセルボタン */}
      {!isCancelled && (
        <>
          {!showCancelConfirm ? (
            <button
              onClick={() => setShowCancelConfirm(true)}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-xl border"
              style={{ borderColor: "var(--color-paper-400)", color: "var(--color-ink-500)" }}
            >
              <AlertTriangle size={14} />
              この予約をキャンセルする
            </button>
          ) : (
            <div className="rounded-xl p-4" style={{ background: "rgba(181,56,75,0.06)", border: "1px solid rgba(181,56,75,0.2)" }}>
              <p className="text-sm font-bold mb-3" style={{ color: "var(--color-brand)" }}>
                ⚠️ キャンセルの確認
              </p>
              <p className="text-xs mb-3" style={{ color: "var(--color-ink-600)" }}>
                キャンセルするとゲストにメールが送られます。
              </p>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="キャンセル理由（任意）"
                className="w-full px-3 py-2 rounded-lg text-sm border resize-none mb-3"
                style={{ borderColor: "var(--color-paper-300)" }}
                rows={2}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  className="flex-1 py-2 rounded-xl text-sm border"
                  style={{ borderColor: "var(--color-paper-300)", color: "var(--color-ink-600)" }}
                >
                  戻る
                </button>
                <button
                  onClick={() => cancelMutation.mutate()}
                  disabled={cancelMutation.isPending}
                  className="flex-1 py-2 rounded-xl text-sm font-bold text-white"
                  style={{ background: "var(--color-brand)" }}
                >
                  {cancelMutation.isPending ? "キャンセル中..." : "キャンセルする"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-4" style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-200)" }}>
      <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-500)" }}>{label}</p>
      {children}
    </div>
  );
}
