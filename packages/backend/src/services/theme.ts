// =============================================================
// UIテーマの許可リスト（アプリ全体設定・個人設定の両方で共用）
// =============================================================
export const VALID_THEMES = ["playful", "big", "pastel", "flat", "dense", "corp", "contrast", "dark"] as const;
export type ThemeValue = (typeof VALID_THEMES)[number];
