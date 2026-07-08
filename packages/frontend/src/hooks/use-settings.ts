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
  /** カスタム画像のURL。未設定またはロード前は null（デフォルト画像へのフォールバックは行わない） */
  characterImageUrl: string | null;
  timezone: string;
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
  characterImageKey: null,
  characterImageUrl: null,
  timezone: "Asia/Tokyo",
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
    characterImageUrl: data.data.characterImageKey ? CUSTOM_CHARACTER_URL : null,
    isLoading,
  };
}
