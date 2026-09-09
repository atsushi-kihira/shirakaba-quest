// =============================================================
// 「日程を指定して1to1を申し込む」モーダル
// 既に別の手段で日程調整済みの相手に対し、日時・会議ツールを指定して申し込む。
// =============================================================
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Loader2, CalendarClock } from "lucide-react";
import { api, ApiError } from "@/lib/api";

type ZoomStatus = { data: { connected: boolean } };
type GoogleStatus = { data: { connected: boolean } };

const DURATION_OPTIONS = [30, 45, 60, 90];

function todayYMD(): string {
  const now = new Date();
  const tokyo = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  return tokyo;
}

export function PrearrangedRequestModal({
  responderId,
  responderName,
  onClose,
  onSuccess,
}: {
  responderId: string;
  responderName: string;
  onClose: () => void;
  onSuccess: (conferenceUrl: string | null) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(`${responderName}さんとの1to1`);
  const [date, setDate] = useState(todayYMD());
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState(30);
  const [conferenceType, setConferenceType] = useState<"zoom" | "google_meet" | "manual" | "none">("none");
  const [conferenceUrl, setConferenceUrl] = useState("");
  const [note, setNote] = useState("");
  const [notifyByEmail, setNotifyByEmail] = useState(true);
  const [error, setError] = useState("");

  const { data: zoomData } = useQuery<ZoomStatus>({
    queryKey: ["scheduler", "zoom-status"],
    queryFn: () => api.get<ZoomStatus>("/scheduler/oauth/zoom/status"),
  });
  const { data: googleData } = useQuery<GoogleStatus>({
    queryKey: ["scheduler", "google-status"],
    queryFn: () => api.get<GoogleStatus>("/scheduler/oauth/google/status"),
  });
  const zoomConnected = zoomData?.data.connected ?? false;
  const googleConnected = googleData?.data.connected ?? false;

  const submitMutation = useMutation({
    mutationFn: () => {
      const startAtUtc = new Date(`${date}T${time}:00+09:00`).toISOString();
      const endAtUtc = new Date(new Date(startAtUtc).getTime() + duration * 60_000).toISOString();
      if (new Date(startAtUtc).getTime() <= Date.now()) {
        throw new Error("過去の日時は指定できません。これから実施する1to1の日時を入力してください。");
      }
      return api.post<{ data: { id: string; status: string; conferenceUrl: string | null } }>("/oneonone/prearranged", {
        responderId,
        startAtUtc,
        endAtUtc,
        conferenceType: conferenceType === "none" ? "manual" : conferenceType,
        conferenceUrl: conferenceType === "manual" ? (conferenceUrl.trim() || undefined) : undefined,
        title: title.trim() || undefined,
        note: note.trim() || undefined,
        notifyByEmail,
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["oneonone"] });
      onSuccess(res.data.conferenceUrl);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "エラーが発生しました"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="card-paper rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            <CalendarClock size={20} />
            日程を指定して申し込む
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-xl" style={{ color: "var(--color-ink-400)" }}>
            <X size={18} />
          </button>
        </div>

        <p className="text-xs mb-4" style={{ color: "var(--color-ink-500)" }}>
          {responderName}さんと既に別の手段で日程調整が済んでいる場合、その日時を指定して申し込めます。{responderName}さんは日程調整不要で「承諾する」か「断る」のみ回答します。
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>ミーティングのタイトル</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`${responderName}さんとの1to1`}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border"
              style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
            />
            <p className="text-[11px] mt-1" style={{ color: "var(--color-ink-400)" }}>
              カレンダーやZoomの予定名として使われます
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>日付</label>
              <input
                type="date"
                value={date}
                min={todayYMD()}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border"
                style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>開始時刻</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border"
                style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>所要時間</label>
            <div className="flex gap-2">
              {DURATION_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className="flex-1 py-2 rounded-xl text-sm font-medium transition"
                  style={{
                    background: duration === d ? "var(--color-brand)" : "var(--color-paper-200)",
                    color: duration === d ? "white" : "var(--color-ink-600)",
                  }}
                >
                  {d}分
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-ink-600)" }}>会議ツール</label>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: zoomConnected ? "var(--color-ink-700)" : "var(--color-ink-300)" }}>
                <input type="radio" checked={conferenceType === "zoom"} disabled={!zoomConnected} onChange={() => setConferenceType("zoom")} />
                🎥 Zoom{!zoomConnected && "（未連携）"}
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: googleConnected ? "var(--color-ink-700)" : "var(--color-ink-300)" }}>
                <input type="radio" checked={conferenceType === "google_meet"} disabled={!googleConnected} onChange={() => setConferenceType("google_meet")} />
                📅 Google Meet{!googleConnected && "（未連携）"}
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--color-ink-700)" }}>
                <input type="radio" checked={conferenceType === "manual"} onChange={() => setConferenceType("manual")} />
                ✏️ 会議URLを手入力する
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--color-ink-700)" }}>
                <input type="radio" checked={conferenceType === "none"} onChange={() => setConferenceType("none")} />
                💬 会議URLなし（対面、または別途連絡）
              </label>
            </div>
            {conferenceType === "manual" && (
              <input
                type="text"
                value={conferenceUrl}
                onChange={(e) => setConferenceUrl(e.target.value)}
                placeholder="https://zoom.us/j/..."
                className="w-full mt-2 px-3 py-2.5 rounded-xl text-sm outline-none border"
                style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
              />
            )}
            {!zoomConnected && !googleConnected && (
              <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-400)" }}>
                会議URLを自動発行したい場合は、先に「マイページ→日程調整設定→外部サービス連携」でZoomかGoogleと連携してください。
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>メッセージ（任意）</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="例：先日お話しした件でよろしくお願いします"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border resize-none"
              style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
            />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--color-ink-600)" }}>
            <input type="checkbox" checked={notifyByEmail} onChange={(e) => setNotifyByEmail(e.target.checked)} className="w-4 h-4 rounded" />
            📧 {responderName}さんにメールで通知する
          </label>

          {error && (
            <p className="text-sm text-center px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>
              {error}
            </p>
          )}

          <button
            onClick={() => { setError(""); submitMutation.mutate(); }}
            disabled={submitMutation.isPending}
            className="w-full py-3.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}
          >
            {submitMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <CalendarClock size={16} />}
            この内容で申し込む
          </button>
        </div>
      </div>
    </div>
  );
}
