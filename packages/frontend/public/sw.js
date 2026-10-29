// =============================================================
// Service Worker — Web Push受信・通知タップ時の遷移のみを担当
// （オフラインキャッシュ等は行わない。PWAインストール可能化とPush受信が目的）
// プッシュ通知が届いたとき、アプリを開いている画面には「新着あり」を知らせて、画面をすぐに更新させる（use-live-updates.ts）。
// いま見ている画面があるときは、端末の通知は出さず、画面の中でお知らせする。見ていないときだけ、端末の通知を出す
// =============================================================

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "BizQuest", body: event.data.text() };
  }

  const title = payload.title || "BizQuest";
  const url = payload.url || "/home";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url },
  };

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientList) client.postMessage({ type: "push", title, body: payload.body || "", url });
    const watching = clientList.some((client) => client.visibilityState === "visible" && client.focused);
    if (watching) return;
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/home";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});
