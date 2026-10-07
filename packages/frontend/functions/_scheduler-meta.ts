// =============================================================
// スケジューラー関連の公開ページ（予約ページ・日程回答ページ・招待ページなど）の <head> を、
// アプリ名（既定「白樺クエスト」）に書き換えて返す Cloudflare Pages Function 用の共通処理。
//
// DMやチャットでURLを共有したときのリンクプレビューは、ブラウザでJavaScriptが動く前の
// 「サーバーが返すHTML」から作られる。静的な index.html のままだと「BizQuest」と表示されてしまい、
// 「白樺クエスト」を使っているつもりの相手に違和感を与えるため、返却時にここで差し替える。
// =============================================================

const DEFAULT_APP_TITLE = "白樺クエスト";

type RewriterElement = { setAttribute(name: string, value: string): void; setInnerContent(text: string): void };
type RewriterHandler = { element(el: RewriterElement): void };
type RewriterLike = {
  on(selector: string, handler: RewriterHandler): RewriterLike;
  transform(res: Response): Response;
};
declare const HTMLRewriter: { new (): RewriterLike };

async function fetchAppTitle(): Promise<string> {
  try {
    const res = await fetch("https://bizquest-api.bizolve.jp/api/settings", { cf: { cacheTtl: 300, cacheEverything: true } } as RequestInit);
    if (res.ok) {
      const json = (await res.json()) as { data?: { appTitle?: string } };
      if (json?.data?.appTitle) return json.data.appTitle;
    }
  } catch {
    // 取得に失敗した場合は既定のアプリ名を使う
  }
  return DEFAULT_APP_TITLE;
}

export async function withSchedulerMeta(next: () => Promise<Response>): Promise<Response> {
  const res = await next();
  if (!(res.headers.get("content-type") ?? "").includes("text/html")) return res;

  const appTitle = await fetchAppTitle();
  const description = `${appTitle}の日程調整ページです。`;
  const setContent = (value: string): RewriterHandler => ({ element: (el) => el.setAttribute("content", value) });

  return new HTMLRewriter()
    .on("title", { element: (el) => el.setInnerContent(appTitle) })
    .on('meta[property="og:title"]', setContent(appTitle))
    .on('meta[property="og:site_name"]', setContent(appTitle))
    .on('meta[property="og:description"]', setContent(description))
    .on('meta[name="description"]', setContent(description))
    .on('meta[name="apple-mobile-web-app-title"]', setContent(appTitle))
    .transform(res);
}
