// =============================================================
// 確定した日程・会議URLを、メール本文用の文章にまとめる
// 複数日を一度に確定したときに、1通のメールで「これだけの日程」と「会議URL」を伝えるために使う。
//  ・会議URLが全日程で同じなら、URLは1回だけ書く
//  ・日によって違うなら、日ごとのURLを書く
//  ・URLが未設定なら「別途お知らせします」
// =============================================================

export type ScheduleItem = { startsAt: number; endsAt: number | null; url?: string | null };

const MAX_LISTED = 24; // 長くなりすぎないよう、メールに載せる日程の上限

function partsOf(ts: number, tz: string) {
  const p = new Intl.DateTimeFormat("ja-JP", {
    timeZone: tz, year: "numeric", month: "numeric", day: "numeric", weekday: "narrow", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ts * 1000));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day"), w: get("weekday"), hm: `${get("hour")}:${get("minute")}` };
}

/** 例: 2026年10月20日(火) 19:00〜20:00 */
export function formatRange(startsAt: number, endsAt: number | null, tz: string): string {
  const s = partsOf(startsAt, tz);
  const date = `${s.y}年${s.m}月${s.d}日(${s.w})`;
  if (endsAt) return `${date} ${s.hm}〜${partsOf(endsAt, tz).hm}`;
  return s.hm === "00:00" ? date : `${date} ${s.hm}`;
}

/** 例: 10/20(火) 19:00〜 */
function shortLabel(startsAt: number, tz: string): string {
  const s = partsOf(startsAt, tz);
  return `${s.m}/${s.d}(${s.w}) ${s.hm}〜`;
}

export function formatScheduleBlock(
  rawItems: ScheduleItem[], tz: string, fallbackUrl?: string | null
): { dateText: string; urlText: string; count: number } {
  const items = [...rawItems].sort((a, b) => a.startsAt - b.startsAt).map((i) => ({ ...i, url: (i.url ?? fallbackUrl ?? "").trim() }));
  const n = items.length;

  let dateText: string;
  if (n === 0) dateText = "（日程未定）";
  else if (n === 1) dateText = formatRange(items[0].startsAt, items[0].endsAt, tz);
  else {
    const shown = items.slice(0, MAX_LISTED).map((i) => `・${formatRange(i.startsAt, i.endsAt, tz)}`);
    const rest = n - shown.length;
    dateText = `全${n}日程\n${shown.join("\n")}${rest > 0 ? `\n…ほか${rest}日程（すべてのミーティングページで確認できます）` : ""}`;
  }

  const urls = items.map((i) => i.url);
  const withUrl = urls.filter(Boolean);
  let urlText: string;
  if (withUrl.length === 0) {
    urlText = "📹 会議URLは別途お知らせします";
  } else if (withUrl.length === n && new Set(withUrl).size === 1) {
    urlText = n === 1 ? `📹 会議URL\n${withUrl[0]}` : `📹 会議URL（全日程共通）\n${withUrl[0]}`;
  } else {
    const lines = items.slice(0, MAX_LISTED).map((i) => `・${shortLabel(i.startsAt, tz)}　${i.url || "（URLは別途お知らせします）"}`);
    const rest = n - lines.length;
    urlText = `📹 会議URL（日ごとに異なります）\n${lines.join("\n")}${rest > 0 ? `\n…ほか${rest}日程` : ""}`;
  }
  return { dateText, urlText, count: n };
}
