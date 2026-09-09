// =============================================================
// 複数人ミーティングの日程候補をAIで探す機能
//
// 設計方針：日時の重なり判定・空き時間の抽出は必ずコード側で確定的に行い、
// AIには「その確定済みリストの中から、自由記述の希望に合うものを選ばせる」役割だけを
// 与える（AIに生の予定データを渡して計算させない）。これにより、日時の正しさは常に
// コード側で保証しつつ、AIコストは自由記述が指定された場合のみ発生させる。
//
// 空き時間の抽出は、各候補日の「連続して空いている区間（free run）」ごとに
// 所要時間ぴったりで隙間なく敷き詰める方式で行う（重複するスロットは作らない）。
// 例：17:00〜20:00が空きで所要時間60分の場合 → 17:00〜18:00, 18:00〜19:00, 19:00〜20:00。
// =============================================================
import { inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { getValidGoogleAccessToken } from "./conferenceService.ts";
import { listEvents } from "./googleClient.ts";
import { localTimeToUtcMs, utcMsToLocalDateStr, utcMsToLocalDayOfWeek, type Slot } from "./slotCalculator.ts";

const TIMEZONE = "Asia/Tokyo";
const MIN_NOTICE_MINUTES = 120; // 直近すぎる候補（2時間以内）は出さない
const CONCURRENCY = 3; // Googleカレンダー取得の同時実行数（他メンバーへの負荷・実行時間を抑える）
const HARD_MAX_MEMBERS = 20; // scope に関わらない絶対上限（安全弁）
const MAX_CANDIDATES_FOR_AI_PROMPT = 150; // AIへ渡す候補数の安全上限（トークン消費を抑える）

export type SlotSearchEnv = {
  SCHEDULER_TOKEN_KEY: string;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  ANTHROPIC_API_KEY: string;
};

export type SlotSearchParams = {
  db: Db;
  env: SlotSearchEnv;
  hostMemberId: string;
  candidateMemberIds: string[]; // 招待メンバー（ホストは含めなくてよい。内部で必ず対象に加える）
  scope: "all" | "team" | "collab_team" | "selected";
  priorityMemberIds?: string[]; // scope="all" のとき、確認を優先したいメンバー（最大10人）。上限カットで除外されないよう先頭に寄せる
  daysOfWeek: number[]; // 0=日 … 6=土
  timeStartLocal: string; // "09:00"
  timeEndLocal: string;   // "21:00"
  durationMinutes: number;
  searchFromLocal: string; // "2026-09-04"
  searchToLocal: string;   // "2026-09-18"（この日を含む）
  maxMembersToCheck: number; // 1〜20（scope="all" のときのみ実質的に効く）
  maxCandidates: number;     // 1〜15
  freeText?: string;
  isDev: boolean;
};

export type SuggestedSlot = { startUtc: string; endUtc: string; reason?: string };

export type SlotSearchResult = {
  checkedMemberIds: string[];
  connectedMemberIds: string[];
  unconnectedMemberIds: string[];
  excludedForCapMemberIds: string[]; // scope="all" の上限超過で確認対象外にしたメンバー
  checkFailedMemberIds: string[]; // 連携済みだがGoogle側の一時的な不調等でカレンダーを取得できなかったメンバー
  slots: SuggestedSlot[];
  totalCandidatesFound: number; // AI適用前の確定的な候補の総数
  aiUsed: boolean;
  aiCallFailed?: boolean; // AI呼び出しが（リトライしても）失敗し、確定的な候補にフォールバックした場合true
};

function addDaysToLocalDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function localHourOf(utcMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour: "2-digit", hour12: false }).formatToParts(new Date(utcMs));
  return parseInt(parts.find((p) => p.type === "hour")!.value, 10);
}

// 自由記述に含まれる「◯時以降」「◯時より前」「◯時から◯時の間」「翌日に◯時より早い予定がある
// 日の前日は◯時以降を避ける」といった明確な数値の時刻条件を、AIに解釈させずコード側で確定的に
// 検出する。AIは自由記述の解釈にゆらぎがあり、単純な数値条件ですら守られないことがあったため、
// 検出できたものは必ずコード側で確定的にフィルタし、AIには「解釈できなかった残りの希望」だけを委ねる。
//
// windows は「OR」で扱う（例:「午前中か、20時から21時の間」→ 2つのwindowのどちらかを満たせばよい）。
// 単一のmin/maxだけを持たせる設計だと、複数の候補時間帯を「または」で並べた希望を1つに潰してしまい、
// 一方の時間帯（例：20-21時）が丸ごと候補から消えてしまう不具合になっていたため、複数保持できるようにした。
type TimeWindow = { minHour: number | null; maxHour: number | null };
type TimeConstraints = {
  windows: TimeWindow[]; // 空配列＝数値・時間帯表現による指定なし
  nextDayEarlyHour: number | null;   // 「翌日に9時より早い予定がある場合」→ 9
  eveningAvoidHour: number | null;   // 「（その）前日には19時以降の予定を入れない」→ 19
  bufferMinutes: number | null;      // 「前後にそれぞれ30分ずつの空き時間を作れるところ」→ 30
};

// 「否定文脈」判定：一致箇所と同じ節（読点／句点で区切られた範囲）の中だけを見て、
// 「避けたい」「ダメ」等の打ち消し語が無いか確認する（意味が逆転してしまうため）。
// 固定文字数の前後window方式だと、隣接する別の節の否定語を誤って拾ってしまう
// （例:「午前中は避けたい、夜がいい」で「夜」まで否定扱いになる）ため、節単位で区切る。
function isNegatedNearby(freeText: string, matchIndex: number, matchLength: number): boolean {
  const seps = ["、", "。", ","];
  let clauseStart = 0;
  for (const s of seps) {
    const i = freeText.lastIndexOf(s, matchIndex);
    if (i + 1 > clauseStart) clauseStart = i + 1;
  }
  let clauseEnd = freeText.length;
  for (const s of seps) {
    const i = freeText.indexOf(s, matchIndex + matchLength);
    if (i !== -1 && i < clauseEnd) clauseEnd = i;
  }
  const clause = freeText.slice(clauseStart, clauseEnd);
  return /(避け|ダメ|NG|不可|以外|なし|除く|しない|不要|やめ)/.test(clause);
}

function parseTimeConstraints(freeText: string): TimeConstraints {
  const windows: TimeWindow[] = [];

  // 明示的な範囲「20時から21時」「20時〜21時」「20時からら21時の間」
  const rangeRe = /(\d{1,2})\s*時[^\d、。]{0,4}(?:から|〜|~|ー|-)[^\d]{0,4}(\d{1,2})\s*時/g;
  let rangeMatch: RegExpExecArray | null;
  while ((rangeMatch = rangeRe.exec(freeText)) !== null) {
    windows.push({ minHour: parseInt(rangeMatch[1], 10), maxHour: parseInt(rangeMatch[2], 10) });
  }

  // 単独の「◯時以降」
  const minMatch = freeText.match(/(\d{1,2})\s*時\s*(以降|以後|より\s*後)/);
  if (minMatch) windows.push({ minHour: parseInt(minMatch[1], 10), maxHour: null });

  // 単独の「◯時より前」「◯時まで」
  const maxMatch = freeText.match(/(\d{1,2})\s*時\s*(より\s*前|まで|以前)/);
  if (maxMatch) windows.push({ minHour: null, maxHour: parseInt(maxMatch[1], 10) });

  // 「午前中」「午後」「夜」等の一般的な時間帯表現。数値の指定と併記されている場合（例:「午前中か、
  // 20時から21時の間」）もあるため、数値指定の有無に関わらず追加のOR候補として扱う。
  const morningMatch = freeText.match(/午前(中)?/);
  if (morningMatch && !isNegatedNearby(freeText, morningMatch.index ?? 0, morningMatch[0].length)) {
    windows.push({ minHour: null, maxHour: 12 }); // 午前中 = 正午より前
  }
  const afternoonMatch = freeText.match(/午後/);
  if (afternoonMatch && !isNegatedNearby(freeText, afternoonMatch.index ?? 0, afternoonMatch[0].length)) {
    windows.push({ minHour: 12, maxHour: null });
  }
  const nightMatch = freeText.match(/夜|夕方以降/);
  if (nightMatch && !isNegatedNearby(freeText, nightMatch.index ?? 0, nightMatch[0].length)) {
    windows.push({ minHour: 18, maxHour: null });
  }

  const nextDayMatch = freeText.match(/翌[日朝][^。、]{0,20}?(\d{1,2})\s*時/);
  const prevDayMatch = freeText.match(/前[日夜][^。]{0,20}?(\d{1,2})\s*時\s*(以降|以後)/);

  // 「前後にそれぞれ30分ずつの空き時間を作れるところ」のような、他の予定との間隔（バッファ）指定。
  // 「前後」という語の近くにある分数を拾う（「30分前後」等、無関係な"前後"の使い方との誤検出を避けるため、
  // 「空き」「余裕」「バッファ」「あける」等のバッファを意味する語も近くにあることを条件にする）。
  let bufferMinutes: number | null = null;
  const bufferMatch = freeText.match(/前後[^。]{0,15}?(\d{1,3})\s*分/) ?? freeText.match(/(\d{1,3})\s*分[^。]{0,10}?前後/);
  if (bufferMatch) {
    const context = freeText.slice(Math.max(0, (bufferMatch.index ?? 0) - 4), (bufferMatch.index ?? 0) + bufferMatch[0].length + 15);
    if (/(空き|余裕|バッファ|あけ|開け|間隔)/.test(context)) {
      bufferMinutes = parseInt(bufferMatch[1], 10);
    }
  }

  return {
    windows,
    nextDayEarlyHour: nextDayMatch ? parseInt(nextDayMatch[1], 10) : null,
    eveningAvoidHour: prevDayMatch ? parseInt(prevDayMatch[1], 10) : null,
    bufferMinutes,
  };
}

// 候補の翌暦日に、指定時刻より早く始まる予定があるかどうか
function nextCalendarDayHasEarlyEvent(
  candidateEndUtc: string,
  busyPairs: { start: number; end: number }[],
  timezone: string,
  earlyHour: number
): boolean {
  const nextDateStr = addDaysToLocalDateStr(utcMsToLocalDateStr(new Date(candidateEndUtc).getTime(), timezone), 1);
  return busyPairs.some((b) => utcMsToLocalDateStr(b.start, timezone) === nextDateStr && localHourOf(b.start, timezone) < earlyHour);
}

// 自由記述から検出できた数値の時刻条件で、確定的にフィルタする。
// windowsは「いずれか1つを満たせばよい（OR）」として扱う（例:「午前中か、20時から21時の間」）。
function applyTimeConstraints(
  slots: Slot[],
  constraints: TimeConstraints,
  busy: { start: string; end: string }[],
  timezone: string
): Slot[] {
  const { windows, nextDayEarlyHour, eveningAvoidHour, bufferMinutes } = constraints;
  if (windows.length === 0 && (nextDayEarlyHour === null || eveningAvoidHour === null) && bufferMinutes === null) {
    return slots;
  }
  const busyPairs = busy.map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }));
  const bufferMs = bufferMinutes !== null ? bufferMinutes * 60_000 : 0;
  return slots.filter((s) => {
    const startHour = localHourOf(new Date(s.startUtc).getTime(), timezone);
    if (windows.length > 0) {
      const matchesAnyWindow = windows.some((w) => {
        if (w.minHour !== null && startHour < w.minHour) return false;
        if (w.maxHour !== null && startHour >= w.maxHour) return false;
        return true;
      });
      if (!matchesAnyWindow) return false;
    }
    if (
      nextDayEarlyHour !== null && eveningAvoidHour !== null &&
      startHour >= eveningAvoidHour &&
      nextCalendarDayHasEarlyEvent(s.endUtc, busyPairs, timezone, nextDayEarlyHour)
    ) {
      return false;
    }
    if (bufferMinutes !== null) {
      // 候補の前後にbufferMinutes分の間隔がある状態、つまり [開始-buffer, 終了+buffer] の範囲に
      // 他の予定が一切かからないことを確認する（候補自身が生成元とした空き区間の外側もチェックするため、
      // 元の空き時間抽出だけでは検出できない「隣接予定との間隔不足」を確定的に除外できる）。
      const startMs = new Date(s.startUtc).getTime();
      const endMs = new Date(s.endUtc).getTime();
      const effStart = startMs - bufferMs;
      const effEnd = endMs + bufferMs;
      const hasConflict = busyPairs.some((b) => effStart < b.end && effEnd > b.start);
      if (hasConflict) return false;
    }
    return true;
  });
}

// 各候補日の「連続して空いている区間」ごとに、所要時間ぴったりで隙間なく敷き詰める
// （固定の間隔でスキャンして重複するスロットを大量生成することはしない）
function computeNonOverlappingSlots(args: {
  daysOfWeek: number[];
  timeStartLocal: string;
  timeEndLocal: string;
  durationMinutes: number;
  busy: { start: string; end: string }[];
  fromUtc: Date;
  toUtc: Date;
  timezone: string;
  minNoticeMinutes: number;
}): Slot[] {
  const { daysOfWeek, timeStartLocal, timeEndLocal, durationMinutes, busy, fromUtc, toUtc, timezone, minNoticeMinutes } = args;
  const durationMs = durationMinutes * 60_000;
  const nowMs = Date.now();
  const minNoticeMs = minNoticeMinutes * 60_000;
  const busyPairs = busy
    .map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
    .sort((a, b) => a.start - b.start);
  const dowSet = new Set(daysOfWeek);
  const slots: Slot[] = [];

  const startOfDay = new Date(Date.UTC(fromUtc.getUTCFullYear(), fromUtc.getUTCMonth(), fromUtc.getUTCDate()));
  for (let dayMs = startOfDay.getTime(); dayMs < toUtc.getTime(); dayMs += 86400_000) {
    const localDateStr = utcMsToLocalDateStr(dayMs, timezone);
    const localDow = utcMsToLocalDayOfWeek(dayMs, timezone);
    if (!dowSet.has(localDow)) continue;

    const windowStart = localTimeToUtcMs(localDateStr, timeStartLocal, timezone);
    const windowEnd = localTimeToUtcMs(localDateStr, timeEndLocal, timezone);
    if (windowEnd <= windowStart) continue;

    // そのウィンドウ内でbusyと重ならない「連続して空いている区間」を求める
    const dayBusy = busyPairs.filter((b) => b.end > windowStart && b.start < windowEnd);
    let cursor = windowStart;
    const freeRuns: { start: number; end: number }[] = [];
    for (const b of dayBusy) {
      if (b.start > cursor) freeRuns.push({ start: cursor, end: Math.min(b.start, windowEnd) });
      cursor = Math.max(cursor, b.end);
      if (cursor >= windowEnd) break;
    }
    if (cursor < windowEnd) freeRuns.push({ start: cursor, end: windowEnd });

    // 各free runを、所要時間ぴったりで隙間なく敷き詰める（重複なし。端数は切り捨て）
    for (const run of freeRuns) {
      let slotStart = run.start;
      while (slotStart + durationMs <= run.end) {
        const slotEnd = slotStart + durationMs;
        if (slotStart >= fromUtc.getTime() && slotEnd <= toUtc.getTime() && slotStart >= nowMs + minNoticeMs) {
          slots.push({ startUtc: new Date(slotStart).toISOString(), endUtc: new Date(slotEnd).toISOString() });
        }
        slotStart += durationMs;
      }
    }
  }
  return slots;
}

// 候補が多い場合、特定の1日に偏らないよう日付ごとに1件ずつ持ち回りで選ぶ
function diversifyByDay(slots: Slot[], limit: number, timezone: string): Slot[] {
  if (slots.length <= limit) return slots;
  const byDate = new Map<string, Slot[]>();
  for (const s of slots) {
    const key = utcMsToLocalDateStr(new Date(s.startUtc).getTime(), timezone);
    const arr = byDate.get(key) ?? [];
    arr.push(s);
    byDate.set(key, arr);
  }
  const dateKeys = [...byDate.keys()].sort();
  const result: Slot[] = [];
  let round = 0;
  while (result.length < limit) {
    let addedAny = false;
    for (const key of dateKeys) {
      const arr = byDate.get(key)!;
      if (arr[round]) {
        result.push(arr[round]);
        addedAny = true;
        if (result.length >= limit) break;
      }
    }
    if (!addedAny) break;
    round++;
  }
  return result;
}

export async function searchCommonFreeSlots(params: SlotSearchParams): Promise<SlotSearchResult> {
  const {
    db, env, hostMemberId, candidateMemberIds, scope, priorityMemberIds,
    daysOfWeek, timeStartLocal, timeEndLocal, durationMinutes,
    searchFromLocal, searchToLocal, maxMembersToCheck, maxCandidates, freeText, isDev,
  } = params;

  // ホストを必ず対象に含める（ホスト自身が空いていない時間を提案しないため）。
  // scope="all" で優先メンバーが指定されている場合は、上限カットで除外されないよう先頭に寄せる
  // （DBの取得順は特に意図された並びではなく、優先メンバーが後ろに来て弾かれる不具合があったため）。
  const priorityIds = scope === "all" ? (priorityMemberIds ?? []) : [];
  const allTargetIds = [...new Set([hostMemberId, ...priorityIds, ...candidateMemberIds])];

  // scope="all" の場合のみ、指定された上限で確認対象を絞り込む（それ以外は絶対上限のみ適用）
  const cap = scope === "all" ? Math.min(maxMembersToCheck, HARD_MAX_MEMBERS) : HARD_MAX_MEMBERS;
  const idsToCheck = allTargetIds.slice(0, cap);
  const excludedForCapMemberIds = allTargetIds.slice(cap);

  // Google連携済みかどうかを一括判定
  const credRows = idsToCheck.length > 0
    ? await db.select({ memberId: schema.googleCredentials.memberId })
        .from(schema.googleCredentials)
        .where(inArray(schema.googleCredentials.memberId, idsToCheck))
        .all()
    : [];
  const connectedMemberIds = credRows.map((r) => r.memberId);
  const unconnectedMemberIds = idsToCheck.filter((id) => !connectedMemberIds.includes(id));

  const fromUtc = new Date(localTimeToUtcMs(searchFromLocal, "00:00", TIMEZONE));
  const toUtc = new Date(localTimeToUtcMs(addDaysToLocalDateStr(searchToLocal, 1), "00:00", TIMEZONE));

  // 連携済みメンバーの予定を、CONCURRENCY 人ずつのバッチで取得し busy 区間へ変換する。
  // 誰か1人でも埋まっていればその時間帯は候補から除外するため、全員分を1つの busy 配列にまとめる。
  // カレンダーを取得できなかったメンバーは「予定なし」と誤認しないよう、確認対象外として記録するだけに留める
  // （busyに追加しない＝そのメンバーの予定は考慮されない、という限界を summary で呼び出し元に伝える）。
  const busy: { start: string; end: string }[] = [];
  const checkFailedMemberIds: string[] = [];
  for (let i = 0; i < connectedMemberIds.length; i += CONCURRENCY) {
    const batch = connectedMemberIds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (memberId) => {
      const cred = await getValidGoogleAccessToken(db, memberId, env.SCHEDULER_TOKEN_KEY, env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET);
      if (cred.status === "refresh_failed") {
        checkFailedMemberIds.push(memberId);
        return [];
      }
      if (cred.status !== "ok") return [];
      try {
        const eventLists = await Promise.all(
          cred.busyCalendars.map((cal) => listEvents(cred.accessToken, cal.id, fromUtc.toISOString(), toUtc.toISOString()))
        );
        return eventLists.flat()
          // Googleカレンダーの「予定なし」設定（transparency: transparent）は、終日予定・時間指定予定の
          // どちらであっても空き扱いにする（例：終日の「自宅」マーカーなどはbusyとして扱わない）
          .filter((ev) => ev.transparency !== "transparent")
          .map((ev) => ({ start: ev.startUtc, end: ev.endUtc }));
      } catch (e) {
        console.error(`[meetingSlotSearch] カレンダー取得に失敗しました member=${memberId}:`, e);
        checkFailedMemberIds.push(memberId);
        return [];
      }
    }));
    busy.push(...results.flat());
  }

  // 確定的な空き時間抽出（コード側で計算。AIには渡さない）
  const rawDeterministicSlots = computeNonOverlappingSlots({
    daysOfWeek, timeStartLocal, timeEndLocal, durationMinutes, busy,
    fromUtc, toUtc, timezone: TIMEZONE, minNoticeMinutes: MIN_NOTICE_MINUTES,
  });

  // 自由記述から「◯時以降」等の明確な数値の時刻条件を検出できた場合は、AIに解釈させず
  // コード側で確定的にフィルタする（AIが単純な数値条件すら守らないことがあったため）
  const timeConstraints = freeText?.trim() ? parseTimeConstraints(freeText) : null;
  const deterministicSlots = timeConstraints
    ? applyTimeConstraints(rawDeterministicSlots, timeConstraints, busy, TIMEZONE)
    : rawDeterministicSlots;

  const base = {
    checkedMemberIds: idsToCheck, connectedMemberIds, unconnectedMemberIds, excludedForCapMemberIds,
    checkFailedMemberIds,
    totalCandidatesFound: deterministicSlots.length,
  };

  if (deterministicSlots.length === 0) {
    return { ...base, slots: [], aiUsed: false };
  }

  if (!freeText?.trim()) {
    // 自由記述が無い場合はAIを呼ばず、特定の1日に偏らないよう分散させて返す（コスト削減）
    const picked = diversifyByDay(deterministicSlots, maxCandidates, TIMEZONE).map((s) => ({ startUtc: s.startUtc, endUtc: s.endUtc }));
    return { ...base, slots: picked, aiUsed: false };
  }

  const candidatesForAi = diversifyByDay(deterministicSlots, MAX_CANDIDATES_FOR_AI_PROMPT, TIMEZONE);
  const { slots: picked, failed: aiCallFailed } = await rankSlotsWithAiRetrying({
    apiKey: env.ANTHROPIC_API_KEY, isDev, freeText: freeText.trim(),
    candidates: candidatesForAi, maxCandidates, timezone: TIMEZONE, busy,
  });
  if (!aiCallFailed) {
    // AIが正常に判定した結果（0件も含む）。0件は「希望条件に合う候補が無かった」という
    // 正当な結果であり、無関係な候補一覧にすり替えて表示すべきではない。
    return { ...base, slots: picked, aiUsed: !isDev };
  }
  // AI呼び出しがリトライしても失敗した場合のみ、確定的な候補にフォールバックする
  const fallback = diversifyByDay(deterministicSlots, maxCandidates, TIMEZONE).map((s) => ({ startUtc: s.startUtc, endUtc: s.endUtc }));
  return { ...base, slots: fallback, aiUsed: false, aiCallFailed: true };
}

async function callClaude(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      // adaptive thinkingは思考内容もmax_tokensの予算を消費する。4096のような小さい値だと、
      // 複数条件を突き合わせて考える必要があるこのタスクでは思考だけで予算を使い切り、
      // 肝心のJSON出力が途中で打ち切られる（stop_reason: "max_tokens"）ことがあり、
      // その場合JSONとして不完全になりパースに失敗して自由記述が一切反映されない結果になっていた。
      max_tokens: 16000,
      // 「◯時以降」等の時刻条件と、日をまたぐ優先度調整を取り違えずに両立させる必要があり、
      // 単純な選別よりも複数条件の突き合わせが必要なタスクのため、effortはlowではなくmediumにする
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API error ${res.status}: ${body}`);
  }
  const data = await res.json() as { content: Array<{ type: string; text?: string }>; stop_reason?: string };
  if (data.stop_reason === "max_tokens") {
    // 出力が途中で打ち切られている＝JSONが不完全な可能性が高く、誤ってパースに成功して
    // 不正確な結果を返すより、明示的に失敗させて呼び出し元のフォールバックに委ねる
    throw new Error("[meetingSlotSearch] Claude応答がmax_tokensで打ち切られました（出力不完全の可能性）");
  }
  return data.content.filter((c) => c.type === "text" && c.text).map((c) => c.text).join("\n");
}

// 指定時刻以降で、直近の busy 開始時刻を探す（見つからなければ null）
function findNextBusyStart(afterMs: number, busyPairs: { start: number; end: number }[]): number | null {
  let earliest: number | null = null;
  for (const b of busyPairs) {
    if (b.start >= afterMs && (earliest === null || b.start < earliest)) earliest = b.start;
  }
  return earliest;
}

// ok=false は「AI呼び出し・応答形式そのものが失敗した」ことを表し、ok=true & slots=[] は
// 「AIが正常に判定した結果、希望条件に合う候補が無かった」ことを表す。この2つを区別しないと、
// 一時的な失敗が「無関係な候補一覧」にすり替わって表示されてしまう。
type RankResult = { ok: true; slots: SuggestedSlot[] } | { ok: false };

async function rankSlotsWithAi(args: {
  apiKey: string; isDev: boolean; freeText: string; candidates: Slot[]; maxCandidates: number; timezone: string;
  busy: { start: string; end: string }[];
}): Promise<RankResult> {
  const { apiKey, isDev, freeText, candidates, maxCandidates, timezone, busy } = args;

  // 開発環境・APIキー未設定時は先頭からN件をそのまま返す（モック。実際のClaude呼び出しは行わない）
  if (isDev || !apiKey || apiKey === "dev-not-set") {
    return { ok: true, slots: candidates.slice(0, maxCandidates).map((s) => ({
      startUtc: s.startUtc, endUtc: s.endUtc, reason: "（開発環境のためAIによる絞り込みは省略しています）",
    })) };
  }

  const labelFmt = new Intl.DateTimeFormat("ja-JP", {
    timeZone: timezone, month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const endTimeFmt = new Intl.DateTimeFormat("ja-JP", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false });

  // 「前日の夜は避けてほしい（翌朝早い予定がある場合）」のような、日をまたいだ希望を
  // AIが判断できるよう、各候補の直後にある次の予定（＝翌日の予定を含む）までの空き時間を付記する。
  // 48時間より先の予定は「しばらく予定なし」として扱い、無関係に遠い予定で候補を混乱させない。
  const busyPairs = busy.map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }));
  const NEXT_BUSY_HORIZON_MS = 48 * 3600_000;
  const labeled = candidates.map((s, index) => {
    const endMs = new Date(s.endUtc).getTime();
    const nextBusyMs = findNextBusyStart(endMs, busyPairs);
    let gapNote: string;
    if (nextBusyMs === null || nextBusyMs - endMs > NEXT_BUSY_HORIZON_MS) {
      gapNote = "この後48時間以内に他の予定なし";
    } else {
      const gapMinutes = Math.round((nextBusyMs - endMs) / 60_000);
      const gapH = Math.floor(gapMinutes / 60);
      const gapM = gapMinutes % 60;
      const gapStr = gapH > 0 ? `${gapH}時間${gapM > 0 ? gapM + "分" : ""}` : `${gapM}分`;
      gapNote = `次の予定: ${labelFmt.format(new Date(nextBusyMs))}〜（この候補の終了から${gapStr}後）`;
    }
    return {
      index,
      label: `${labelFmt.format(new Date(s.startUtc))}〜${endTimeFmt.format(new Date(s.endUtc))}　※${gapNote}`,
    };
  });

  const prompt = `あなたはミーティングの日程調整アシスタントです。

以下は、参加者全員の予定を確認したうえで機械的に導き出した「全員が空いている候補日時」のリストです（これはすでに正しいと確定済みの情報です。このリストに無い日時を新たに提案しないでください）。
各候補には「※」以降に、その候補の終了直後から次に控えている予定（翌日の朝の予定も含む）までの情報を付記しています。

候補一覧:
${labeled.map((l) => `${l.index}: ${l.label}`).join("\n")}

主催者からの希望条件（自由記述）:
"""
${freeText}
"""

【選び方の手順（必ずこの順番で判断すること）】
1. 希望条件の中に「◯時以降」「◯時より前」のような具体的な時刻の指定がないか確認してください。指定がある場合は必ず守るべき絶対条件です。その時刻条件を満たさない候補は、他の点でどれだけ都合が良く見えても選ばないでください。
2. 次に、「翌朝早い予定がある日の前夜は避けたい／早めにしたい」のように、日をまたいだ希望が書かれている場合は、各候補に付記した「次の予定」情報を使って判断してください。これは1の時刻条件そのものを緩めたり例外にしたりするものではなく、1の条件をすでに満たしている候補どうしの中で優先順位をつけるため、または自由記述の文面上「その場合は時刻条件を優先しなくてよい」と明確に書かれている場合にのみ使ってください。
3. 最終的に選ぼうとしている候補それぞれについて、1の時刻条件を本当に満たしているかを一つずつ指差し確認してから出力してください。

上記の手順に従い、希望条件に最も合う候補を、多くても${maxCandidates}件選んでください。条件を満たす候補が無ければ、無理に選ばず0件で構いません。
出力は次のJSON形式のみとしてください（説明文や前置きは不要です）:
{"selected": [{"index": 0, "reason": "この時間を選んだ理由を一言で"}]}`;

  const text = await callClaude(apiKey, prompt);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("[meetingSlotSearch] Claude応答からJSONを抽出できませんでした。応答冒頭:", text.slice(0, 300));
    return { ok: false };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { selected?: unknown };
    if (!Array.isArray(parsed.selected)) return { ok: false };
    const results: SuggestedSlot[] = [];
    for (const item of parsed.selected) {
      const x = item as Record<string, unknown>;
      const idx = typeof x?.index === "number" ? x.index : -1;
      // AIが返したindexは、必ずこちら側で用意した候補リストの範囲内かどうかを検証する
      // （AIの応答をそのまま日時として信用しない。範囲外・不正な値は無視する）
      if (!Number.isInteger(idx) || idx < 0 || idx >= candidates.length) continue;
      const reason = typeof x?.reason === "string" ? x.reason.slice(0, 200) : undefined;
      results.push({ startUtc: candidates[idx].startUtc, endUtc: candidates[idx].endUtc, reason });
      if (results.length >= maxCandidates) break;
    }
    return { ok: true, slots: results };
  } catch (err) {
    console.error("[meetingSlotSearch] Claude応答のJSONパースに失敗しました。応答冒頭:", text.slice(0, 300), err);
    return { ok: false };
  }
}

// rankSlotsWithAi を、失敗時は1回だけ自動リトライしてから返す（時間をおくと成功することが
// あったため、ユーザーに手動再実行を求めずサーバー側で吸収する）。
async function rankSlotsWithAiRetrying(args: Parameters<typeof rankSlotsWithAi>[0]): Promise<{ slots: SuggestedSlot[]; failed: boolean }> {
  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await rankSlotsWithAi(args);
      if (result.ok) return { slots: result.slots, failed: false };
      console.error(`[meetingSlotSearch] AIによる絞り込みの解析に失敗（試行${attempt}/${MAX_ATTEMPTS}）`);
    } catch (e) {
      console.error(`[meetingSlotSearch] AIによる絞り込み呼び出し失敗（試行${attempt}/${MAX_ATTEMPTS}）`, e);
    }
  }
  return { slots: [], failed: true };
}
