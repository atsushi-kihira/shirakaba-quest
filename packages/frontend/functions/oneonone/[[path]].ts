import { withSchedulerMeta } from "../_scheduler-meta";

// /oneonone 配下のうち、外部の方に共有する公開ページ（メール経由の返答・ゲスト招待）だけを対象にする
export const onRequestGet = ({ request, next }: { request: Request; next: () => Promise<Response> }): Promise<Response> => {
  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/oneonone/respond/") || pathname.startsWith("/oneonone/guest/")) return withSchedulerMeta(next);
  return next();
};
