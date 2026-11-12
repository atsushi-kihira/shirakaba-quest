// =============================================================
// 「新しい版があります」のお知らせ
//   画面を開いたままの人は、公開後も古い版の画面で動いている。古い画面のままだと、新しくなった裏側の仕組みとかみ合わず、
//   ボタンを押したあとに画面が真っ白になることがある。公開された新しい版を見つけたら、画面の更新をお願いする。
//   版の目印は、公開のたびに変わる /version.json（vite.config.ts が書き出す）と、この画面に埋め込まれた __BUILD_ID__ を比べる。
// =============================================================
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { hasNewVersion } from "@/lib/app-version";

/** 確認する間隔（ミリ秒）。画面にもどってきたときにも確認する */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function UpdateNotice() {
  const [stale, setStale] = useState(false);

  const check = useCallback(async () => {
    if (await hasNewVersion()) setStale(true);
  }, []);

  useEffect(() => {
    const first = setTimeout(check, 30_000);
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(first); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [check]);

  if (!stale) return null;
  return (
    <div role="status" aria-live="polite"
      className="fixed left-3 right-3 top-3 z-[60] mx-auto max-w-md rounded-2xl px-4 py-3 shadow-lg flex items-center gap-3"
      style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-accent)", color: "var(--color-ink-800)" }}>
      <RefreshCw size={18} className="shrink-0" style={{ color: "var(--color-accent)" }} />
      <p className="text-xs flex-1 min-w-0">新しい版が公開されました。画面を更新すると、新しい機能が使えます。</p>
      <button type="button" onClick={() => window.location.reload()}
        className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-full text-white" style={{ background: "var(--color-brand)" }}>
        更新する
      </button>
    </div>
  );
}
