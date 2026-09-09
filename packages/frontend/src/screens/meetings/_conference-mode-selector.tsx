// =============================================================
// 会議URLの設定方法を選ぶ4択UI（手入力／Zoom自動生成／Meet自動生成／URLなし）
// 複数人ミーティング・定例会を「確定日として作成する」ときに共通で使う。
// =============================================================
export type ConferenceMode = "manual" | "zoom" | "google_meet" | "none";

export function ConferenceModeSelector({
  mode,
  onModeChange,
  conferenceUrl,
  onConferenceUrlChange,
  zoomConnected,
  googleConnected,
}: {
  mode: ConferenceMode;
  onModeChange: (mode: ConferenceMode) => void;
  conferenceUrl: string;
  onConferenceUrlChange: (url: string) => void;
  zoomConnected: boolean;
  googleConnected: boolean;
}) {
  return (
    <div>
      <div className="grid grid-cols-4 gap-1.5">
        <button type="button" onClick={() => onModeChange("manual")}
          className="py-2 rounded-xl text-xs font-medium transition"
          style={{ background: mode === "manual" ? "var(--color-brand)" : "var(--color-paper-200)", color: mode === "manual" ? "white" : "var(--color-ink-600)" }}>
          手入力
        </button>
        <button type="button" onClick={() => zoomConnected && onModeChange("zoom")} disabled={!zoomConnected}
          className="py-2 rounded-xl text-xs font-medium transition disabled:opacity-40"
          style={{ background: mode === "zoom" ? "var(--color-brand)" : "var(--color-paper-200)", color: mode === "zoom" ? "white" : "var(--color-ink-600)" }}>
          Zoomで生成
        </button>
        <button type="button" onClick={() => googleConnected && onModeChange("google_meet")} disabled={!googleConnected}
          className="py-2 rounded-xl text-xs font-medium transition disabled:opacity-40"
          style={{ background: mode === "google_meet" ? "var(--color-brand)" : "var(--color-paper-200)", color: mode === "google_meet" ? "white" : "var(--color-ink-600)" }}>
          Meetで生成
        </button>
        <button type="button" onClick={() => onModeChange("none")}
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
      {mode === "manual" && (
        <input
          type="text"
          value={conferenceUrl}
          onChange={(e) => onConferenceUrlChange(e.target.value)}
          placeholder="https://zoom.us/j/..."
          className="w-full mt-2 px-3 py-2.5 rounded-xl text-sm outline-none border"
          style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
        />
      )}
    </div>
  );
}
