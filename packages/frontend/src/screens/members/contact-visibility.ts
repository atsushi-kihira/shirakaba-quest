// 外部人脈の公開範囲の表示名（一覧・詳細・編集の画面で共通）
export type ContactVisibility = "private" | "existence" | "full";

export const VISIBILITY_LABEL: Record<ContactVisibility, string> = {
  private: "🔒 非公開（自分だけ）",
  existence: "🌫️ 存在のみ公開（詳細は非公開）",
  full: "📖 詳細まで公開（連絡先は非公開）",
};
