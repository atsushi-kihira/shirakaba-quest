// =============================================================
// アプリ設定の「用語」（お題・USP・1to1・外部ゲスト・ご縁・ビジネスコミュニティ）を、お知らせの文面に反映する
// チャプターごとに、用語を変えて使っている（例：お題 → クエスト、ご縁 → リファーラル）。アプリの画面と同じ用語で、お知らせが届くようにする。
//   ・文面の中の差し込み項目 {{termQuest}} {{termUsp}} {{termOneOnOne}} {{termExternalGuest}} {{termEnishi}} {{termEnishiSearch}} {{termBusinessCommunity}} を、設定の用語にする
//   ・すでに書かれている標準の用語（「お題」「ご縁さがし」「1to1」など）も、設定が違うときは、設定の用語に置き換える
//     （「ご縁さがし」は、画面と同じ「◯◯さがし」の形。「ご縁」だけの語は、ほかの意味でも使うので、置き換えない）
// =============================================================
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";

export type AppTerms = { quest: string; usp: string; oneOnOne: string; externalGuest: string; enishi: string; businessCommunity: string };

export const DEFAULT_TERMS: AppTerms = {
  quest: "お題", usp: "USP", oneOnOne: "1to1", externalGuest: "外部ゲスト", enishi: "ご縁", businessCommunity: "ビジネスコミュニティ",
};

export async function loadTerms(db: Db): Promise<AppTerms> {
  const d = await db.select({
    quest: schema.cardDesigns.termQuest, usp: schema.cardDesigns.termUsp, oneOnOne: schema.cardDesigns.termOneOnOne,
    externalGuest: schema.cardDesigns.termExternalGuest, enishi: schema.cardDesigns.termEnishi,
    businessCommunity: schema.cardDesigns.termBusinessCommunity,
  }).from(schema.cardDesigns).get();
  const pick = (v: string | null | undefined, fallback: string) => (v?.trim() ? v.trim() : fallback);
  return {
    quest: pick(d?.quest, DEFAULT_TERMS.quest), usp: pick(d?.usp, DEFAULT_TERMS.usp), oneOnOne: pick(d?.oneOnOne, DEFAULT_TERMS.oneOnOne),
    externalGuest: pick(d?.externalGuest, DEFAULT_TERMS.externalGuest), enishi: pick(d?.enishi, DEFAULT_TERMS.enishi),
    businessCommunity: pick(d?.businessCommunity, DEFAULT_TERMS.businessCommunity),
  };
}

/** 文面に差し込める用語（差し込み項目の名前 → 設定の用語） */
export function termVars(t: AppTerms): Record<string, string> {
  return {
    termQuest: t.quest, termUsp: t.usp, termOneOnOne: t.oneOnOne, termExternalGuest: t.externalGuest,
    termEnishi: t.enishi, termEnishiSearch: `${t.enishi}さがし`, termBusinessCommunity: t.businessCommunity,
  };
}

/** 文面の用語を、アプリ設定の用語にそろえる */
export function applyTerms(text: string, t: AppTerms): string {
  const vars = termVars(t);
  let out = text.replace(/\{\{(term\w+)\}\}/g, (m, k: string) => vars[k] ?? m);
  // 標準の用語が、設定で変えられているものだけ置き換える（先に長い語から。置き換えた語は、再度、置き換えない）
  const pairs: Array<[string, string]> = [];
  if (t.enishi !== DEFAULT_TERMS.enishi) pairs.push(["ご縁さがし", `${t.enishi}さがし`]);
  if (t.businessCommunity !== DEFAULT_TERMS.businessCommunity) pairs.push([DEFAULT_TERMS.businessCommunity, t.businessCommunity]);
  if (t.externalGuest !== DEFAULT_TERMS.externalGuest) pairs.push([DEFAULT_TERMS.externalGuest, t.externalGuest]);
  if (t.quest !== DEFAULT_TERMS.quest) pairs.push([DEFAULT_TERMS.quest, t.quest]);
  if (t.oneOnOne !== DEFAULT_TERMS.oneOnOne) pairs.push([DEFAULT_TERMS.oneOnOne, t.oneOnOne]);
  if (t.usp !== DEFAULT_TERMS.usp) pairs.push([DEFAULT_TERMS.usp, t.usp]);
  if (pairs.length === 0) return out;
  const re = new RegExp(pairs.map(([from]) => from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  const to = new Map(pairs);
  out = out.replace(re, (m) => to.get(m) ?? m);
  return out;
}
