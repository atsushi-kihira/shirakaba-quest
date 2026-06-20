// =============================================================
// アプリ設定フック（公開エンドポイント、全ユーザー共通）
// =============================================================
import { useQuery } from "@tanstack/react-query";
import { api, API_BASE_URL } from "@/lib/api";

export type AppSettings = {
  appTitle: string;
  appLogo: string;
  appPointName: string;
  termQuest: string;
  termUsp: string;
  termOneOnOne: string;
  characterImageKey: string | null;
  /** 表示用URL（カスタム未設定時はデフォルト画像を指す） */
  characterImageUrl: string;
};

type SettingsResponse = {
  data: Omit<AppSettings, "characterImageUrl">;
};

const DEFAULT_CHARACTER_URL = "/character-default.png";
// Workers の絶対 URL を使用（Pages の相対 /api は 404 になるため）
const CUSTOM_CHARACTER_URL  = `${API_BASE_URL}/character-image`;

const DEFAULTS: AppSettings = {
  appTitle: "白樺クエスト",
  appLogo: "🃏",
  appPointName: "pt",
  termQuest: "お題",
  termUsp: "USP",
  termOneOnOne: "1to1",
  characterImageKey: null,
  characterImageUrl: DEFAULT_CHARACTER_URL,
};

export function useSettings(): AppSettings {
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsResponse>("/settings"),
    staleTime: 5 * 60 * 1000,
  });
  if (!data?.data) return DEFAULTS;
  return {
    ...data.data,
    characterImageUrl: data.data.characterImageKey ? CUSTOM_CHARACTER_URL : DEFAULT_CHARACTER_URL,
  };
}
