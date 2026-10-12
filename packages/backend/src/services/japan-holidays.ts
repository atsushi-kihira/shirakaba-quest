// =============================================================
// 日本の祝日判定（1980〜2099年）
// 定例会の「月末（土日祝の場合は直前の平日）」の計算に使う。
// 祝日法の規則（固定日・ハッピーマンデー・春分/秋分・振替休日・国民の休日）に基づく計算で、
// 2019年の即位に伴う臨時の祝日（5/1・10/22）と、2020・2021年の東京五輪に伴う移動は個別に扱う。
// =============================================================

function nthMonday(year: number, month: number, n: number): number {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((1 - firstDow + 7) % 7) + (n - 1) * 7;
}

function springEquinoxDay(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}
function autumnEquinoxDay(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

/** 振替休日・国民の休日を除いた、その年の祝日（"M-D" の集合） */
function baseHolidays(year: number): Set<string> {
  const h = new Set<string>();
  const add = (m: number, d: number) => h.add(`${m}-${d}`);
  add(1, 1);
  if (year >= 2000) add(1, nthMonday(year, 1, 2)); else add(1, 15);
  if (year >= 1967) add(2, 11);
  if (year >= 2020) add(2, 23);
  add(3, springEquinoxDay(year));
  add(4, 29); // 昭和の日（〜2006は天皇誕生日・みどりの日、日付は同じ）
  add(5, 3);
  if (year >= 2007) add(5, 4);
  add(5, 5);
  if (year === 2020) add(7, 23);
  else if (year === 2021) add(7, 22);
  else if (year >= 2003) add(7, nthMonday(year, 7, 3));
  else if (year >= 1996) add(7, 20);
  if (year === 2020) add(8, 10);
  else if (year === 2021) add(8, 8);
  else if (year >= 2016) add(8, 11);
  if (year >= 2003) add(9, nthMonday(year, 9, 3)); else add(9, 15);
  add(9, autumnEquinoxDay(year));
  if (year === 2020) add(7, 24);
  else if (year === 2021) add(7, 23);
  else if (year >= 2000) add(10, nthMonday(year, 10, 2)); else add(10, 10);
  add(11, 3);
  add(11, 23);
  if (year >= 1989 && year <= 2018) add(12, 23);
  if (year === 2019) { add(5, 1); add(10, 22); }
  return h;
}

const cache = new Map<number, Set<string>>();

function holidaysOf(year: number): Set<string> {
  const cached = cache.get(year);
  if (cached) return cached;
  const h = baseHolidays(year);
  // 国民の休日：前日と翌日がどちらも祝日である平日
  for (let m = 1; m <= 12; m++) {
    const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
    for (let d = 2; d < last; d++) {
      if (h.has(`${m}-${d}`)) continue;
      const dow = new Date(Date.UTC(year, m - 1, d)).getUTCDay();
      if (dow !== 0 && h.has(`${m}-${d - 1}`) && h.has(`${m}-${d + 1}`)) h.add(`${m}-${d}`);
    }
  }
  // 振替休日：日曜が祝日のとき、その後の最初の祝日でない日
  for (const key of [...h]) {
    const [m, d] = key.split("-").map(Number);
    if (new Date(Date.UTC(year, m - 1, d)).getUTCDay() !== 0) continue;
    let t = new Date(Date.UTC(year, m - 1, d + 1));
    while (t.getUTCFullYear() === year && h.has(`${t.getUTCMonth() + 1}-${t.getUTCDate()}`)) t = new Date(t.getTime() + 86400_000);
    if (t.getUTCFullYear() === year) h.add(`${t.getUTCMonth() + 1}-${t.getUTCDate()}`);
  }
  cache.set(year, h);
  return h;
}

export function isJapanHoliday(year: number, month: number, day: number): boolean {
  return holidaysOf(year).has(`${month}-${day}`);
}
