// =============================================================
// ご縁さがし 検索履歴の保存と、履歴用の文言（ルートと、裏で動く検索ジョブの両方から使う）
// =============================================================
import { createDb, schema } from "../db/index.ts";
import { newId } from "./auth.ts";
import type { EnishiResultCard, EnishiSearchResult, EnishiTarget, Hop } from "./enishi-search.ts";

export type HistoryCard = EnishiResultCard & {
  cardId: string; goodMatch: boolean; transacted: boolean; introduced: boolean;
  // 利用者が「明らかに間違っている」と判断してリストから削除したカードの記録。
  // removedAsAiMistakeがtrueのものは、後日の検索プロンプトに反面教師として渡し、同じ誤りを学習・回避させる。
  removed: boolean; removedReason: string | null; removedAsAiMistake: boolean;
};
export type HistoryResult = Omit<EnishiSearchResult, "groups"> & { groups: { hop: Hop; label: string; results: HistoryCard[] }[] };

// 検索結果の各カードに、履歴保存用の識別子（cardId）・「良いご縁だった」フラグの初期値・
// 「このご縁で繋がりました」「紹介しました」フラグの現在値を付与する（いずれもcandidateId等の
// 組み合わせで判定するため、検索直後は既に除外済みのはずで常にfalseになる。履歴を後から見返す際は
// 「良いご縁だった」と違いresultJsonに固定保存せず、表示のたびにこの関数で最新の状態を計算し直す）。
export function augmentResultWithCards(result: EnishiSearchResult, transactedIds: Set<string>, introducedKeys: Set<string>): HistoryResult {
  let counter = 0;
  return {
    ...result,
    groups: result.groups.map((g) => ({
      ...g,
      results: g.results.map((r) => ({
        ...r, cardId: `c${counter++}`, goodMatch: false,
        transacted: transactedIds.has(r.candidateId),
        introduced: r.myContactId ? introducedKeys.has(`${r.myContactId}|${r.candidateId}`) : false,
        removed: false, removedReason: null, removedAsAiMistake: false,
      })),
    })),
  };
}


export function formatHistoryDate(ts: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(ts * 1000));
}

// 検索結果として実際に見つかった件数（グループ横断の合計）。履歴タイトルに含めて一覧で見分けやすくする。
export function countResults(result: EnishiSearchResult): number {
  return result.groups.reduce((sum, g) => sum + g.results.length, 0);
}

export function buildForMeTitle(targets: EnishiTarget[], createdAt: number, resultCount: number): string {
  const first = targets[0]?.description ?? "";
  const firstShort = first.length > 18 ? `${first.slice(0, 18)}…` : first;
  const suffix = targets.length > 1 ? ` ほか${targets.length - 1}件` : "";
  return `${formatHistoryDate(createdAt)} 私のご縁：${firstShort}${suffix}（${resultCount}件ヒット）`;
}


export function buildContactSearchTitle(freeText: string, createdAt: number, resultCount: number): string {
  const short = freeText.length > 20 ? `${freeText.slice(0, 20)}…` : freeText;
  return `${formatHistoryDate(createdAt)} 人脈検索：${short}（${resultCount}件ヒット）`;
}

export async function saveSearchHistory(
  db: ReturnType<typeof createDb>,
  meId: string,
  mode: "for-me" | "giver" | "contact-search",
  title: string,
  params: unknown,
  result: EnishiSearchResult,
  now: number,
  /** 保存する履歴のID（指定しなければ新しく作る） */
  fixedId?: string
): Promise<{ historyId: string; result: HistoryResult }> {
  // 検索直後の時点では、「このご縁で繋がりました」「紹介しました」済みのものはすでに候補から
  // 除外されているため常にfalseになる
  const augmented = augmentResultWithCards(result, new Set(), new Set());
  const historyId = fixedId ?? newId();
  await db.insert(schema.enishiSearchHistory).values({
    id: historyId, memberId: meId, mode, title,
    paramsJson: JSON.stringify(params),
    resultJson: JSON.stringify(augmented),
    createdAt: now,
  });
  return { historyId, result: augmented };
}

