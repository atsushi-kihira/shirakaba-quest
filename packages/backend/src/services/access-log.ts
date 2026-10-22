// =============================================================
// メンバーのアクセス記録と、管理画面のアクセス数グラフ用の集計
// 「アクセス」= メンバーがアプリを開いたこと（ログイン情報の取得）。同じメンバーの5分以内の連続アクセスは1回と数える。
// =============================================================
import { and, desc, eq, gte, lt } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";

const DEDUPE_SECONDS = 5 * 60;

/** アクセスを1件記録する。記録に失敗しても、呼び出し元の処理（ログイン情報の取得）は止めない */
export async function recordAccess(db: Db, memberId: string): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const last = await db.select({ at: schema.accessLogs.createdAt }).from(schema.accessLogs)
      .where(eq(schema.accessLogs.memberId, memberId)).orderBy(desc(schema.accessLogs.createdAt)).limit(1).get();
    if (last && now - last.at < DEDUPE_SECONDS) return;
    await db.insert(schema.accessLogs).values({ memberId, createdAt: now });
  } catch (e) {
    console.error("[access-log] 記録に失敗", e);
  }
}

/** 画面の閲覧として記録する画面（メンバー向けのメニュー単位）と、管理画面での表示名 */
export const VIEW_SCREENS: Record<string, string> = {
  home: "ホーム",
  members: "なかま",
  collab: "協働",
  enishi: "ご縁",
  quests: "お題",
  meetings: "ミーティング",
  oneonone: "1to1",
  ranking: "順位",
  notifications: "通知",
  mypage: "マイページ",
  scheduler: "日程調整設定",
};

/**
 * 画面の閲覧を1件記録する（ホームやミーティングなどを「見ただけ」の利用）。同じメンバー・同じ画面の5分以内の連続閲覧は1回と数える。
 * あわせてアクセス（訪問）も記録する。ログイン済みのまま使い続けている場合も、これでアクセスとして数えられる。
 * 記録に失敗しても、呼び出し元の処理は止めない。
 */
export async function recordScreenView(db: Db, memberId: string, screen: string): Promise<void> {
  if (!(screen in VIEW_SCREENS)) return;
  try {
    const now = Math.floor(Date.now() / 1000);
    const last = await db.select({ at: schema.screenViews.createdAt }).from(schema.screenViews)
      .where(and(eq(schema.screenViews.memberId, memberId), eq(schema.screenViews.screen, screen)))
      .orderBy(desc(schema.screenViews.createdAt)).limit(1).get();
    if (!last || now - last.at >= DEDUPE_SECONDS) {
      await db.insert(schema.screenViews).values({ memberId, screen, createdAt: now });
    }
  } catch (e) {
    console.error("[access-log] 画面の閲覧の記録に失敗", e);
  }
  await recordAccess(db, memberId);
}

export type AccessUnit = "day" | "week" | "month";
export type AccessBucket = { key: string; label: string; count: number; members: number };
export type AccessSummary = {
  /** all = これまでの累計（月ごとの棒） */
  unit: AccessUnit | "all";
  /** 表示している期間の最初の日・最後の日（YYYY-MM-DD、指定のタイムゾーンでの日付）。累計では null */
  rangeStart: string | null;
  rangeEnd: string | null;
  buckets: AccessBucket[];
  total: number;
  uniqueMembers: number;
  /** 記録を始めた日時（記録が1件もなければ null） */
  trackingStartedAt: number | null;
};

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return true; } catch { return false; }
}

export function localParts(tsSec: number, tz: string): { ymd: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(tsSec * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

function ymdToUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function utcMsToYmd(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
const DAY_MS = 24 * 60 * 60 * 1000;

/** 指定した日を含む期間（日・週・月）の最初の日・最後の日（月曜始まりの週） */
export function periodRange(unit: AccessUnit, dateYmd: string): { startMs: number; endMs: number; rangeStart: string; rangeEnd: string } {
  const baseMs = ymdToUtcMs(dateYmd);
  let startMs = baseMs;
  let endMs = baseMs;
  if (unit === "week") {
    const dow = new Date(baseMs).getUTCDay(); // 0=日
    startMs = baseMs - ((dow + 6) % 7) * DAY_MS;
    endMs = startMs + 6 * DAY_MS;
  } else if (unit === "month") {
    const d = new Date(baseMs);
    startMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    endMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
  }
  return { startMs, endMs, rangeStart: utcMsToYmd(startMs), rangeEnd: utcMsToYmd(endMs) };
}

/**
 * 指定した日を含む期間（日・週・月）、または累計（月ごと）のアクセス数を、指定のタイムゾーンで集計する。
 * memberId を指定すると、そのメンバーのアクセスだけを数える。
 */
export async function summarizeAccess(db: Db, unit: AccessUnit | "all", dateYmd: string, tzInput: string, memberId?: string): Promise<AccessSummary> {
  const tz = isValidTimeZone(tzInput) ? tzInput : "Asia/Tokyo";
  const who = memberId ? eq(schema.accessLogs.memberId, memberId) : undefined;

  const first = await db.select({ at: schema.accessLogs.createdAt }).from(schema.accessLogs)
    .where(who).orderBy(schema.accessLogs.createdAt).limit(1).get();
  const trackingStartedAt = first?.at ?? null;

  // バケット（棒）の用意
  const buckets: { key: string; label: string; count: number; members: Set<string> }[] = [];
  let rangeStart: string | null = null;
  let rangeEnd: string | null = null;
  let fromSec = 0;
  let toSec = Number.MAX_SAFE_INTEGER;
  /** 日時をどの棒に入れるか（範囲外なら null） */
  let keyOf: (ymd: string, hour: number) => string | null;

  if (unit === "all") {
    // 最初の記録の月から今月まで、月ごとに1本（記録がなければ今月だけ）
    const startYmd = localParts(trackingStartedAt ?? Math.floor(Date.now() / 1000), tz).ymd;
    const endYmd = localParts(Math.floor(Date.now() / 1000), tz).ymd;
    let y = Number(startYmd.slice(0, 4)); let m = Number(startYmd.slice(5, 7));
    const endY = Number(endYmd.slice(0, 4)); const endM = Number(endYmd.slice(5, 7));
    const multiYear = y !== endY;
    while (y < endY || (y === endY && m <= endM)) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      buckets.push({ key, label: multiYear ? `${String(y).slice(2)}/${m}` : `${m}月`, count: 0, members: new Set() });
      m++; if (m > 12) { m = 1; y++; }
    }
    keyOf = (ymd) => ymd.slice(0, 7);
  } else {
    const r = periodRange(unit, dateYmd);
    rangeStart = r.rangeStart; rangeEnd = r.rangeEnd;
    // タイムゾーンのずれを見込んで前後1日ずつ広めに取り、日付で絞り込む
    fromSec = Math.floor((r.startMs - DAY_MS) / 1000);
    toSec = Math.floor((r.endMs + 2 * DAY_MS) / 1000);
    if (unit === "day") {
      for (let h = 0; h < 24; h++) buckets.push({ key: String(h), label: `${h}`, count: 0, members: new Set() });
    } else {
      for (let ms = r.startMs; ms <= r.endMs; ms += DAY_MS) {
        const d = new Date(ms);
        buckets.push({
          key: utcMsToYmd(ms),
          label: unit === "week" ? `${WEEKDAY_LABELS[d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}` : `${d.getUTCDate()}`,
          count: 0, members: new Set(),
        });
      }
    }
    const lo = r.rangeStart; const hi = r.rangeEnd;
    keyOf = (ymd, hour) => (ymd < lo || ymd > hi ? null : unit === "day" ? String(hour) : ymd);
  }

  const rows = await db.select({ memberId: schema.accessLogs.memberId, at: schema.accessLogs.createdAt })
    .from(schema.accessLogs)
    .where(and(gte(schema.accessLogs.createdAt, fromSec), lt(schema.accessLogs.createdAt, toSec), who))
    .all();

  const byKey = new Map(buckets.map((b) => [b.key, b]));
  const all = new Set<string>();
  let total = 0;
  for (const r of rows) {
    const { ymd, hour } = localParts(r.at, tz);
    const key = keyOf(ymd, hour);
    const b = key === null ? undefined : byKey.get(key);
    if (!b) continue;
    b.count++; b.members.add(r.memberId); all.add(r.memberId); total++;
  }

  return {
    unit, rangeStart, rangeEnd,
    buckets: buckets.map((b) => ({ key: b.key, label: b.label, count: b.count, members: b.members.size })),
    total, uniqueMembers: all.size, trackingStartedAt,
  };
}
