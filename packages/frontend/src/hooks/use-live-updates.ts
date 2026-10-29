// =============================================================
// 新着のお知らせを、画面に、すぐに反映する
// プッシュ通知が届いたとき（サービスワーカーからの知らせ）に、画面のデータを取り直す。
// ホーム・通知・ミーティング・1to1などの、他の人からの連絡が、画面を開いたままでも、すぐに表示される。
// 画面を見ているときは、端末の通知は出さずに、画面の中の小さなお知らせ（LiveToast）で知らせる。
// ※ プッシュ通知をオンにしていない場合は、これまでどおり、画面を開き直したとき・一定時間ごとに、更新される
// =============================================================
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type LiveToastData = { title: string; body: string; url: string };

const TOAST_MS = 8000;

export function useLiveUpdates(): { toast: LiveToastData | null; dismiss: () => void } {
  const qc = useQueryClient();
  const [toast, setToast] = useState<LiveToastData | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; title?: string; body?: string; url?: string } | null;
      if (d?.type !== "push") return;
      // 画面のデータを、すぐに取り直す（いま表示している画面の分だけが、取り直される）
      void qc.invalidateQueries();
      setToast({ title: d.title ?? "新しいお知らせ", body: d.body ?? "", url: d.url ?? "/home" });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setToast(null), TOAST_MS);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      if (timer) clearTimeout(timer);
    };
  }, [qc]);

  return { toast, dismiss: () => setToast(null) };
}
