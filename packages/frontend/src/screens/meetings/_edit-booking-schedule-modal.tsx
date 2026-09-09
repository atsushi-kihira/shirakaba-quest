// =============================================================
// ビジター（外部ゲスト）との1to1予約の日時・会議URLを手動で編集するモーダル
// メンバー同士の1to1の「日時・会議URLを編集」と同様、実際に発行済みの
// Google Meet/Zoomの予定そのものは変更せず、記録の更新のみを行う。
// Zoom/Google Meetと連携済みの場合は、その場で実際の会議URLを発行することもできる。
// =============================================================
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Loader2, CalendarClock } from "lucide-react";
import { api, ApiError } from "@/lib/api";

type ConferenceMode = "manual" | "zoom" | "google_meet" | "none";

function toLocalDateInput(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}

function toLocalTimeInput(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));
}

export function EditBookingScheduleModal({
  bookingId,
  currentStartAtUtc,
  currentEndAtUtc,
  currentConferenceUrl,
  onClose,
}: {
  bookingId: string;
  currentStartAtUtc: string;
  currentEndAtUtc: string;
  currentConferenceUrl: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [date, setDate] = useState(toLocalDateInput(currentStartAtUtc));
  const [startTime, setStartTime] = useState(toLocalTimeInput(currentStartAtUtc));
  const [endTime, setEndTime] = useState(toLocalTimeInput(currentEndAtUtc));
  const [conferenceUrl, setConferenceUrl] = useState(currentConferenceUrl ?? "");
  const [mode, setMode] = useState<ConferenceMode>("manual");
  const [error, setError] = useState("");

  const { data: googleStatus } = useQuery({
    queryKey: ["scheduler", "google-status"],
    queryFn: () => api.get<{ data: { connected: boolean } }>("/scheduler/oauth/google/status"),
  });
  const { data: zoomStatus } = useQuery({
    queryKey: ["scheduler", "zoom-status"],
    queryFn: () => api.get<{ data: { connected: boolean } }>("/scheduler/oauth/zoom/status"),
  });
  const googleConnected = googleStatus?.data.connected ?? false;
  const zoomConnected = zoomStatus?.data.connected ?? false;

  const submit = useMutation({
    mutationFn: () => {
      const startUtc = new Date(`${date}T${startTime}:00+09:00`).toISOString();
      const endUtc = new Date(`${date}T${endTime}:00+09:00`).toISOString();
      if (new Date(endUtc).getTime() <= new Date(startUtc).getTime()) {
        throw new Error("終了時刻は開始時刻より後にしてください");
      }
      if (mode === "manual" || mode === "none") {
        return api.patch(`/scheduler/bookings/${bookingId}/reschedule`, {
          startUtc,
          endUtc,
          conferenceUrl: mode === "none" ? null : (conferenceUrl.trim() || null),
        });
      }
      return api.patch(`/scheduler/bookings/${bookingId}/reschedule`, {
        startUtc,
        endUtc,
        conferenceType: mode,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduler", "bookings"] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "エラーが発生しました"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold flex items-center gap-1.5" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            <CalendarClock size={18} />
            日時・会議URLを編集
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg" style={{ color: "var(--color-ink-400)" }}>
            <X size={18} />
          </button>
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--color-ink-500)" }}>
          記録の更新のみ行われます。発行済みの会議URLのカレンダー予定自体は変更されません。
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>日付</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border"
              style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>開始時刻</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border"
                style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>終了時刻</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border"
                style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-ink-600)" }}>会議URLの設定方法</label>
            <div className="grid grid-cols-4 gap-1.5">
              <button type="button" onClick={() => setMode("manual")}
                className="py-2 rounded-xl text-xs font-medium transition"
                style={{ background: mode === "manual" ? "var(--color-brand)" : "var(--color-paper-200)", color: mode === "manual" ? "white" : "var(--color-ink-600)" }}>
                手入力
              </button>
              <button type="button" onClick={() => zoomConnected && setMode("zoom")} disabled={!zoomConnected}
                className="py-2 rounded-xl text-xs font-medium transition disabled:opacity-40"
                style={{ background: mode === "zoom" ? "var(--color-brand)" : "var(--color-paper-200)", color: mode === "zoom" ? "white" : "var(--color-ink-600)" }}>
                Zoomで生成
              </button>
              <button type="button" onClick={() => googleConnected && setMode("google_meet")} disabled={!googleConnected}
                className="py-2 rounded-xl text-xs font-medium transition disabled:opacity-40"
                style={{ background: mode === "google_meet" ? "var(--color-brand)" : "var(--color-paper-200)", color: mode === "google_meet" ? "white" : "var(--color-ink-600)" }}>
                Meetで生成
              </button>
              <button type="button" onClick={() => { setMode("none"); setConferenceUrl(""); }}
                className="py-2 rounded-xl text-xs font-medium transition"
                style={{ background: mode === "none" ? "var(--color-brand)" : "var(--color-paper-200)", color: mode === "none" ? "white" : "var(--color-ink-600)" }}>
                URLなし
              </button>
            </div>
            {(!zoomConnected || !googleConnected) && (
              <p className="text-[11px] mt-1" style={{ color: "var(--color-ink-400)" }}>
                連携していないサービスは選べません（マイページ→日程調整設定→外部サービス連携）
              </p>
            )}
          </div>

          {mode === "none" ? (
            <p className="text-[11px] px-1" style={{ color: "var(--color-ink-400)" }}>
              保存すると、会議URLは設定なし（空欄）になります。
            </p>
          ) : mode === "manual" ? (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>会議URL（任意）</label>
              <input
                type="text"
                value={conferenceUrl}
                onChange={(e) => setConferenceUrl(e.target.value)}
                placeholder="https://zoom.us/j/..."
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border"
                style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
              />
            </div>
          ) : (
            <p className="text-[11px]" style={{ color: "var(--color-ink-400)" }}>
              保存すると、上記の日時で{mode === "zoom" ? "Zoom" : "Google Meet"}の会議URLをその場で発行します
            </p>
          )}

          {error && (
            <p className="text-sm text-center px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>
              {error}
            </p>
          )}

          <button
            onClick={() => { setError(""); submit.mutate(); }}
            disabled={submit.isPending}
            className="w-full py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}
          >
            {submit.isPending ? <Loader2 size={16} className="animate-spin" /> : <CalendarClock size={16} />}
            保存する
          </button>
        </div>
      </div>
    </div>
  );
}
