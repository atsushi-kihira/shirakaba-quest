// =============================================================
// PWA マニフェストを動的に生成する Cloudflare Pages Function
// 組織ごとに管理ダッシュボードで設定されたアプリ名（appTitle）を
// name / short_name に反映する（Web Push通知の送信元表示にも使われる）
// =============================================================

export async function onRequestGet(): Promise<Response> {
  let appTitle = "BizQuest";

  try {
    const res = await fetch("https://bizquest-api.bizolve.jp/api/settings");
    if (res.ok) {
      const json = (await res.json()) as { data?: { appTitle?: string } };
      if (json?.data?.appTitle) {
        appTitle = json.data.appTitle;
      }
    }
  } catch {
    // 取得に失敗した場合はデフォルトのアプリ名を使う
  }

  const manifest = {
    name: appTitle,
    short_name: appTitle,
    description: "ビジネスネットワーク・コミュニティのメンバー同士がカードゲームを通じてお互いを深く理解し、信頼のネットワークを築くためのプラットフォーム",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: "#faf5e8",
    theme_color: "#b5384b",
    lang: "ja",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
