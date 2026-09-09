// =============================================================
// 「今週のクエスト」週次選出サービス
// 週は組織タイムゾーンの月曜0時〜日曜24時
// =============================================================
import { eq, and } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { newId } from "./auth.ts";

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** 指定タイムゾーンでの Y-M-D-H-M-S が表す瞬間の UTC ミリ秒 */
function zonedTimeToUtcMs(y: number, m: number, d: number, hh: number, mm: number, ss: number, tz: string): number {
  const utcGuess = Date.UTC(y, m - 1, d, hh, mm, ss);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcGuess));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  const offset = asUtc - utcGuess;
  return utcGuess - offset;
}

/** 指定タイムゾーンにおける「今週の月曜0時」を Unix秒で返す */
export function getWeekStart(tz: string, nowMs: number = Date.now()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(new Date(nowMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const wd = WEEKDAY_INDEX[get("weekday")] ?? 1;
  const daysSinceMonday = (wd + 6) % 7; // Mon=0 ... Sun=6

  const localMidnightUtcMs = zonedTimeToUtcMs(year, month, day, 0, 0, 0, tz);
  const mondayUtcMs = localMidnightUtcMs - daysSinceMonday * 86_400_000;
  return Math.floor(mondayUtcMs / 1000);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const WEEKLY_QUEST_COUNT = 5;

/**
 * 今週のクエスト選出を取得する。まだ選出されていなければ、未クリアのクエストから
 * ランダムで最大5件選び、その結果を保存してから返す（初回起動時に一度だけ選ばれる）。
 */
export async function ensureWeeklySelection(
  db: ReturnType<typeof createDb>,
  memberId: string,
  weekStart: number
): Promise<Set<string>> {
  const existing = await db
    .select({ questId: schema.questWeeklySelections.questId })
    .from(schema.questWeeklySelections)
    .where(
      and(
        eq(schema.questWeeklySelections.memberId, memberId),
        eq(schema.questWeeklySelections.weekStart, weekStart)
      )
    )
    .all();

  if (existing.length > 0) {
    return new Set(existing.map((r) => r.questId));
  }

  const publishedQuests = await db
    .select({ id: schema.quests.id })
    .from(schema.quests)
    .where(eq(schema.quests.status, "published"))
    .all();

  const correctAttempts = await db
    .select({ questId: schema.questAttempts.questId })
    .from(schema.questAttempts)
    .where(and(eq(schema.questAttempts.memberId, memberId), eq(schema.questAttempts.isCorrect, 1)))
    .all();
  const solvedSet = new Set(correctAttempts.map((a) => a.questId));

  const uncleared = publishedQuests.filter((q) => !solvedSet.has(q.id));
  const picked = shuffle(uncleared).slice(0, WEEKLY_QUEST_COUNT);

  const now = Math.floor(Date.now() / 1000);
  for (const q of picked) {
    try {
      await db.insert(schema.questWeeklySelections).values({
        id: newId(),
        memberId,
        weekStart,
        questId: q.id,
        createdAt: now,
      });
    } catch {
      // 同時リクエストで既に挿入済みの場合は無視
    }
  }

  return new Set(picked.map((q) => q.id));
}

/** 組織のタイムゾーン設定を取得する（未設定時は Asia/Tokyo） */
export async function getSystemTimezone(db: ReturnType<typeof createDb>): Promise<string> {
  const design = await db.select({ timezone: schema.cardDesigns.timezone }).from(schema.cardDesigns).get();
  return design?.timezone ?? "Asia/Tokyo";
}
