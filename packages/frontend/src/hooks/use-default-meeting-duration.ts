// =============================================================
// マイページ（日程調整設定）の「デフォルトの会議時間」
// 1to1の申込などのダイアログで、所要時間の初期値に使う（設定がなければ30分）。
// 設定の読み込み後に、まだ本人が変えていなければ、一度だけ反映するために使う
// =============================================================
import { useQuery } from "@tanstack/react-query";
import { request } from "@/lib/api";

export const FALLBACK_MEETING_DURATION = 30;

export function useDefaultMeetingDuration(): { duration: number; loaded: boolean } {
  const { data, isFetched } = useQuery<{ data: { durationMinutes?: number | null } | null }>({
    queryKey: ["scheduler", "settings"],
    queryFn: () => request("/scheduler/me/settings"),
    staleTime: 60_000,
  });
  return { duration: data?.data?.durationMinutes ?? FALLBACK_MEETING_DURATION, loaded: isFetched };
}
