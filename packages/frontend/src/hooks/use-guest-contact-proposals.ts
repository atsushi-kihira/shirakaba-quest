// =============================================================
// 外部ゲストの回答からの人脈の自動登録で、登録件数の上限に達して保留になったものの、確認待ち一覧
// （人脈の管理ページ・通知画面・ホーム画面で共通）
// =============================================================
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore, isApprovedMember } from "@/stores/auth-store";

export type GuestContactProposal = { id: string; name: string; email: string; company: string; context: string | null; createdAt: number };
export type GuestContactProposalsData = { proposals: GuestContactProposal[]; limit: number; publicCount: number };

export const GUEST_PROPOSALS_KEY = ["guest-contact-proposals"];

export function useGuestContactProposals() {
  const user = useAuthStore((s) => s.user);
  const { data } = useQuery({
    queryKey: GUEST_PROPOSALS_KEY,
    queryFn: () => api.get<{ data: GuestContactProposalsData }>("/guest-contact-proposals"),
    enabled: !!user && user.userType === "member" && isApprovedMember(user),
    staleTime: 30_000,
  });
  return data?.data ?? { proposals: [], limit: 300, publicCount: 0 };
}
