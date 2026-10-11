// =============================================================
// メンバーが連携しているすべてのGoogleアカウント（複数可）の、予定の確認対象カレンダー
// 自分のカレンダー表示・空き状況の判定（二重予約の防止）・空き時間のAI検索は、
// デフォルトのアカウントだけでなく、連携したすべてのアカウントの「空き状況の確認対象」に設定した
// カレンダーを対象にする。
// =============================================================
import { eq, desc } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { getValidGoogleAccessTokenForAccount, type BusyCalendar } from "./conferenceService.ts";
import { listEvents, type CalendarEventItem } from "./googleClient.ts";
import type { Env } from "../types.ts";

export type BusySource = {
  accountId: string;
  accountEmail: string;
  isDefault: boolean;
  accessToken: string;
  calendars: BusyCalendar[];
};

export type BusySourcesResult = {
  /** 連携しているアカウントが1つもない */
  notConnected: boolean;
  sources: BusySource[];
  /** 連携済みだが、Google側の一時的な不調などでトークンを取得できなかったアカウントの数 */
  failedAccounts: number;
};

/** 連携しているすべてのアカウントの、アクセストークンと確認対象カレンダーを取得する（デフォルトのアカウントが先頭） */
export async function getBusySources(
  db: Db,
  env: Pick<Env, "SCHEDULER_TOKEN_KEY" | "GOOGLE_OAUTH_CLIENT_ID" | "GOOGLE_OAUTH_CLIENT_SECRET">,
  memberId: string
): Promise<BusySourcesResult> {
  const accounts = await db
    .select({
      id: schema.googleCalendarAccounts.id,
      email: schema.googleCalendarAccounts.googleAccountEmail,
      isDefault: schema.googleCalendarAccounts.isDefault,
    })
    .from(schema.googleCalendarAccounts)
    .where(eq(schema.googleCalendarAccounts.memberId, memberId))
    .orderBy(desc(schema.googleCalendarAccounts.isDefault))
    .all();
  if (accounts.length === 0) return { notConnected: true, sources: [], failedAccounts: 0 };

  const sources: BusySource[] = [];
  let failedAccounts = 0;
  const results = await Promise.all(accounts.map(async (a) => ({
    a,
    cred: await getValidGoogleAccessTokenForAccount(db, a.id, memberId, env.SCHEDULER_TOKEN_KEY, env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET),
  })));
  for (const { a, cred } of results) {
    if (cred.status === "ok") {
      sources.push({ accountId: a.id, accountEmail: a.email, isDefault: a.isDefault === 1, accessToken: cred.accessToken, calendars: cred.busyCalendars });
    } else if (cred.status === "refresh_failed") {
      failedAccounts++;
    } // not_connected（連携が失効して削除された）アカウントは対象外
  }
  return { notConnected: sources.length === 0 && failedAccounts === 0, sources, failedAccounts };
}

export type EventWithAccount = CalendarEventItem & { accountId: string; accountEmail: string };

/**
 * すべてのアカウントの確認対象カレンダーの予定を取得してまとめる。
 * 同じ予定が複数のアカウントに入っている（共有カレンダー・同じ会議への招待など）場合は、1つにまとめる。
 * 取得に失敗したカレンダーがあれば例外を投げる（呼び出し側で「確認できない」として扱い、空き扱いにしない）。
 */
export async function listEventsAcrossAccounts(sources: BusySource[], timeMinUtc: string, timeMaxUtc: string): Promise<EventWithAccount[]> {
  const lists = await Promise.all(
    sources.flatMap((src) =>
      src.calendars.map(async (cal) =>
        (await listEvents(src.accessToken, cal.id, timeMinUtc, timeMaxUtc)).map((ev) => ({ ...ev, accountId: src.accountId, accountEmail: src.accountEmail }))
      )
    )
  );
  const seen = new Set<string>();
  const merged: EventWithAccount[] = [];
  for (const ev of lists.flat()) {
    const key = `${ev.summary}|${ev.startUtc}|${ev.endUtc}|${ev.allDay ? 1 : 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(ev);
  }
  return merged.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
}
