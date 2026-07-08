// PB-02 予約フォーム（ゲスト情報入力）
import { useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, ArrowLeft, Video, User, Mail, MessageSquare } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

type MemberMeta = {
  memberName: string;
  memberEmoji: string;
  displayTitle: string;
  durationMinutes: number;
  availableConferenceTypes: string[];
};

async function fetchPublic<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) throw new Error("エラーが発生しました");
  const json = await res.json() as { data: T };
  return json.data;
}

async function bookSlot(memberSlug: string, body: unknown): Promise<{ bookingId: string; cancellationToken: string; conferenceType: string; conferenceUrl: string | null; startAtUtc: string; endAtUtc: string }> {
  const res = await fetch(`${API_BASE_URL}/scheduler/public/${memberSlug}/book`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string; code?: string } };
    throw Object.assign(new Error(err.error?.message ?? "予約に失敗しました"), { code: err.error?.code });
  }
  const json = await res.json() as { data: { bookingId: string; cancellationToken: string; conferenceType: string; conferenceUrl: string | null; startAtUtc: string; endAtUtc: string } };
  return json.data;
}

export function PublicBookingForm() {
  const { memberSlug } = useParams<{ memberSlug: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const slotUtc = searchParams.get("slot");
  const endUtc = searchParams.get("end");
  const loggedInUser = useAuthStore((s) => s.user);

  const [guestName, setGuestName] = useState(loggedInUser?.name ?? "");
  const [guestEmail, setGuestEmail] = useState(loggedInUser?.email ?? "");
  const [guestMessage, setGuestMessage] = useState("");
  const [conferenceType, setConferenceType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: meta } = useQuery<MemberMeta>({
    queryKey: ["public", memberSlug, "meta"],
    queryFn: () => fetchPublic(`/scheduler/public/${memberSlug}`),
    enabled: !!memberSlug,
  });

  const bookMutation = useMutation({
    mutationFn: () => {
      if (!memberSlug || !slotUtc || !endUtc) throw new Error("パラメータ不足");
      const availTypes = meta?.availableConferenceTypes ?? [];
      const resolvedType = availTypes.length === 0
        ? "manual"
        : availTypes.length === 1
          ? availTypes[0]
          : conferenceType ?? availTypes[0];
      return bookSlot(memberSlug, {
        startUtc: slotUtc,
        endUtc,
        guestName,
        guestEmail,
        guestMessage: guestMessage || undefined,
        conferenceType: resolvedType,
        timezone: "Asia/Tokyo",
      });
    },
    onSuccess: (result) => {
      navigate(`/book/confirmation/${result.cancellationToken}`, {
        state: {
          bookingId: result.bookingId,
          startAtUtc: result.startAtUtc,
          endAtUtc: result.endAtUtc,
          conferenceType: result.conferenceType,
          conferenceUrl: result.conferenceUrl,
          memberName: meta?.memberName,
          displayTitle: meta?.displayTitle,
        },
      });
    },
    onError: (e: Error & { code?: string }) => {
      if (e.code === "slot_taken") {
        setError("申し訳ありません。その時間帯は先ほど他の方に予約されました。前のページから別の時間を選んでください。");
      } else {
        setError(e.message);
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestName.trim()) { setError("お名前を入力してください"); return; }
    if (!guestEmail.trim()) { setError("メールアドレスを入力してください"); return; }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(guestEmail)) { setError("メールアドレスの形式が正しくありません"); return; }
    setError(null);
    bookMutation.mutate();
  };

  if (!slotUtc || !endUtc) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--color-paper-50)" }}>
        <div className="text-center">
          <p className="text-4xl mb-4">⚠️</p>
          <p style={{ color: "var(--color-ink-500)" }}>
            日時が選択されていません。
            <button onClick={() => navigate(-1)} className="ml-1 font-bold" style={{ color: "var(--color-brand)" }}>
              戻る
            </button>
          </p>
        </div>
      </div>
    );
  }

  const availTypes = meta?.availableConferenceTypes ?? [];

  const formattedSlot = slotUtc ? new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "long", day: "numeric",
    weekday: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(slotUtc)) : "";

  const formattedEnd = endUtc ? new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(endUtc)) : "";

  return (
    <div className="min-h-screen" style={{ background: "var(--color-paper-50)" }}>
      <div className="max-w-lg mx-auto px-4 py-6">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm mb-6"
          style={{ color: "var(--color-ink-500)" }}
        >
          <ArrowLeft size={16} />
          日時選択に戻る
        </button>

        {/* 選択内容の確認 */}
        <div
          className="rounded-2xl p-4 mb-6"
          style={{ background: "white", border: "2px solid var(--color-success)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-xl flex-shrink-0"
              style={{ background: "var(--color-paper-100)" }}
            >
              {meta?.memberEmoji ?? "👤"}
            </div>
            <div>
              <p className="font-bold text-sm" style={{ color: "var(--color-ink-900)" }}>
                {meta?.memberName ?? ""} / {meta?.displayTitle ?? ""}
              </p>
              <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-700)" }}>
                📅 {formattedSlot} 〜 {formattedEnd}
              </p>
            </div>
          </div>
        </div>

        {/* 予約フォーム */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block" style={{ color: "var(--color-ink-700)" }}>
              <User size={13} className="inline mr-1" />
              お名前 <span style={{ color: "var(--color-brand)" }}>*</span>
            </label>
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="山田 太郎"
              className="w-full px-4 py-3 rounded-xl border text-sm"
              style={{ borderColor: "var(--color-paper-300)", background: "white" }}
              required
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block" style={{ color: "var(--color-ink-700)" }}>
              <Mail size={13} className="inline mr-1" />
              メールアドレス <span style={{ color: "var(--color-brand)" }}>*</span>
            </label>
            <input
              type="email"
              value={guestEmail}
              onChange={(e) => setGuestEmail(e.target.value)}
              placeholder="taro@example.com"
              className="w-full px-4 py-3 rounded-xl border text-sm"
              style={{ borderColor: "var(--color-paper-300)", background: "white" }}
              required
            />
            <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
              予約確認メールをこのアドレスに送ります
            </p>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block" style={{ color: "var(--color-ink-700)" }}>
              <MessageSquare size={13} className="inline mr-1" />
              メッセージ（任意）
            </label>
            <textarea
              value={guestMessage}
              onChange={(e) => setGuestMessage(e.target.value)}
              placeholder="ご要望や相談内容などがあればお書きください"
              className="w-full px-4 py-3 rounded-xl border text-sm resize-none"
              style={{ borderColor: "var(--color-paper-300)", background: "white" }}
              rows={3}
              maxLength={2000}
            />
          </div>

          {/* 会議ツール選択（2種類連携時のみ表示） */}
          {availTypes.length >= 2 && (
            <div>
              <label className="text-sm font-medium mb-1.5 block" style={{ color: "var(--color-ink-700)" }}>
                <Video size={13} className="inline mr-1" />
                会議ツール
              </label>
              <div className="space-y-2">
                {availTypes.map((t) => (
                  <label key={t} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="conferenceType"
                      value={t}
                      checked={conferenceType === t}
                      onChange={() => setConferenceType(t)}
                    />
                    <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>
                      {t === "google_meet" ? "📹 Google Meet" : t === "zoom" ? "📹 Zoom" : "後ほど連絡"}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* 会議ツール固定表示（1種類の場合） */}
          {availTypes.length === 1 && (
            <div className="rounded-xl p-3" style={{ background: "var(--color-paper-100)" }}>
              <p className="text-xs" style={{ color: "var(--color-ink-600)" }}>
                <Video size={12} className="inline mr-1" />
                {availTypes[0] === "google_meet"
                  ? "Google Meet のURLが自動発行されます"
                  : "Zoom のURLが自動発行されます"}
              </p>
            </div>
          )}

          {availTypes.length === 0 && (
            <div className="rounded-xl p-3" style={{ background: "var(--color-paper-100)" }}>
              <p className="text-xs" style={{ color: "var(--color-ink-600)" }}>
                📞 会議URLは主催者から別途ご連絡します
              </p>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl text-sm"
              style={{ background: "rgba(181,56,75,0.1)", color: "var(--color-brand)" }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={bookMutation.isPending}
            className="w-full py-4 rounded-2xl font-bold text-white text-base flex items-center justify-center gap-2"
            style={{ background: "var(--color-brand)" }}
          >
            {bookMutation.isPending ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                予約中...
              </>
            ) : (
              "予約を確定する"
            )}
          </button>
        </form>

        <p className="text-center text-xs mt-8" style={{ color: "#94A3B8" }}>
          © 2026 Bizolve Consulting, Inc. All rights reserved.
        </p>
      </div>
    </div>
  );
}
