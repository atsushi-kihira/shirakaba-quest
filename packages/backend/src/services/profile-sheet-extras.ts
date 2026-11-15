// =============================================================
// 「もらった資料のメモ」の追加機能
//   1) 会社のホームページと事業内容の自動取得（会社・屋号から、AIがWeb検索で調べる）
//   2) 紹介できそうな人（なかま→自分の外部人脈／外部人脈→メンバー）の保存・重点のチェック
//      AIでのさがし方は、貢献のご縁（貢献のリファーラルさがし）の仕組みをそのまま使う
//   どれも、登録した本人（ownerMemberId）だけが見られる
// =============================================================
import { and, desc, eq, inArray } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { newId } from "./auth.ts";
import { normalizeUrl } from "./profile-sheet.ts";
import type { ProfileSheetLink, ProfileSheetLinksResponse, ProfileSheetSubjectType } from "@shared/types";

type Db = ReturnType<typeof createDb>;

const nowSec = () => Math.floor(Date.now() / 1000);

// -------------------------------------------------------
// 1) 会社情報の自動取得
// -------------------------------------------------------
const COMPANY_PROMPT = `あなたはビジネスネットワーキング団体のアシスタントです。
Web検索を使って、次の会社・屋号の「公式ホームページ」と「事業内容」を調べてください。

ルール:
- 会社名は、日本の中小企業・個人事業主であることが多い点に注意して検索すること
- url は、その会社・屋号の公式ホームページ（トップページ）のURL。SNS・求人サイト・企業情報のまとめサイト・比較サイトのURLは使わない。公式サイトと確信できなければ null
- description は、事業内容を、やさしい日本語で1〜3文（150文字以内）。何をしている会社か、誰のどんな役に立つかを書く。住所・電話番号・個人の実名・社員の情報は書かない
- 同名の別の会社が見つかるなど、確信が持てないときは、無理に推測せず "not_found" にする
- 出力は最後に、次のJSONだけを1個、コードブロックなしで出力する（それより前に検索の説明文があってもよい）

{"status":"done" または "not_found","url":"https://… または null","description":"…（見つからなければ null）"}`;

export type CompanyLookupResult = { status: "done" | "not_found" | "error"; url: string; description: string };

/** 会社名から、ホームページと事業内容を調べる（時間がかかりすぎるときは error） */
export async function lookupCompany(apiKey: string | undefined, isDev: boolean, company: string): Promise<CompanyLookupResult> {
  if (isDev || !apiKey || apiKey === "dev-not-set") {
    // 開発環境：AIを呼ばず、見本を返す（[見つからない] を含む会社名は、見つからない場合の確認用）
    if (company.includes("[見つからない]")) return { status: "not_found", url: "", description: "" };
    if (company.includes("[失敗]")) return { status: "error", url: "", description: "" };
    return { status: "done", url: "https://example.com/", description: `（見本）${company}の事業内容が、ここに自動で入ります。` };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 26_000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 3000,
        output_config: { effort: "low" },
        messages: [{ role: "user", content: `${COMPANY_PROMPT}\n\n# 調べる会社・屋号\n${company}` }],
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
      }),
    });
    if (!res.ok) {
      console.error("[company-lookup] Claude API error", res.status, (await res.text()).slice(0, 200));
      return { status: "error", url: "", description: "" };
    }
    const data = await res.json() as { content: Array<{ type: string; text?: string }> };
    const text = data.content.filter((c) => c.type === "text" && c.text).map((c) => c.text).join("\n");
    const m = text.match(/\{[^{}]*"status"[^{}]*\}/);
    if (!m) return { status: "error", url: "", description: "" };
    const parsed = JSON.parse(m[0]) as { status?: string; url?: unknown; description?: unknown };
    if (parsed.status !== "done") return { status: "not_found", url: "", description: "" };
    const url = normalizeUrl(parsed.url);
    const description = typeof parsed.description === "string" ? parsed.description.trim().slice(0, 1000) : "";
    if (!url && !description) return { status: "not_found", url: "", description: "" };
    return { status: "done", url, description };
  } catch (e) {
    console.error("[company-lookup] 失敗", e instanceof Error ? e.message : e);
    return { status: "error", url: "", description: "" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 調べて、シートに書き込む。裏で動かす（waitUntil）。
 * 調べているあいだに会社名が変わっていたら、結果は捨てる。ホームページ・事業内容は、空のところにだけ書く（手で入れたものは残す）
 */
export async function runCompanyLookup(
  db: Db, apiKey: string | undefined, isDev: boolean, ownerId: string, type: ProfileSheetSubjectType, subjectId: string, company: string,
): Promise<void> {
  const result = await lookupCompany(apiKey, isDev, company).catch(() => ({ status: "error" as const, url: "", description: "" }));
  const where = and(
    eq(schema.profileSheets.ownerMemberId, ownerId), eq(schema.profileSheets.subjectType, type), eq(schema.profileSheets.subjectId, subjectId),
  );
  const row = await db.select().from(schema.profileSheets).where(where).get();
  if (!row || row.companyLookupFor !== company) return;
  await db.update(schema.profileSheets).set({
    companyLookupStatus: result.status, companyLookupAt: nowSec(),
    ...(result.status === "done" ? {
      companyUrl: row.companyUrl || result.url,
      companyDescription: row.companyDescription || result.description,
    } : {}),
  }).where(where);
}

/** 「もう一度取得する」：いまの会社名で調べ直す。ホームページ・事業内容は、いまの内容を消してから調べる。会社名がなければ false */
export async function restartCompanyLookup(db: Db, ownerId: string, type: ProfileSheetSubjectType, subjectId: string): Promise<string | null> {
  const where = and(
    eq(schema.profileSheets.ownerMemberId, ownerId), eq(schema.profileSheets.subjectType, type), eq(schema.profileSheets.subjectId, subjectId),
  );
  const row = await db.select().from(schema.profileSheets).where(where).get();
  if (!row || !row.company.trim()) return null;
  await db.update(schema.profileSheets).set({
    companyUrl: "", companyDescription: "", companyLookupStatus: "pending", companyLookupFor: row.company, companyLookupAt: nowSec(),
  }).where(where);
  return row.company;
}

// -------------------------------------------------------
// 2) 紹介できそうな人
// -------------------------------------------------------
export const MAX_LINKS_PER_SUBJECT = 30;
/** 「さがしています」が、この秒数を過ぎても終わらないときは、止まったものとして扱う */
export const RUN_STALE_SECONDS = 15 * 60;

/** 相手の種類から、紹介の相手の種類を決める（なかま→自分の外部人脈、外部人脈→メンバー） */
export function linkKindFor(subjectType: ProfileSheetSubjectType): "contact" | "member" {
  return subjectType === "member" ? "contact" : "member";
}

/** 紹介の相手として登録できるか（外部人脈＝自分の人脈、メンバー＝自分以外の在籍メンバー） */
export async function checkLinkTarget(db: Db, ownerId: string, kind: "contact" | "member", targetId: string): Promise<boolean> {
  if (kind === "contact") {
    const c = await db.select({ owner: schema.externalContacts.ownerMemberId }).from(schema.externalContacts).where(eq(schema.externalContacts.id, targetId)).get();
    return !!c && c.owner === ownerId;
  }
  if (targetId === ownerId) return false;
  const m = await db.select({ status: schema.members.status }).from(schema.members).where(eq(schema.members.id, targetId)).get();
  return !!m && m.status === "active";
}

export async function listSheetLinks(db: Db, ownerId: string, type: ProfileSheetSubjectType, subjectId: string): Promise<ProfileSheetLinksResponse> {
  const rows = await db.select().from(schema.profileSheetLinks).where(and(
    eq(schema.profileSheetLinks.ownerMemberId, ownerId), eq(schema.profileSheetLinks.subjectType, type), eq(schema.profileSheetLinks.subjectId, subjectId),
  )).orderBy(desc(schema.profileSheetLinks.starred), desc(schema.profileSheetLinks.updatedAt)).all();

  const contactIds = rows.filter((r) => r.kind === "contact").map((r) => r.targetId);
  const memberIds = rows.filter((r) => r.kind === "member").map((r) => r.targetId);
  const contacts = contactIds.length > 0
    ? await db.select().from(schema.externalContacts).where(and(inArray(schema.externalContacts.id, contactIds), eq(schema.externalContacts.ownerMemberId, ownerId))).all()
    : [];
  const members = memberIds.length > 0
    ? await db.select({ id: schema.members.id, name: schema.members.name, emoji: schema.members.emoji, bgColor: schema.members.bgColor, company: schema.members.company, category: schema.members.category, status: schema.members.status })
      .from(schema.members).where(inArray(schema.members.id, memberIds)).all()
    : [];
  const contactMap = new Map(contacts.map((c) => [c.id, c]));
  const memberMap = new Map(members.map((m) => [m.id, m]));

  const links: ProfileSheetLink[] = [];
  for (const r of rows) {
    const kind = r.kind === "member" ? "member" : "contact";
    if (kind === "contact") {
      const c = contactMap.get(r.targetId);
      if (!c) continue; // 削除された人脈は出さない
      links.push({
        id: r.id, kind, targetId: r.targetId, name: c.name, emoji: null, bgColor: null,
        subtitle: [c.company, c.specialty].filter(Boolean).join(" ・ "),
        reason: r.reason, starred: r.starred === 1, source: r.source === "manual" ? "manual" : "ai",
      });
    } else {
      const m = memberMap.get(r.targetId);
      if (!m || m.status !== "active") continue;
      links.push({
        id: r.id, kind, targetId: r.targetId, name: m.name, emoji: m.emoji, bgColor: m.bgColor,
        subtitle: [m.category].filter(Boolean).join(" ・ "),
        reason: r.reason, starred: r.starred === 1, source: r.source === "manual" ? "manual" : "ai",
      });
    }
  }

  const run = await db.select().from(schema.profileSheetMatchRuns).where(and(
    eq(schema.profileSheetMatchRuns.ownerMemberId, ownerId), eq(schema.profileSheetMatchRuns.subjectType, type), eq(schema.profileSheetMatchRuns.subjectId, subjectId),
  )).get();
  let runView: ProfileSheetLinksResponse["run"] = null;
  if (run) {
    const stale = run.status === "running" && run.updatedAt < nowSec() - RUN_STALE_SECONDS;
    runView = {
      status: stale ? "error" : (run.status === "running" || run.status === "done" ? run.status : "error"),
      message: stale ? "さがすのに時間がかかり、途中で止まりました。もう一度、さがしてみてください。" : run.message,
      updatedAt: run.updatedAt,
    };
  }
  return { links, run: runView };
}

export async function addManualLink(db: Db, ownerId: string, type: ProfileSheetSubjectType, subjectId: string, targetId: string): Promise<"added" | "exists" | "full"> {
  const kind = linkKindFor(type);
  const where = and(
    eq(schema.profileSheetLinks.ownerMemberId, ownerId), eq(schema.profileSheetLinks.subjectType, type), eq(schema.profileSheetLinks.subjectId, subjectId),
  );
  const rows = await db.select({ id: schema.profileSheetLinks.id, kind: schema.profileSheetLinks.kind, targetId: schema.profileSheetLinks.targetId })
    .from(schema.profileSheetLinks).where(where).all();
  if (rows.some((r) => r.kind === kind && r.targetId === targetId)) return "exists";
  if (rows.length >= MAX_LINKS_PER_SUBJECT) return "full";
  const now = nowSec();
  await db.insert(schema.profileSheetLinks).values({
    id: newId(), ownerMemberId: ownerId, subjectType: type, subjectId, kind, targetId, reason: "", starred: 0, source: "manual", createdAt: now, updatedAt: now,
  });
  return "added";
}

export async function setLinkStarred(db: Db, ownerId: string, linkId: string, starred: boolean): Promise<boolean> {
  const rows = await db.update(schema.profileSheetLinks).set({ starred: starred ? 1 : 0, updatedAt: nowSec() })
    .where(and(eq(schema.profileSheetLinks.id, linkId), eq(schema.profileSheetLinks.ownerMemberId, ownerId)))
    .returning({ id: schema.profileSheetLinks.id }).all();
  return rows.length > 0;
}

export async function removeLink(db: Db, ownerId: string, linkId: string): Promise<boolean> {
  const rows = await db.delete(schema.profileSheetLinks)
    .where(and(eq(schema.profileSheetLinks.id, linkId), eq(schema.profileSheetLinks.ownerMemberId, ownerId)))
    .returning({ id: schema.profileSheetLinks.id }).all();
  return rows.length > 0;
}

/**
 * AIの検索結果を、紹介できそうな人として保存する。
 *  ・前回のAIの結果のうち、重点（チェック）を付けていないものは入れ替える。重点を付けたもの・自分で追加したものは残す
 *  ・同じ人は1回だけ（ホップの近い順に並んだ結果の、先に出たものを使う）
 */
export async function saveMatchResults(
  db: Db, ownerId: string, type: ProfileSheetSubjectType, subjectId: string, found: { targetId: string; reason: string }[],
): Promise<number> {
  const kind = linkKindFor(type);
  const where = and(
    eq(schema.profileSheetLinks.ownerMemberId, ownerId), eq(schema.profileSheetLinks.subjectType, type), eq(schema.profileSheetLinks.subjectId, subjectId),
  );
  await db.delete(schema.profileSheetLinks).where(and(where, eq(schema.profileSheetLinks.kind, kind), eq(schema.profileSheetLinks.source, "ai"), eq(schema.profileSheetLinks.starred, 0)));
  const keep = await db.select({ id: schema.profileSheetLinks.id, targetId: schema.profileSheetLinks.targetId, source: schema.profileSheetLinks.source })
    .from(schema.profileSheetLinks).where(and(where, eq(schema.profileSheetLinks.kind, kind))).all();
  const have = new Map(keep.map((k) => [k.targetId, k]));
  const now = nowSec();
  let saved = 0;
  const seen = new Set<string>();
  for (const f of found) {
    if (seen.has(f.targetId)) continue;
    seen.add(f.targetId);
    const mine = have.get(f.targetId);
    if (mine) {
      // 重点を付けたAIの結果は、理由だけ新しくする。自分で追加したものは、理由がなければ入れる
      await db.update(schema.profileSheetLinks).set({ reason: f.reason, updatedAt: now }).where(eq(schema.profileSheetLinks.id, mine.id));
      continue;
    }
    if (keep.length + saved >= MAX_LINKS_PER_SUBJECT) break;
    await db.insert(schema.profileSheetLinks).values({
      id: newId(), ownerMemberId: ownerId, subjectType: type, subjectId, kind, targetId: f.targetId, reason: f.reason, starred: 0, source: "ai", createdAt: now, updatedAt: now,
    });
    saved++;
  }
  return saved;
}

export async function setMatchRun(
  db: Db, ownerId: string, type: ProfileSheetSubjectType, subjectId: string, jobId: string, status: "running" | "done" | "error", message = "",
): Promise<void> {
  const now = nowSec();
  await db.insert(schema.profileSheetMatchRuns).values({ ownerMemberId: ownerId, subjectType: type, subjectId, jobId, status, message, updatedAt: now })
    .onConflictDoUpdate({
      target: [schema.profileSheetMatchRuns.ownerMemberId, schema.profileSheetMatchRuns.subjectType, schema.profileSheetMatchRuns.subjectId],
      set: { jobId, status, message, updatedAt: now },
    });
}

/** 相手を消したとき（メンバーの退会・外部人脈の削除）に、紹介できそうな人の記録も消す */
export async function deleteSheetLinksFor(db: Db, ownerId: string | null, type: ProfileSheetSubjectType, subjectId: string): Promise<void> {
  const subj = and(eq(schema.profileSheetLinks.subjectType, type), eq(schema.profileSheetLinks.subjectId, subjectId));
  await db.delete(schema.profileSheetLinks).where(ownerId ? and(subj, eq(schema.profileSheetLinks.ownerMemberId, ownerId)) : subj);
  const runSubj = and(eq(schema.profileSheetMatchRuns.subjectType, type), eq(schema.profileSheetMatchRuns.subjectId, subjectId));
  await db.delete(schema.profileSheetMatchRuns).where(ownerId ? and(runSubj, eq(schema.profileSheetMatchRuns.ownerMemberId, ownerId)) : runSubj);
  // この相手が「紹介の相手」として入っている記録も消す
  const kind = type === "member" ? "member" : "contact";
  await db.delete(schema.profileSheetLinks).where(and(eq(schema.profileSheetLinks.kind, kind), eq(schema.profileSheetLinks.targetId, subjectId), ...(ownerId ? [eq(schema.profileSheetLinks.ownerMemberId, ownerId)] : [])));
}
