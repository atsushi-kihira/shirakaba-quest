// =============================================================
// 所在地（都道府県）の自動入力 — メンバー・外部人脈
// 会社名・屋号（メンバーは名刺の住所があれば、まずそちら）から都道府県を調べて入れる。
// 調べ方は、会社概要の自動生成（company-summary.ts）と同じく Claude API の Web検索ツール。
// 手で入力された値（status='manual'）は、自動では上書きしない。
// =============================================================
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { findPrefecture } from "@shared/prefectures";
import { schema, type Db } from "../db/index.ts";
import type { Env } from "../types.ts";

export type PrefectureLookup =
  | { status: "done"; prefecture: string }
  | { status: "not_found" | "error"; prefecture: null };

/** 'processing' のまま、これだけ経っても終わらない行は、もう一度調べる */
const STALE_PROCESSING_SECONDS = 90;
/** 1回の呼び出しで調べる件数（waitUntilの実行時間制限に収めるため）。残りがあれば自己連鎖で続ける */
const SWEEP_ROUND_SIZE = 6;
const SWEEP_MAX_HOPS = 80;
const CONCURRENCY = 3;

const PROMPT = `あなたはビジネスネットワーキング団体のアシスタントです。
Web検索を使って、指定された会社・屋号の「本社（主たる事務所）の所在地」の都道府県を調べてください。

ルール:
- 会社名は日本の中小企業・個人事業主・士業事務所・団体であることが多い。同名の別会社と取り違えないよう、業種や名称の細部も手がかりにすること
- 全国に支店がある大企業は、本社の所在地の都道府県にすること
- 日本国内に拠点がなく、海外にしかない場合だけ「海外」とすること（外資系の日本法人は、日本の事務所の所在地）
- 信頼できる情報が見つからない場合は、無理に推測せず "not_found" と判定すること
- 出力は最後に必ず以下のJSON形式のみを1個、コードブロックなしで出力すること（それより前に検索結果の説明文があってもよい）

{"status": "done" または "not_found", "prefecture": "東京都" のような都道府県名（47都道府県のいずれか、または「海外」。見つからない場合は null）}`;

// 会社名・屋号が空の人向け。名前と職種から、その人自身の事務所・店舗の所在地を探す
const PERSON_PROMPT = `あなたはビジネスネットワーキング団体のアシスタントです。
会社名・屋号の登録がない人について、Web検索で、その人本人の事務所・店舗・主な活動拠点の都道府県を調べてください。

ルール:
- 名前と職種・事業内容の両方が一致する人だけを採用する。同姓同名の別人かもしれない場合は、無理に決めず "not_found" と判定すること
- 事務所や店舗の所在地が確認できる場合だけ採用する（自宅の住所や、勤務先が別の会社の場合は採用しない）
- 出力は最後に必ず以下のJSON形式のみを1個、コードブロックなしで出力すること（それより前に検索結果の説明文があってもよい）

{"status": "done" または "not_found", "prefecture": "東京都" のような都道府県名（47都道府県のいずれか、または「海外」。見つからない場合は null）}`;

async function askClaude(apiKey: string, prompt: string, subject: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      // 思考とWeb検索の要約でトークンを使い切ると、最後のJSONが出ずに「分からない」扱いになるため、余裕を持たせる
      max_tokens: 4096,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: `${prompt}\n\n${subject}` }],
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { content: Array<{ type: string; text?: string }> };
  return data.content.filter((c) => c.type === "text" && c.text).map((c) => c.text).join("\n");
}

function parseLookup(content: string): PrefectureLookup {
  const m = content.match(/\{[^{}]*"status"[^{}]*\}/);
  if (!m) return { status: "error", prefecture: null };
  try {
    const parsed = JSON.parse(m[0]) as { status?: string; prefecture?: string | null };
    const prefecture = parsed.status === "done" ? findPrefecture(parsed.prefecture) : null;
    return prefecture ? { status: "done", prefecture } : { status: "not_found", prefecture: null };
  } catch {
    return { status: "error", prefecture: null };
  }
}

/** 会社名・屋号から、本社の所在地の都道府県を調べる */
export async function lookupPrefecture(opts: { company: string; person?: string; apiKey: string; isDev: boolean }): Promise<PrefectureLookup> {
  const { company, person, apiKey, isDev } = opts;
  if (isDev || !apiKey || apiKey === "dev-not-set") {
    await new Promise((r) => setTimeout(r, 300));
    return { status: "done", prefecture: "東京都" }; // 開発用の固定値
  }
  try {
    const subject = person
      ? `# 調べる人\n${person}`
      : `# 調べる会社・屋号名\n${company}`;
    return parseLookup(await askClaude(apiKey, person ? PERSON_PROMPT : PROMPT, subject));
  } catch (err) {
    console.error("[prefecture] 所在地の検索に失敗", err);
    return { status: "error", prefecture: null };
  }
}

/** name: 本人の名前、work: 職種・事業内容（会社名が空のとき、本人を探す手がかりにする） */
type Target = { table: "members" | "contacts"; id: string; company: string | null; address: string | null; name: string; work: string | null };

async function resolveTarget(env: Env, t: Target): Promise<PrefectureLookup> {
  // 名刺に住所があれば、調べるより確実
  const fromAddress = findPrefecture(t.address);
  if (fromAddress) return { status: "done", prefecture: fromAddress };
  const company = t.company?.trim();
  const apiKey = env.ANTHROPIC_API_KEY;
  const isDev = env.ENVIRONMENT === "development";
  if (company) return lookupPrefecture({ company, apiKey, isDev });
  // 会社名・屋号が空でも、職種が分かれば、名前と職種から本人の事務所を探す（職種もなければ手がかりがない）
  const work = t.work?.trim();
  if (!work) return { status: "not_found", prefecture: null };
  return lookupPrefecture({ company: "", person: `名前: ${t.name}\n職種・事業内容: ${work}`, apiKey, isDev });
}

async function saveResult(db: Db, t: Target, r: PrefectureLookup): Promise<void> {
  const patch = { prefecture: r.prefecture, prefectureStatus: r.status, prefectureClaimedAt: null };
  // 調べている間に手で入力された場合（status が変わっている）は、上書きしない
  if (t.table === "members") {
    await db.update(schema.members).set(patch)
      .where(and(eq(schema.members.id, t.id), eq(schema.members.prefectureStatus, "processing"))).run();
  } else {
    await db.update(schema.externalContacts).set(patch)
      .where(and(eq(schema.externalContacts.id, t.id), eq(schema.externalContacts.prefectureStatus, "processing"))).run();
  }
}

/** 調べ待ち（pending）と、調べている最中のまま止まっている（processing）行を、1回分だけ調べる。調べた件数を返す */
async function sweepOnce(db: Db, env: Env): Promise<{ processed: number; more: boolean }> {
  const now = Math.floor(Date.now() / 1000);
  const staleBefore = now - STALE_PROCESSING_SECONDS;
  const targets: Target[] = [];

  const mPending = or(
    eq(schema.members.prefectureStatus, "pending"),
    and(eq(schema.members.prefectureStatus, "processing"),
      or(isNull(schema.members.prefectureClaimedAt), lt(schema.members.prefectureClaimedAt, staleBefore))),
  );
  const mRows = await db.select({ id: schema.members.id }).from(schema.members).where(mPending).limit(SWEEP_ROUND_SIZE).all();
  if (mRows.length > 0) {
    const claimed = await db.update(schema.members).set({ prefectureStatus: "processing", prefectureClaimedAt: now })
      .where(and(inArray(schema.members.id, mRows.map((r) => r.id)), mPending))
      .returning({ id: schema.members.id, company: schema.members.company, address: schema.members.address,
        name: schema.members.name, category: schema.members.category }).all();
    for (const r of claimed) targets.push({ table: "members", id: r.id, company: r.company, address: r.address, name: r.name, work: r.category });
  }

  const room = SWEEP_ROUND_SIZE - mRows.length;
  let cMore = false;
  if (room > 0) {
    const cPending = or(
      eq(schema.externalContacts.prefectureStatus, "pending"),
      and(eq(schema.externalContacts.prefectureStatus, "processing"),
        or(isNull(schema.externalContacts.prefectureClaimedAt), lt(schema.externalContacts.prefectureClaimedAt, staleBefore))),
    );
    const cRows = await db.select({ id: schema.externalContacts.id }).from(schema.externalContacts).where(cPending).limit(room).all();
    cMore = cRows.length >= room;
    if (cRows.length > 0) {
      const claimed = await db.update(schema.externalContacts).set({ prefectureStatus: "processing", prefectureClaimedAt: now })
        .where(and(inArray(schema.externalContacts.id, cRows.map((r) => r.id)), cPending))
        .returning({ id: schema.externalContacts.id, company: schema.externalContacts.company,
          name: schema.externalContacts.name, specialty: schema.externalContacts.specialty }).all();
      for (const r of claimed) targets.push({ table: "contacts", id: r.id, company: r.company, address: null, name: r.name, work: r.specialty });
    }
  }

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    await Promise.all(targets.slice(i, i + CONCURRENCY).map(async (t) => {
      try {
        await saveResult(db, t, await resolveTarget(env, t));
      } catch (err) {
        console.error("[prefecture] 所在地の保存に失敗", t.table, t.id, err);
        await saveResult(db, t, { status: "error", prefecture: null }).catch(() => {});
      }
    }));
  }
  return { processed: targets.length, more: mRows.length >= SWEEP_ROUND_SIZE || cMore };
}

/**
 * システム全体の「調べ待ち」の所在地を、まとめて調べる。1回のWorker呼び出しでは、waitUntilの実行時間制限
 * （応答後およそ30秒）内に収まる件数しか調べられないため、まだ残っていれば自分自身を新しいリクエストとして
 * 呼び出して続ける（会社概要の自動生成と同じ、自己連鎖方式）。
 * 登録・更新の直後に waitUntil で呼ぶ。
 */
export async function sweepPendingPrefectures(db: Db, env: Env, origin: string | null, hop: number): Promise<void> {
  const { more } = await sweepOnce(db, env);
  // origin が null のときは、連鎖せずに1回分だけ調べる（登録直後の1人分など）
  if (more && origin && hop < SWEEP_MAX_HOPS) {
    await fetch(`${origin}/api/internal/sweep-pending-prefectures`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-task-secret": env.INTERNAL_TASK_SECRET },
      body: JSON.stringify({ hop: hop + 1 }),
    }).catch((err) => console.error("[prefecture] sweepの自己連鎖呼び出しに失敗", err));
  }
}

/**
 * プロフィール・人脈の入力値から、所在地の更新内容を決める。
 *  ・所在地を手で入力した → その値を保存（status='manual'）
 *  ・所在地を空にした   → 自動入力に戻す（status='pending'）
 *  ・会社名・住所を変えた（所在地は触っていない）→ 手入力でなければ、調べ直す
 * 何も変えないときは null を返す。
 */
export function prefecturePatch(
  input: { prefecture?: string | null; company?: string | null; address?: string | null },
  current: { company: string | null; address?: string | null; prefectureStatus: string } | null,
): { prefecture?: string | null; prefectureStatus: string; prefectureClaimedAt: null } | null {
  if (input.prefecture !== undefined) {
    const value = findPrefecture(input.prefecture);
    if (value) return { prefecture: value, prefectureStatus: "manual", prefectureClaimedAt: null };
    return { prefecture: null, prefectureStatus: "pending", prefectureClaimedAt: null };
  }
  if (!current || current.prefectureStatus === "manual") return null;
  const companyChanged = input.company !== undefined && (input.company ?? "").trim() !== (current.company ?? "").trim();
  const addressChanged = input.address !== undefined && (input.address ?? "").trim() !== (current.address ?? "").trim();
  if (companyChanged || addressChanged) return { prefecture: null, prefectureStatus: "pending", prefectureClaimedAt: null };
  return null;
}
