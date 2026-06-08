// =============================================================
// アプリ設定フック（公開エンドポイント、全ユーザー共通）
// 用語カスタマイズ（お題/USP/1to1）などを取得する
// =============================================================
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type AppSettings = {
  appTitle: string;
  appLogo: string;
  appPointName: string;
  termQuest: string;    // "お題" など
  termUsp: string;      // "USP" "強み" "価値" など
  termOneOnOne: string; // "1to1" "面談" など
};

type SettingsResponse = { data: AppSettings };

const DEFAULTS: AppSettings = {
  appTitle: "白樺クエスト",
  appLogo: "🃏",
  appPointName: "pt",
  termQuest: "お題",
  termUsp: "USP",
  termOneOnOne: "1to1",
};

export function useSettings(): AppSettings {
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsResponse>("/settings"),
    staleTime: 5 * 60 * 1000,
  });
  return data?.data ?? DEFAULTS;
}
