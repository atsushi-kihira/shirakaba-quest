// =============================================================
// メンバー同士の1to1の「予定のタイトル」
//
// 以前は、申込み画面のタイトル欄の初期値が「相手さんとの1to1」で、そのまま保存されていた。
// すると、招待された側のカレンダーには、自分の名前の入った「自分さんとの1to1」と出てしまい、
// 誰との1to1か分からなかった。
// そこで、タイトルを自分で書き換えていない場合は、どの画面・どのカレンダーでも
// 「申込んだ人さんと相手さんの1to1」と、両者の名前が入った形で表示する。
// =============================================================

/** 「○○さんとの1to1」の形（申込み画面の初期値、または、それを書き換えていないもの）か */
export function isAutoOneOnOneTitle(title: string | null | undefined): boolean {
  const t = (title ?? "").trim();
  if (!t) return true;
  return /^.+さんとの1to1$/.test(t);
}

/** 自分で書き換えたタイトルだけを返す（初期値のままなら null） */
export function customOneOnOneTitle(title: string | null | undefined): string | null {
  return isAutoOneOnOneTitle(title) ? null : (title ?? "").trim();
}

/** 予定に付けるタイトル。書き換えていなければ「AさんとBさんの1to1」の形にする */
export function oneOnOneTitle(
  title: string | null | undefined,
  requesterName: string | null | undefined,
  responderName: string | null | undefined,
): string {
  return customOneOnOneTitle(title) ?? `${requesterName || "メンバー"}さんと${responderName || "メンバー"}さんの1to1`;
}
