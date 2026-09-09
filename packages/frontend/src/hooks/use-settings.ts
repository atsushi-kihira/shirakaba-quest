// =============================================================
// アプリ設定フック（公開エンドポイント、全ユーザー共通）
// =============================================================
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, API_BASE_URL } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

export type AppTheme = "playful" | "big" | "pastel" | "flat" | "dense" | "corp" | "contrast" | "dark";

export const THEME_OPTIONS: { value: AppTheme; label: string; description: string; swatch: [string, string, string] }[] = [
  { value: "playful",  label: "プレイフル（現行）",   description: "紙質感・手書き見出し・絵文字を使った、今のBizQuestそのもの",             swatch: ["#faf5e8", "#b5384b", "#d4a03b"] },
  { value: "big",       label: "のびのび大アイコン",   description: "色・書体はプレイフルのまま、アイコンやアバターまわりの余白を大きくする", swatch: ["#faf5e8", "#b5384b", "#d4a03b"] },
  { value: "pastel",    label: "モダン・パステル",     description: "紙質感をやめ、フラットな色面と大きめの角丸で今どきの軽さを出す",         swatch: ["#f5f3fb", "#e14d84", "#f5a623"] },
  { value: "flat",      label: "シンプル・フラット",   description: "紙質感を外した、落ち着いた業務ツール寄りの見た目",                       swatch: ["#f8f6f2", "#b5384b", "#b8842a"] },
  { value: "dense",     label: "データ密度重視",       description: "余白を絞り、青系アクセントで分析ツールのような印象にする",               swatch: ["#f2f4f7", "#2f5fd0", "#1f8a5c"] },
  { value: "corp",      label: "コーポレート・ネイビー", description: "紺と明朝見出しで、社内システムのような格式を出す",                       swatch: ["#16233e", "#a9812f", "#eef1f5"] },
  { value: "contrast",  label: "ハイコントラスト",     description: "白地に濃い文字色・太い枠線で視認性を最優先にする",                       swatch: ["#ffffff", "#9c1f34", "#111111"] },
  { value: "dark",      label: "ダーク（ナイトモード）", description: "暖色寄りの黒地にブランドカラーを明るく発色させる",                       swatch: ["#18171b", "#e85d72", "#e3b955"] },
];

export type AppSettings = {
  appTitle: string;
  appLogo: string;
  appPointName: string;
  termQuest: string;
  termUsp: string;
  termOneOnOne: string;
  termExternalGuest: string;
  termEnishi: string;
  termBusinessCommunity: string;
  characterImageKey: string | null;
  /** カスタム画像のURL。未設定またはロード前は null（デフォルト画像へのフォールバックは行わない） */
  characterImageUrl: string | null;
  timezone: string;
  theme: AppTheme;
};

type SettingsResponse = {
  data: Omit<AppSettings, "characterImageUrl">;
};

// Workers の絶対 URL を使用（Pages の相対 /api は 404 になるため）
const CUSTOM_CHARACTER_URL = `${API_BASE_URL}/character-image`;

const DEFAULTS: AppSettings = {
  appTitle: "白樺クエスト",
  appLogo: "🃏",
  appPointName: "pt",
  termQuest: "お題",
  termUsp: "USP",
  termOneOnOne: "1to1",
  termExternalGuest: "外部ゲスト",
  termEnishi: "ご縁",
  termBusinessCommunity: "ビジネスコミュニティ",
  characterImageKey: null,
  characterImageUrl: null,
  timezone: "Asia/Tokyo",
  theme: "playful",
};

export function useSettings(): AppSettings & { isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsResponse>("/settings"),
    staleTime: 5 * 60 * 1000,
  });
  if (!data?.data) return { ...DEFAULTS, isLoading };
  return {
    ...data.data,
    timezone: data.data.timezone ?? "Asia/Tokyo",
    theme: (data.data.theme as AppTheme) ?? "playful",
    characterImageUrl: data.data.characterImageKey ? CUSTOM_CHARACTER_URL : null,
    isLoading,
  };
}

const THEME_CLASS_NAMES = THEME_OPTIONS.map((t) => `theme-${t.value}`);
const VALID_THEME_VALUES = new Set(THEME_OPTIONS.map((t) => t.value));

/**
 * 選択中のカラーテーマを <body> に適用する。管理画面は admin-theme が別途上書きするため影響を受けない。
 * ログイン中のメンバーが個人用テーマを設定している場合はそちらを優先する（未設定ならアプリ全体のテーマに従う）。
 */
export function useApplyTheme() {
  const { theme } = useSettings();
  const personalTheme = useAuthStore((s) => s.user?.personalTheme);
  const effectiveTheme = personalTheme && VALID_THEME_VALUES.has(personalTheme as AppTheme) ? (personalTheme as AppTheme) : theme;
  useEffect(() => {
    document.body.classList.remove(...THEME_CLASS_NAMES);
    document.body.classList.add(`theme-${effectiveTheme}`);
  }, [effectiveTheme]);
}

/**
 * iOSホーム画面追加時のアプリ名・Web Push通知の送信元表示に使われるメタタグを更新する。
 * 静的HTML（index.html）では組織ごとのアプリ名を反映できないため、読み込み時に上書きする。
 * ログイン画面を含む全画面で有効にする必要があるため、App直下（AppWithMe）で呼び出す。
 */
export function usePwaMetaTags() {
  const { appTitle } = useSettings();
  useEffect(() => {
    const appleTitleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appleTitleMeta) appleTitleMeta.setAttribute("content", appTitle);
    const siteNameMeta = document.querySelector('meta[property="og:site_name"]');
    if (siteNameMeta) siteNameMeta.setAttribute("content", appTitle);
  }, [appTitle]);
}
