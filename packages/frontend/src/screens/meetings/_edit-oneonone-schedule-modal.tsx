// =============================================================
// 1to1の日時・会議URLを手動で設定/編集するモーダル
// 別の手段（カレンダー・メール等）で日程調整した場合に使う。
// Zoom/Google Meetと連携済みの場合は、その場で実際の会議URLを発行することもできる。
// =============================================================
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Loader2, CalendarClock } from "lucide-react";
import { api, ApiError } from "@/lib/api";

type ConferenceMode = "manual" | "zoom" | "google_meet" | "none";
const DURATION_OPTIONS = [30, 45, 60, 90];

function toLocalDateInput(ts: number | null): string {
  if (!ts) return "";
  const tokyo = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ts * 1000));
  return tokyo;
}

function toLocalTimeInput(ts: number | null): string {
  if (!ts) return "10:00";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(ts * 1000));
}

export function EditOneOnOneScheduleModal({
  sessionId,
  currentScheduledFor,
  currentConferenceUrl,
  onClose,
}: {
  sessionId: string;
  currentScheduledFor: number | null;
  currentConferenceUrl: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [date, setDate] = useState(toLocalDateInput(currentScheduledFor));
  const [time, setTime] = useState(toLocalTimeInput(currentScheduledFor));
  const [conferenceUrl, setConferenceUrl] = useState(currentConferenceUrl ?? "");
  const [mode, setMode] = useState<ConferenceMode>("manual");
  const [duration, setDuration] = useState(30);
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
      const scheduledForUtc = date ? new Date(`${date}T${time}:00+09:00`).toISOString() : null;
      if (mode === "manual" || mode === "none") {
        return api.patch(`/oneonone/${sessionId}/schedule`, {
          scheduledForUtc,
          conferenceUrl: mode === "none" ? null : (conferenceUrl.trim() || null),
        });
      }
      if (!scheduledForUtc) throw new Error("日時を指定してください");
      const endAtUtc = new Date(new Date(scheduledForUtc).getTime() + duration * 60_000).toISOString();
      return api.patch(`/oneonone/${sessionId}/schedule`, {
        scheduledForUtc,
        endAtUtc,
        conferenceType: mode,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["oneonone"] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "エラーが発生しました"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold flex items-center gap-1.5" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            <CalendarClock size={18} />
            日時・会議URLを設定
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg" style={{ color: "var(--color-ink-400)" }}>
            <X size={18} />
          </button>
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--color-ink-500)" }}>
          カレンダーやメールなど、BizQuest以外の方法で日程調整した場合、実施日時と会議URLをここに記録できます。
        </p>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
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
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>時刻</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                disabled={!date}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border disabled:opacity-50"
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
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>所要時間</label>
              <div className="flex gap-2">
                {DURATION_OPTIONS.map((d) => (
                  <button key={d} type="button" onClick={() => setDuration(d)}
                    className="flex-1 py-2 rounded-xl text-sm font-medium transition"
                    style={{ background: duration === d ? "var(--color-brand)" : "var(--color-paper-200)", color: duration === d ? "white" : "var(--color-ink-600)" }}>
                    {d}分
                  </button>
                ))}
              </div>
              <p className="text-[11px] mt-1" style={{ color: "var(--color-ink-400)" }}>
                保存すると、指定した日時・所要時間で{mode === "zoom" ? "Zoom" : "Google Meet"}の会議URLをその場で発行します
              </p>
            </div>
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
