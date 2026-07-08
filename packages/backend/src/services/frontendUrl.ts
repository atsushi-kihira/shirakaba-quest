// FRONTEND_URL は wrangler secret として登録されるため、末尾スラッシュの有無が
// 環境ごとにブレうる。常に末尾スラッシュなしで返し、二重スラッシュ URL を防ぐ。
export function getFrontendUrl(env: { FRONTEND_URL?: string }): string {
  const raw = env.FRONTEND_URL ?? "https://shirakaba-quest.pages.dev";
  return raw.replace(/\/+$/, "");
}
