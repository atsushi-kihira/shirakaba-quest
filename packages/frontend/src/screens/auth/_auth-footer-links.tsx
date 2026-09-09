// ログイン画面・アカウント作成画面共通の最小フッター
// （Zoom連携ガイド・運営会社・事業会社の記載のみ。他画面の全機能フッターとは別）
export function AuthFooterLinks() {
  return (
    <div className="mt-8 flex flex-col items-center gap-2">
      <a
        href="/zoom-integration"
        className="text-xs underline hover:opacity-70 transition"
        style={{ color: "var(--color-ink-400)" }}
      >
        Zoom連携ガイド
      </a>
      <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center text-xs" style={{ color: "var(--color-ink-400)" }}>
        <span>
          運営：
          <a href="https://bizolve.jp" target="_blank" rel="noopener noreferrer"
            className="underline hover:opacity-70 transition ml-1">
            株式会社Bizolve Consulting
          </a>
        </span>
        <span>
          事業者：
          <a href="https://www.maru-hiro.net/index.html" target="_blank" rel="noopener noreferrer"
            className="underline hover:opacity-70 transition ml-1">
            株式会社丸廣
          </a>
        </span>
      </div>
    </div>
  );
}
