// PB-03 予約完了・確認ページ
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Video, X } from "lucide-react";
import { useState } from "react";
import { API_BASE_URL } from "@/lib/api";

type BookingDetail = {
  id: string;
  guestName: string;
  guestEmail: string;
  startAtUtc: string;
  endAtUtc: string;
  timezone: string;
  status: string;
  conferenceType: string;
  conferenceUrl: string | null;
  cancellationToken: string;
  memberName: string;
  displayTitle: string;
};

type LocationState = {
  bookingId?: string;
  startAtUtc?: string;
  endAtUtc?: string;
  conferenceType?: string;
  conferenceUrl?: string | null;
  memberName?: string;
  displayTitle?: string;
};

async function fetchPublic<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) throw new Error("エラーが発生しました");
  const json = await res.json() as { data: T };
  return json.data;
}

async function cancelBooking(token: string, reason?: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/scheduler/public/booking/${token}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? "キャンセルに失敗しました");
  }
}

export function PublicBookingConfirmation() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = (location.state ?? {}) as LocationState;

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  const { data: booking, isLoading } = useQuery<BookingDetail>({
    queryKey: ["public", "booking", token],
    queryFn: () => fetchPublic(`/scheduler/public/booking/${token}`),
    enabled: !!token,
    retry: false,
  });

  const handleCancel = async () => {
    if (!token) return;
    setCancelPending(true);
    setCancelError(null);
    try {
      await cancelBooking(token, cancelReason || undefined);
      setCancelled(true);
      setShowCancelConfirm(false);
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : "キャンセルに失敗しました");
    } finally {
      setCancelPending(false);
    }
  };

  const display = booking ?? (locationState.bookingId ? {
    id: locationState.bookingId,
    guestName: "",
    guestEmail: "",
    startAtUtc: locationState.startAtUtc ?? "",
    endAtUtc: locationState.endAtUtc ?? "",
    timezone: "Asia/Tokyo",
    status: "confirmed",
    conferenceType: locationState.conferenceType ?? "manual",
    conferenceUrl: locationState.conferenceUrl ?? null,
    cancellationToken: token ?? "",
    memberName: locationState.memberName ?? "",
    displayTitle: locationState.displayTitle ?? "",
  } : null);

  if (isLoading && !locationState.bookingId) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--color-paper-50)" }}>
        <Loader2 className="animate-spin" style={{ color: "var(--color-ink-400)" }} />
      </div>
    );
  }

  if (!display) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--color-paper-50)" }}>
        <div className="text-center">
          <p className="text-4xl mb-4">🔍</p>
          <p style={{ color: "var(--color-ink-600)" }}>予約情報が見つかりません</p>
        </div>
      </div>
    );
  }

  const isCancelled = cancelled || display.status === "cancelled";

  const formattedStart = display.startAtUtc
    ? new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric", month: "long", day: "numeric",
        weekday: "short", hour: "2-digit", minute: "2-digit",
      }).format(new Date(display.startAtUtc))
    : "";

  const formattedEnd = display.endAtUtc
    ? new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit", minute: "2-digit",
      }).format(new Date(display.endAtUtc))
    : "";

  return (
    <div className="min-h-screen" style={{ background: "var(--color-paper-50)" }}>
      <div className="max-w-lg mx-auto px-4 py-10">
        {/* ヘッダー */}
        {isCancelled ? (
          <div className="text-center mb-8">
            <p className="text-5xl mb-4">❌</p>
            <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--color-ink-900)" }}>
              キャンセルしました
            </h1>
            <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
              予約をキャンセルしました。またのご利用をお待ちしています。
            </p>
          </div>
        ) : (
          <div className="text-center mb-8">
            <p className="text-5xl mb-4">✅</p>
            <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--color-ink-900)" }}>
              予約が完了しました！
            </h1>
            <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
              確認メールを送りました。内容をご確認ください。
            </p>
          </div>
        )}

        {/* 予約詳細カード */}
        <div
          className="rounded-2xl p-5 mb-6"
          style={{
            background: "white",
            border: `2px solid ${isCancelled ? "var(--color-paper-300)" : "var(--color-success)"}`,
          }}
        >
          <div className="space-y-4">
            <InfoItem label="日時">
              <p className="font-bold" style={{ color: "var(--color-ink-900)" }}>
                {formattedStart} 〜 {formattedEnd}
              </p>
            </InfoItem>

            {display.memberName && (
              <InfoItem label="相手">
                <p className="font-medium" style={{ color: "var(--color-ink-800)" }}>
                  {display.memberName}
                </p>
                {display.displayTitle && (
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
                    {display.displayTitle}
                  </p>
                )}
              </InfoItem>
            )}

            {!isCancelled && display.conferenceUrl && (
              <InfoItem label="会議URL">
                <a
                  href={display.conferenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 font-medium"
                  style={{ color: "var(--color-success)" }}
                >
                  <Video size={16} />
                  {display.conferenceType === "google_meet" ? "Google Meet で参加する" : "会議に参加する"}
                </a>
                <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
                  ミーティング直前にこのリンクをクリックしてください
                </p>
              </InfoItem>
            )}

            {!isCancelled && !display.conferenceUrl && (
              <InfoItem label="会議方法">
                <p className="text-sm" style={{ color: "var(--color-ink-600)" }}>
                  📞 主催者から別途ご連絡します
                </p>
              </InfoItem>
            )}
          </div>
        </div>

        {/* キャンセルセクション */}
        {!isCancelled && (
          <div className="mb-8">
            {!showCancelConfirm ? (
              <div className="text-center">
                <button
                  onClick={() => setShowCancelConfirm(true)}
                  className="text-sm flex items-center gap-1.5 mx-auto"
                  style={{ color: "var(--color-ink-400)" }}
                >
                  <X size={14} />
                  この予約をキャンセルする
                </button>
              </div>
            ) : (
              <div
                className="rounded-2xl p-4"
                style={{ background: "rgba(181,56,75,0.05)", border: "1px solid rgba(181,56,75,0.2)" }}
              >
                <p className="text-sm font-bold mb-3" style={{ color: "var(--color-brand)" }}>
                  ⚠️ 予約をキャンセルしますか？
                </p>
                <p className="text-xs mb-3" style={{ color: "var(--color-ink-600)" }}>
                  キャンセルすると双方にメールが送られます。
                </p>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="キャンセル理由（任意）"
                  className="w-full px-3 py-2 rounded-lg text-sm border resize-none mb-3"
                  style={{ borderColor: "var(--color-paper-300)", background: "white" }}
                  rows={2}
                />
                {cancelError && (
                  <p className="text-xs mb-3" style={{ color: "var(--color-brand)" }}>{cancelError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowCancelConfirm(false)}
                    className="flex-1 py-2.5 rounded-xl text-sm border"
                    style={{ borderColor: "var(--color-paper-300)", color: "var(--color-ink-600)" }}
                  >
                    戻る
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={cancelPending}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white"
                    style={{ background: "var(--color-brand)" }}
                  >
                    {cancelPending ? "キャンセル中..." : "キャンセルする"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <p className="text-center text-xs" style={{ color: "#94A3B8" }}>
          © 2026 Bizolve Consulting, Inc. All rights reserved.
        </p>
      </div>
    </div>
  );
}

function InfoItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-500)" }}>{label}</p>
      {children}
    </div>
  );
}
