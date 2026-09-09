// =============================================================
// 外部人脈（協働の人脈をさがす・メンバー詳細の人脈検索、両方で共用）
// =============================================================

export type ContactVisibility = "private" | "existence" | "full";

export type Contact = {
  id: string;
  ownerId: string;
  mine: boolean;
  visibility: ContactVisibility;
  specialty: string | null;
  relationships: string[];
  name: string | null;
  company: string | null;
  note: string | null;
  businessSummary: string | null;
  businessSummaryDetail: string | null;
  createdAt: number;
  isFavorite: boolean;
};

// 公開レベルの並び順（詳細まで公開 → 存在まで公開 → 非公開）。数字が小さいほど先に表示する
export const VISIBILITY_RANK: Record<ContactVisibility, number> = { full: 0, existence: 1, private: 2 };

// 公開レベルごとの色分け（なかま画面の「自分の人脈一覧」と統一：詳細まで公開＝エメラルド、存在まで公開＝控えめな金、非公開＝グレー）
export const VISIBILITY_STYLE: Record<ContactVisibility, { bg: string; border: string }> = {
  full:      { bg: "rgba(90,140,92,0.10)",  border: "var(--color-success)" },
  existence: { bg: "rgba(212,160,59,0.10)", border: "var(--color-accent)" },
  private:   { bg: "var(--color-paper-200)", border: "var(--color-ink-400)" },
};

export type ContactSortOrder = "newest" | "oldest" | "visibility";
export const CONTACT_SORT_LABEL: Record<ContactSortOrder, string> = {
  newest: "登録日時（新しい順）",
  oldest: "登録日時（古い順）",
  visibility: "公開レベル順",
};

export function sortContacts(list: Contact[], order: ContactSortOrder): Contact[] {
  const sorted = [...list];
  if (order === "newest") sorted.sort((a, b) => b.createdAt - a.createdAt);
  else if (order === "oldest") sorted.sort((a, b) => a.createdAt - b.createdAt);
  else sorted.sort((a, b) => VISIBILITY_RANK[a.visibility] - VISIBILITY_RANK[b.visibility] || b.createdAt - a.createdAt);
  return sorted;
}
