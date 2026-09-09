// =============================================================
// 外部ゲストとの1to1予約のうち、人脈化を促すべきもの（実施済み・未登録・未dismiss）の集計フック
// ホームバッジ・ミーティングタブバッジ・ミーティング画面で共通利用
// =============================================================
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/api";

export type GuestFollowup = {
  id: string;
  guestName: string;
  guestMessage: string | null;
  guestCompany: string | null;
  startAtUtc: string;
  endAtUtc: string;
};

export function useGuestFollowups() {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: ["scheduler", "bookings", "guest-followups"],
    queryFn: () => api.get<{ data: GuestFollowup[] }>("/scheduler/bookings/guest-followups"),
    enabled: !!user && user.userType === "member",
    staleTime: 30_000,
  });
}

/**
 * 未決着の外部ゲスト1to1件数（バッジ用）。guest-followups と異なり実施予定時刻を過ぎているかは問わず、
 * 実施前の「進行中（完了待ち）」も含む。メンバー同士の1to1バッジ（承諾済み・未完了であれば実施日時に
 * 関わらず件数に含める）と考え方を揃えるためのフック。
 */
export function usePendingExternalOneOnOneCount() {
  const user = useAuthStore((s) => s.user);
  const query = useQuery({
    queryKey: ["scheduler", "bookings", "pending-count"],
    queryFn: () => api.get<{ data: { count: number } }>("/scheduler/bookings/pending-count"),
    enabled: !!user && user.userType === "member",
    staleTime: 30_000,
  });
  return query.data?.data.count ?? 0;
}
