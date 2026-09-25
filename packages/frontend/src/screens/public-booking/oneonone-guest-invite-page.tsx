// =============================================================
// 外部ゲスト招待（候補日提示方式）の公開ページ。認証不要。
// 招待された本人が提示された候補日から1つを選んで予約を確定する。
// 確定後は既存の公開予約と同じ完了ページ（PublicBookingConfirmation）を再利用する。
// =============================================================
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, User, Mail } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";

type CandidateSlot = { id: string; startAt: number; endAt: number };
type InviteDetail = {
  status: "pending" | "selected" | "cancelled" | "expired";
  hostName: string;
  hostEmoji: string;
  displayTitle: string | null;
  durationMinutes: number | null;
  guestName: string;
  guestEmail: string;
  availableConferenceTypes: ("google_meet" | "zoom")[];
  candidateSlots: CandidateSlot[];
};
type SelectResult = {
  bookingId: string;
  cancellationToken: string;
  conferenceType: string;
  conferenceUrl: string | null;
  startAtUtc: string;
  endAtUtc: string;
};

async function fetchPublic<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  const json = await res.json().catch(() => ({})) as { data?: T; error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? "エラーが発生しました");
  return json.data as T;
}

function fmtDateTime(sec: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric",
    weekday: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(sec * 1000));
}
function fmtTimeOnly(sec: number): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }).format(new Date(sec * 1000));
}

export function OneOnOneGuestInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string>("");
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [conferenceType, setConferenceType] = useState<string | null>(null);
  const [error, setError] = useState("");

  const { data: invite, isLoading } = useQuery<InviteDetail>({
    queryKey: ["oneonone", "guest-invite", token],
    queryFn: () => fetchPublic(`/oneonone/guest/${token}`),
    enabled: !!token,
    retry: false,
  });

  // 招待作成時に分かっていた名前・メールは入力済みの状態で表示する（公開予約URL方式と仕様を揃える）。
  // 通常は修正不要だが、本人がその場で修正して送ることもできる。
  useEffect(() => {
    if (invite?.guestName) setGuestName(invite.guestName);
  }, [invite?.guestName]);
  useEffect(() => {
    if (invite?.guestEmail) setGuestEmail(invite.guestEmail);
  }, [invite?.guestEmail]);
  const availTypes = invite?.availableConferenceTypes ?? [];
  // 2種類連携されている場合、何も選ばずに送信すると先頭固定の候補が黙って選ばれてしまうため、
  // 明示的にZoomを優先した既定値を使う（表示上も選択済みにする）。
  const defaultConferenceType = availTypes.includes("zoom") ? "zoom" : availTypes[0];

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE_URL}/oneonone/guest/${token}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateSlotId: selectedId,
          guestName: guestName.trim(),
          guestEmail: guestEmail.trim(),
          conferenceType: availTypes.length >= 2 ? (conferenceType ?? defaultConferenceType) : undefined,
        }),
      });
      const json = await res.json().catch(() => ({})) as { data?: SelectResult; error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message ?? "予約の確定に失敗しました");
      return json.data!;
    },
    onSuccess: (data) => {
      navigate(`/book/confirmation/${data.cancellationToken}`, {
        state: {
          bookingId: data.bookingId,
          startAtUtc: data.startAtUtc,
          endAtUtc: data.endAtUtc,
          conferenceType: data.conferenceType,
          conferenceUrl: data.conferenceUrl,
          memberName: invite?.hostName,
          displayTitle: invite?.displayTitle ?? "1to1 ミーティング",
        },
      });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "エラーが発生しました"),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--color-paper-50)" }}>
        <Loader2 className="animate-spin" style={{ color: "var(--color-ink-400)" }} />
      </div>
    );
  }

  if (!invite || invite.status !== "pending") {
    const message = invite?.status === "selected"
      ? "この招待はすでに日時が確定しています。"
      : invite?.status === "expired"
        ? "この招待の有効期限が切れています。招待した方に、新しいリンクの発行を依頼してください。"
        : invite?.status === "cancelled"
          ? "この招待は無効になっています。"
          : "招待が見つかりません。";
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--color-paper-50)" }}>
        <div className="text-center max-w-sm">
          <p className="text-4xl mb-4">🔍</p>
          <p style={{ color: "var(--color-ink-600)" }}>{message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--color-paper-50)" }}>
      <div className="max-w-lg mx-auto px-4 py-10">
        <div className="text-center mb-6">
          <p className="text-4xl mb-3">{invite.hostEmoji}</p>
          <h1 className="text-xl font-bold mb-1" style={{ color: "var(--color-ink-900)" }}>
            {invite.hostName}さんとの1to1
          </h1>
          <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
            下記の候補日からご都合の良い日時をお選びください。
          </p>
        </div>

        <div className="rounded-2xl p-4 mb-4" style={{ background: "var(--color-paper-100)" }}>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-ink-500)" }}>
            この招待の宛先
          </p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--color-ink-800)" }}>
              <User size={14} className="shrink-0" style={{ color: "var(--color-ink-400)" }} />
              <span className="font-medium">{invite.guestName ? `${invite.guestName}様` : "ビジター様"}</span>
            </div>
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--color-ink-700)" }}>
              <Mail size={14} className="shrink-0" style={{ color: "var(--color-ink-400)" }} />
              <span className="break-all">{invite.guestEmail || "メールアドレス指定なし"}</span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl p-5" style={{ background: "white", border: "2px solid var(--color-success)" }}>
          <div className="space-y-3 mb-4">
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: "var(--color-ink-700)" }}>
                お名前 <span style={{ color: "var(--color-brand)" }}>*</span>
              </label>
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="山田 太郎"
                className="w-full px-3 py-2.5 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)", background: "white" }}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: "var(--color-ink-700)" }}>
                メールアドレス <span style={{ color: "var(--color-brand)" }}>*</span>
              </label>
              <input
                type="email"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                placeholder="taro@example.com"
                className="w-full px-3 py-2.5 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)", background: "white" }}
              />
            </div>
          </div>

          <div className="space-y-2 mb-4">
            {invite.candidateSlots.map((c) => {
              const selected = c.id === selectedId;
              return (
                <label
                  key={c.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition"
                  style={{ border: selected ? "1.5px solid var(--color-brand)" : "1.5px solid var(--color-paper-300)" }}
                >
                  <input type="radio" checked={selected} onChange={() => setSelectedId(c.id)} className="sr-only" />
                  <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ border: selected ? "4px solid var(--color-brand)" : "2px solid var(--color-paper-300)" }} />
                  <span className="text-sm" style={{ color: "var(--color-ink-800)", fontWeight: selected ? 700 : 400 }}>
                    {fmtDateTime(c.startAt)}〜{fmtTimeOnly(c.endAt)}
                  </span>
                </label>
              );
            })}
          </div>

          {/* 会議ツール選択（2種類連携時のみ、本人が選ぶ） */}
          {availTypes.length >= 2 && (
            <div className="mb-4">
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--color-ink-700)" }}>会議ツール</label>
              <div className="space-y-1.5">
                {availTypes.map((t) => (
                  <label key={t} className="flex items-center gap-2.5 cursor-pointer">
                    <input type="radio" name="conferenceType" checked={(conferenceType ?? defaultConferenceType) === t} onChange={() => setConferenceType(t)} />
                    <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>
                      {t === "google_meet" ? "📹 Google Meet" : "📹 Zoom"}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {availTypes.length === 1 && (
            <div className="rounded-xl p-3 mb-4" style={{ background: "var(--color-paper-100)" }}>
              <p className="text-xs" style={{ color: "var(--color-ink-600)" }}>
                📹 {availTypes[0] === "google_meet" ? "Google Meet" : "Zoom"} のURLが自動発行されます
              </p>
            </div>
          )}
          {availTypes.length === 0 && (
            <div className="rounded-xl p-3 mb-4" style={{ background: "var(--color-paper-100)" }}>
              <p className="text-xs" style={{ color: "var(--color-ink-600)" }}>📞 会議URLは主催者から別途ご連絡します</p>
            </div>
          )}

          {error && (
            <p className="text-xs mb-3 px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>{error}</p>
          )}

          <button
            onClick={() => {
              setError("");
              if (!guestName.trim()) { setError("お名前を入力してください"); return; }
              if (!guestEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail.trim())) { setError("メールアドレスを正しく入力してください"); return; }
              submitMutation.mutate();
            }}
            disabled={!selectedId || submitMutation.isPending}
            className="w-full py-3 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}
          >
            {submitMutation.isPending && <Loader2 size={15} className="animate-spin" />}
            この日時で確定する
          </button>
          <p className="text-[11px] text-center mt-3" style={{ color: "var(--color-ink-400)" }}>🔒 会員登録は不要です</p>
        </div>

        <p className="text-center text-xs mt-8" style={{ color: "#94A3B8" }}>
          © 2026 Bizolve Consulting, Inc. All rights reserved.
        </p>
      </div>
    </div>
  );
}
