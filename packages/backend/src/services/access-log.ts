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

export type AccessUnit = "day" | "week" | "month";
export type AccessBucket = { key: string; label: string; count: number; members: number };
export type AccessSummary = {
  unit: AccessUnit;
  /** 表示している期間の最初の日・最後の日（YYYY-MM-DD、指定のタイムゾーンでの日付） */
  rangeStart: string;
  rangeEnd: string;
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

/** 指定した日を含む期間（日・週・月）のアクセス数を、指定のタイムゾーンで集計する */
export async function summarizeAccess(db: Db, unit: AccessUnit, dateYmd: string, tzInput: string): Promise<AccessSummary> {
  const tz = isValidTimeZone(tzInput) ? tzInput : "Asia/Tokyo";
  const { startMs, endMs, rangeStart, rangeEnd } = periodRange(unit, dateYmd);

  // タイムゾーンのずれを見込んで前後1日ずつ広めに取り、日付で絞り込む
  const fromSec = Math.floor((startMs - DAY_MS) / 1000);
  const toSec = Math.floor((endMs + 2 * DAY_MS) / 1000);
  const rows = await db.select({ memberId: schema.accessLogs.memberId, at: schema.accessLogs.createdAt })
    .from(schema.accessLogs)
    .where(and(gte(schema.accessLogs.createdAt, fromSec), lt(schema.accessLogs.createdAt, toSec)))
    .all();

  // バケット（棒）の用意
  const buckets: { key: string; label: string; count: number; members: Set<string> }[] = [];
  if (unit === "day") {
    for (let h = 0; h < 24; h++) buckets.push({ key: String(h), label: `${h}`, count: 0, members: new Set() });
  } else {
    for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
      const ymd = utcMsToYmd(ms);
      const d = new Date(ms);
      buckets.push({
        key: ymd,
        label: unit === "week" ? `${WEEKDAY_LABELS[d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}` : `${d.getUTCDate()}`,
        count: 0, members: new Set(),
      });
    }
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  const all = new Set<string>();
  let total = 0;
  for (const r of rows) {
    const { ymd, hour } = localParts(r.at, tz);
    if (ymd < rangeStart || ymd > rangeEnd) continue;
    const b = byKey.get(unit === "day" ? String(hour) : ymd);
    if (!b) continue;
    b.count++; b.members.add(r.memberId); all.add(r.memberId); total++;
  }

  const first = await db.select({ at: schema.accessLogs.createdAt }).from(schema.accessLogs)
    .orderBy(schema.accessLogs.createdAt).limit(1).get();

  return {
    unit, rangeStart, rangeEnd,
    buckets: buckets.map((b) => ({ key: b.key, label: b.label, count: b.count, members: b.members.size })),
    total, uniqueMembers: all.size, trackingStartedAt: first?.at ?? null,
  };
}
