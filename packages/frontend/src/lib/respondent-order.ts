// =============================================================
// 回答表（日程の回答・出欠の回答）の、人の並び順
//   answered … 回答した順（古い順。いちばん最近回答した人が、いちばん下）
//   kana     … 五十音順
// ミーティング・定例会で共通して使う。選んだ並び順は、この端末に覚えておく。
// =============================================================
import { useState } from "react";

export type RespondentOrder = "answered" | "kana";

const STORAGE_KEY = "respondent-order";

function loadOrder(): RespondentOrder {
  try {
    return localStorage.getItem(STORAGE_KEY) === "kana" ? "kana" : "answered";
  } catch {
    return "answered";
  }
}

/** 並び順の選択（この端末に覚えておく） */
export function useRespondentOrder(): [RespondentOrder, (order: RespondentOrder) => void] {
  const [order, setOrder] = useState<RespondentOrder>(loadOrder);
  const update = (next: RespondentOrder): void => {
    setOrder(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* 保存できなくても、画面の並びは切り替わる */ }
  };
  return [order, update];
}

type Sortable = { name: string; furigana?: string | null; respondedAt?: number | null };

function kanaCompare(a: Sortable, b: Sortable): number {
  // ふりがなが登録されていればそれで、なければ名前で並べる
  return ((a.furigana || a.name)).localeCompare((b.furigana || b.name), "ja");
}

/**
 * 指定した並び順に並べ替えた新しい配列を返す。
 * 「回答した順」では、まだ回答していない人を先頭にまとめ、そのあとを回答の古い順に並べる
 * （いちばん最近回答した人が、必ずいちばん下になる）。同じ時刻のときは五十音順。
 */
export function sortRespondents<T extends Sortable>(items: readonly T[], order: RespondentOrder): T[] {
  const copy = [...items];
  if (order === "kana") return copy.sort(kanaCompare);
  return copy.sort((a, b) => {
    const ta = a.respondedAt ?? -1;
    const tb = b.respondedAt ?? -1;
    return ta !== tb ? ta - tb : kanaCompare(a, b);
  });
}
