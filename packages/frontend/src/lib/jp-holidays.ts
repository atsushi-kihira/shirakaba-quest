// =============================================================
// 日本の祝日（国民の祝日）の判定。外部ライブラリなしで計算する。
//   ・固定日、ハッピーマンデー、春分の日・秋分の日（1980〜2099年の近似式）
//   ・振替休日（祝日が日曜のとき、次の祝日でない日）
//   ・国民の休日（前後を祝日にはさまれた平日）
//   ・東京2020の特例（海の日・スポーツの日・山の日の移動）、2019年の即位に伴う祝日
// 2000年以降の日付に対応する（それ以前は、祝日の名称や日付が異なるため正確ではない）。
// =============================================================

/** 年ごとの祝日表 "月-日" → 祝日名 */
const cache = new Map<number, Map<string, string>>();

function key(m: number, d: number): string {
  return `${m}-${d}`;
}

/** その月の第n月曜日の日付 */
function nthMonday(year: number, month: number, n: number): number {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=日
  const firstMonday = 1 + ((8 - firstDow) % 7);
  return firstMonday + (n - 1) * 7;
}

function vernalEquinoxDay(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function autumnalEquinoxDay(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function buildYear(year: number): Map<string, string> {
  const base = new Map<string, string>();
  const add = (m: number, d: number, name: string) => { base.set(key(m, d), name); };

  add(1, 1, "元日");
  add(1, nthMonday(year, 1, 2), "成人の日");
  add(2, 11, "建国記念の日");
  if (year >= 2020) add(2, 23, "天皇誕生日");
  add(3, vernalEquinoxDay(year), "春分の日");
  add(4, 29, "昭和の日");
  add(5, 3, "憲法記念日");
  add(5, 4, "みどりの日");
  add(5, 5, "こどもの日");
  if (year === 2019) add(5, 1, "休日（天皇の即位の日）");

  // 海の日・山の日・スポーツの日（東京2020の特例あり）
  if (year === 2020) {
    add(7, 23, "海の日"); add(7, 24, "スポーツの日"); add(8, 10, "山の日");
  } else if (year === 2021) {
    add(7, 22, "海の日"); add(7, 23, "スポーツの日"); add(8, 8, "山の日");
  } else {
    if (year >= 2003) add(7, nthMonday(year, 7, 3), "海の日");
    if (year >= 2016) add(8, 11, "山の日");
    if (year >= 2000) add(10, nthMonday(year, 10, 2), year >= 2020 ? "スポーツの日" : "体育の日");
  }
  if (year >= 2003) add(9, nthMonday(year, 9, 3), "敬老の日");
  add(9, autumnalEquinoxDay(year), "秋分の日");
  if (year === 2019) add(10, 22, "休日（即位礼正殿の儀）");
  add(11, 3, "文化の日");
  add(11, 23, "勤労感謝の日");

  // 国民の休日：前日と翌日がどちらも祝日の、日曜でない平日
  const result = new Map(base);
  const dayOfWeek = (m: number, d: number) => new Date(Date.UTC(year, m - 1, d)).getUTCDay();
  for (let m = 1; m <= 12; m++) {
    const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
    for (let d = 2; d < last; d++) {
      if (result.has(key(m, d)) || dayOfWeek(m, d) === 0) continue;
      if (base.has(key(m, d - 1)) && base.has(key(m, d + 1))) result.set(key(m, d), "国民の休日");
    }
  }

  // 振替休日：祝日が日曜なら、その後の最初の祝日でない日（2007年〜）
  if (year >= 2007) {
    for (const k of [...base.keys()].sort((a, b) => {
      const [am, ad] = a.split("-").map(Number); const [bm, bd] = b.split("-").map(Number);
      return am - bm || ad - bd;
    })) {
      const [m, d] = k.split("-").map(Number);
      if (dayOfWeek(m, d) !== 0) continue;
      let dt = new Date(Date.UTC(year, m - 1, d + 1));
      while (result.has(key(dt.getUTCMonth() + 1, dt.getUTCDate())) && dt.getUTCFullYear() === year) {
        dt = new Date(dt.getTime() + 86400000);
      }
      if (dt.getUTCFullYear() === year) result.set(key(dt.getUTCMonth() + 1, dt.getUTCDate()), "振替休日");
    }
  }
  return result;
}

/** 祝日なら祝日名、そうでなければ null（year・month は 1 始まり） */
export function getJpHoliday(year: number, month: number, day: number): string | null {
  let table = cache.get(year);
  if (!table) { table = buildYear(year); cache.set(year, table); }
  return table.get(key(month, day)) ?? null;
}
