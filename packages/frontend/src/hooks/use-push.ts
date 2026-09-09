// =============================================================
// Web Push 通知の購読管理フック
// =============================================================
import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export type PushSupport = "unsupported" | "ios-needs-install" | "supported";

function detectSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (isIOS && !isStandalone) return "ios-needs-install";
  return "supported";
}

export function usePushNotifications() {
  const [support] = useState<PushSupport>(detectSupport);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (support !== "supported") {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setSubscribed(!!sub);
      } catch {
        // 取得失敗時は未購読扱いにする
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [support]);

  const enable = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      if (!("Notification" in window)) {
        setError("お使いのブラウザは通知に対応していません");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("通知が許可されませんでした。ブラウザの設定から通知を許可してください。");
        return;
      }

      const res = await api.get<{ data: { publicKey: string } }>("/push/vapid-public-key");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(res.data.publicKey) as BufferSource,
      });
      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error("購読情報の取得に失敗しました");
      }
      await api.post("/push/subscribe", { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
      setSubscribed(true);
    } catch {
      setError("通知の有効化に失敗しました。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.delete("/push/subscribe", { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch {
      setError("通知の解除に失敗しました");
    } finally {
      setBusy(false);
    }
  }, []);

  return { support, subscribed, loading, busy, error, enable, disable };
}
