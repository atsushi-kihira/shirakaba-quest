// =============================================================
// 共有：ご縁さがしの検索結果（検索履歴の1件）
// 検索条件と「良いご縁」の印は、そのまま見せる。個人の情報は、見る人に応じて次のように絞る。
//   ・共有した人の外部人脈：人脈ごとの公開設定のとおり（非公開は出さない／存在のみは名前・会社名を伏せる）
//   ・ほかの方の人脈・卵・ガチョウに関する結果：メンバーには、メンバーが見られる範囲で出す。
//     URLで見る人（ログイン不要）には、出さない
//   ・メンバー本人がヒットした結果：公開されているメンバー情報（名前・絵文字）だけ
// 検索のための内部ID（candidateId など）や、「紹介しました」などの本人の操作の状態は、出さない。
// =============================================================
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import type { ShareRow, ViewerLevel } from "./content-share.ts";
import type { HistoryCard, HistoryResult } from "./enishi-history.ts";

export type SharedResultCard = {
  hop: string; type: "egg" | "goose"; matchedTargetLabel: string;
  counterpart: { memberId: string; name: string; emoji: string; bgColor: string };
  /** 経路のうち、人脈（または相手）にあたる部分の呼び名 */
  contactLabel: string;
  dealDescription: string; why: string; privacyNote: string | null;
  goodMatch: boolean; isMemberCandidate: boolean; score: number | null; isOwnContact: boolean;
};
export type SharedResultBody = {
  mode: string; createdAt: number;
  /** 検索のときに指定した条件（狙っている相手像の説明など） */
  conditions: string[];
  groups: { hop: string; label: string; results: SharedResultCard[] }[];
  total: number;
  /** 一部の結果が、共有の範囲に合わせて伏せられている */
  someHidden: boolean;
  aiCallFailed: boolean; truncated: boolean;
};

export async function manageResult(db: Db, subjectId: string, meId: string): Promise<{ title: string } | null> {
  const r = await db.select({ title: schema.enishiSearchHistory.title }).from(schema.enishiSearchHistory)
    .where(and(eq(schema.enishiSearchHistory.id, subjectId), eq(schema.enishiSearchHistory.memberId, meId))).get();
  return r ? { title: r.title } : null;
}

export async function titlesForResults(db: Db, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 80) {
    const rows = await db.select({ id: schema.enishiSearchHistory.id, title: schema.enishiSearchHistory.title }).from(schema.enishiSearchHistory).where(inArray(schema.enishiSearchHistory.id, ids.slice(i, i + 80))).all();
    for (const r of rows) out.set(r.id, r.title);
  }
  return out;
}

/** 検索条件を、人が読める文にして取り出す（内部の評価の文脈などは含めない） */
export function describeConditions(paramsJson: string): string[] {
  let p: unknown;
  try { p = JSON.parse(paramsJson); } catch { return []; }
  if (!p || typeof p !== "object") return [];
  const o = p as Record<string, unknown>;
  const out: string[] = [];
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  if (Array.isArray(o.targets)) {
    for (const t of o.targets) {
      const d = t && typeof t === "object" ? str((t as Record<string, unknown>).description) : null;
      if (d) out.push(d);
    }
  }
  const free = str(o.freeText);
  if (free) out.push(free);
  for (const key of ["specialties", "relationships"] as const) {
    const v = o[key];
    if (Array.isArray(v)) {
      const items = v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
      if (items.length > 0) out.push(`${key === "specialties" ? "専門分野" : "関係性"}：${items.join("、")}`);
    }
  }
  return [...new Set(out)].slice(0, 30);
}

const HIDDEN = "（非公開）";

/** 文章の中の、伏せたい語を置き換える（名前は、空白の有無の違いも含める） */
function maskTokens(text: string, tokens: string[]): string {
  let out = text;
  for (const t of tokens) if (t.length >= 2) out = out.split(t).join(HIDDEN);
  return out;
}
const nameTokens = (c: { name: string; company: string | null }): string[] => {
  const t = [c.name, c.name.replace(/[\s　]+/g, "")];
  if (c.company) t.push(c.company);
  return [...new Set(t.filter((x) => x.length >= 2))].sort((a, b) => b.length - a.length);
};

/** 共有した人の立場の言い方に直す（元の文は、検索した本人に向けて「あなた」と書かれている） */
const asSharer = (s: string): string => s.replace(/あなた自身/g, "共有した方ご自身").replace(/あなた/g, "共有した方");

type ContactRow = typeof schema.externalContacts.$inferSelect;

export async function buildResultView(
  db: Db, share: ShareRow, _viewerId: string | null, level: ViewerLevel,
): Promise<{ title: string; body: SharedResultBody } | null> {
  const row = await db.select().from(schema.enishiSearchHistory).where(eq(schema.enishiSearchHistory.id, share.subjectId)).get();
  if (!row) return null;
  let result: HistoryResult;
  try { result = JSON.parse(row.resultJson) as HistoryResult; } catch { return null; }

  const cards = result.groups.flatMap((g) => g.results).filter((c) => !c.removed);
  // 結果に関わる人脈を、まとめて引く（for-me／人脈検索：candidateId、貢献のご縁：myContactId）
  const contactIds = [...new Set(cards.flatMap((c) => [c.isMemberCandidate ? "" : (row.mode === "giver" ? (c.myContactId ?? "") : c.candidateId)]).filter(Boolean))];
  const contacts = new Map<string, ContactRow>();
  for (let i = 0; i < contactIds.length; i += 80) {
    for (const c of await db.select().from(schema.externalContacts).where(inArray(schema.externalContacts.id, contactIds.slice(i, i + 80))).all()) contacts.set(c.id, c);
  }

  const isPublic = level === "public";
  let hidden = 0;
  const convert = (c: HistoryCard): SharedResultCard | null => {
    const base = {
      hop: c.hop as string, type: c.type, matchedTargetLabel: asSharer(c.matchedTargetLabel),
      goodMatch: !!c.goodMatch, isMemberCandidate: !!c.isMemberCandidate, score: typeof c.score === "number" ? c.score : null,
    };
    if (c.isMemberCandidate) {
      // メンバー本人がヒットしたもの：公開されているメンバー情報（名前・絵文字）だけ
      return {
        ...base, counterpart: { memberId: c.counterpart.memberId, name: c.counterpart.name, emoji: c.counterpart.emoji, bgColor: c.counterpart.bgColor },
        contactLabel: "", dealDescription: asSharer(c.dealDescription), why: asSharer(c.why), privacyNote: null, isOwnContact: false,
      };
    }
    const contactId = row.mode === "giver" ? (c.myContactId ?? "") : c.candidateId;
    const contact = contacts.get(contactId);
    if (!contact) return null; // もとの人脈が消えている
    const mine = contact.ownerMemberId === share.ownerMemberId;
    if (contact.visibility === "private") return null;
    // URLで見る人には、ほかの方の人脈・卵・ガチョウに関する結果は出さない
    if (isPublic && (!mine || row.mode === "giver")) return null;

    const tokens = contact.visibility === "full" ? [] : nameTokens(contact);
    const mask = (s: string) => asSharer(tokens.length > 0 ? maskTokens(s, tokens) : s);
    const rawLabel = c.path[c.contactPathIndex] ?? "";
    return {
      ...base,
      counterpart: mine
        ? { memberId: "", name: contact.visibility === "full" ? contact.name : "外部人脈（名前は非公開）", emoji: "👤", bgColor: "bg-stone-100" }
        : { memberId: c.counterpart.memberId, name: c.counterpart.name, emoji: c.counterpart.emoji, bgColor: c.counterpart.bgColor },
      contactLabel: mask(rawLabel),
      dealDescription: mask(c.dealDescription), why: mask(c.why),
      privacyNote: mine
        ? (contact.visibility === "full" ? null : "共有した方が登録した人脈です。名前・会社名は伏せています。")
        : (contact.visibility === "full" ? null : "ほかの方の人脈です。実名・連絡先は伏せています。"),
      isOwnContact: mine,
    };
  };

  const groups = result.groups.map((g) => ({
    hop: g.hop as string, label: g.label,
    results: g.results.filter((c) => !c.removed).flatMap((c) => {
      const out = convert(c);
      if (!out) hidden++;
      return out ? [out] : [];
    }),
  }));
  return {
    title: row.title,
    body: {
      mode: row.mode, createdAt: row.createdAt, conditions: describeConditions(row.paramsJson),
      groups, total: groups.reduce((n, g) => n + g.results.length, 0), someHidden: hidden > 0,
      aiCallFailed: !!result.aiCallFailed, truncated: !!result.truncated,
    },
  };
}
