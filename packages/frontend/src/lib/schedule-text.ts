// =============================================================
// 確定した日程と会議URLを、メールやDMでそのまま貼り付けて伝えられるテキストにまとめる
//  ・会議URLが全日程で同じなら、URLは1回だけ書く
//  ・日によって違うなら、日ごとにURLを書く
// =============================================================
export type ScheduleTextItem = { startsAt: number; endsAt: number | null; url?: string | null };

function parts(ts: number, tz: string) {
  const p = new Intl.DateTimeFormat("ja-JP", {
    timeZone: tz, year: "numeric", month: "numeric", day: "numeric", weekday: "narrow", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ts * 1000));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { date: `${get("year")}年${get("month")}月${get("day")}日(${get("weekday")})`, time: `${get("hour")}:${get("minute")}` };
}

export function formatRangeText(startsAt: number, endsAt: number | null, tz: string): string {
  const s = parts(startsAt, tz);
  return endsAt ? `${s.date} ${s.time}〜${parts(endsAt, tz).time}` : s.time === "00:00" ? s.date : `${s.date} ${s.time}`;
}

export function buildScheduleText(args: {
  title: string; hostName?: string | null; items: ScheduleTextItem[]; tz: string; pageUrl?: string; fallbackUrl?: string | null;
}): string {
  const { title, hostName, tz, pageUrl, fallbackUrl } = args;
  const items = [...args.items].sort((a, b) => a.startsAt - b.startsAt).map((i) => ({ ...i, url: (i.url ?? fallbackUrl ?? "").trim() }));
  const urls = items.map((i) => i.url).filter(Boolean);
  const allSame = urls.length === items.length && items.length > 0 && new Set(urls).size === 1;
  const lines: string[] = [`【${title}】`];
  if (hostName) lines.push(`主催：${hostName}`);
  lines.push("", items.length > 1 ? `▼ 日程（全${items.length}日程）` : "▼ 日程");
  items.forEach((it, i) => {
    const label = formatRangeText(it.startsAt, it.endsAt, tz);
    lines.push(items.length > 1 ? `${i + 1}. ${label}` : label);
    if (!allSame && it.url) lines.push(`   会議URL：${it.url}`);
  });
  if (allSame) lines.push("", items.length > 1 ? "▼ 会議URL（全日程共通）" : "▼ 会議URL", urls[0]);
  else if (urls.length === 0) lines.push("", "※ 会議URLは別途お知らせします");
  else if (urls.length < items.length) lines.push("", "※ URLが未設定の日程は、別途お知らせします");
  if (pageUrl) lines.push("", "▼ 詳細", pageUrl);
  return lines.join("\n");
}
