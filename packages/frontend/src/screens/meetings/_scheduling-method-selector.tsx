// =============================================================
// 「日程の決め方」選択カード（公開予約URL／候補日提示）
// メンバー向け・外部ゲスト招待向けの両方から共通で使う。
// 公開予約URLは常に上、候補日提示は常に下（既定選択）で統一する。
// =============================================================
export type SchedulingMethod = "public_url" | "candidates";

const COPY: Record<"member" | "guest", { publicUrlLabel: string; candidatesLabel: string; candidatesDesc: string }> = {
  member: {
    publicUrlLabel: "公開予約URLを使う",
    candidatesLabel: "候補日を選んで提示する",
    candidatesDesc: "あなたが提案した日時の中から、相手に選んでもらいます",
  },
  guest: {
    publicUrlLabel: "公開予約URLを送る",
    candidatesLabel: "候補日を絞って送る",
    candidatesDesc: "あなたが提案した日時の中から、相手に選んでもらいます",
  },
};

export function SchedulingMethodSelector({
  method,
  onChange,
  googleConnected,
  copy = "member",
}: {
  method: SchedulingMethod;
  onChange: (method: SchedulingMethod) => void;
  googleConnected: boolean;
  copy?: "member" | "guest";
}) {
  const c = COPY[copy];

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => googleConnected && onChange("public_url")}
        disabled={!googleConnected}
        className="w-full text-left rounded-2xl px-3.5 py-3 flex items-start gap-2.5 transition"
        style={{
          border: !googleConnected
            ? "1.5px dashed var(--color-paper-300)"
            : method === "public_url" ? "1.5px solid var(--color-brand)" : "1.5px solid var(--color-paper-300)",
          background: !googleConnected ? "var(--color-paper-100)" : method === "public_url" ? "var(--color-paper-50)" : "var(--color-paper-50)",
          cursor: googleConnected ? "pointer" : "not-allowed",
        }}
      >
        <span
          className="w-4 h-4 rounded-full mt-0.5 shrink-0"
          style={{
            border: method === "public_url" && googleConnected ? "5px solid var(--color-brand)" : "2px solid var(--color-paper-300)",
          }}
        />
        <span className="flex-1 min-w-0">
          <span
            className="block text-sm font-semibold"
            style={{ color: !googleConnected ? "var(--color-ink-300)" : method === "public_url" ? "var(--color-brand)" : "var(--color-ink-800)" }}
          >
            📅 {c.publicUrlLabel}{!googleConnected && "（未連携）"}
          </span>
          <span className="block text-xs mt-0.5" style={{ color: !googleConnected ? "var(--color-ink-300)" : "var(--color-ink-500)" }}>
            {!googleConnected ? (
              <>
                カレンダー連携をすると使えるようになります。
                <a href="/scheduler/settings" className="font-medium underline" style={{ color: "var(--color-ink-400)" }} onClick={(e) => e.stopPropagation()}>
                  連携する →
                </a>
              </>
            ) : (
              "相手があなたのカレンダーから空いている日時を選びます"
            )}
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={() => onChange("candidates")}
        className="w-full text-left rounded-2xl px-3.5 py-3 flex items-start gap-2.5 transition"
        style={{
          border: method === "candidates" ? "1.5px solid var(--color-brand)" : "1.5px solid var(--color-paper-300)",
          background: "var(--color-paper-50)",
        }}
      >
        <span
          className="w-4 h-4 rounded-full mt-0.5 shrink-0"
          style={{ border: method === "candidates" ? "5px solid var(--color-brand)" : "2px solid var(--color-paper-300)" }}
        />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold" style={{ color: method === "candidates" ? "var(--color-brand)" : "var(--color-ink-800)" }}>
            🗓 {c.candidatesLabel}
          </span>
          <span className="block text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>{c.candidatesDesc}</span>
        </span>
      </button>
    </div>
  );
}
