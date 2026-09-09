// =============================================================
// 協働タブの新着バッジ集計フック（活動タイムライン＋シェアストーリーの新着件数）
// =============================================================
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/api";

export type CollabUnreadCount = { timeline: number; stories: number; total: number };

export function useCollabAlerts() {
  const user = useAuthStore((s) => s.user);

  const { data } = useQuery({
    queryKey: ["collab", "activity", "unread-count"],
    queryFn: () => api.get<{ data: CollabUnreadCount }>("/collab/activity/unread-count"),
    enabled: !!user,
    staleTime: 30_000,
  });

  return data?.data ?? { timeline: 0, stories: 0, total: 0 };
}

/** 未読の協働リアクションメッセージ通知の件数（ホームタブの通知バッジ用） */
export function useCollabReactionNotificationCount() {
  const user = useAuthStore((s) => s.user);

  const { data } = useQuery({
    queryKey: ["collab", "reaction-notifications"],
    queryFn: () => api.get<{ data: unknown[] }>("/collab/reaction-notifications"),
    enabled: !!user,
    staleTime: 30_000,
  });

  return data?.data.length ?? 0;
}

/** 未対応の紹介依頼の件数（ホーム通知・なかまメニュー外部人脈タブのバッジ用） */
export function useIntroRequestCount() {
  const user = useAuthStore((s) => s.user);

  const { data } = useQuery({
    queryKey: ["collab", "contacts", "intro-requests"],
    queryFn: () => api.get<{ data: { status: "pending" | "handled" }[] }>("/collab/contacts/intro-requests"),
    enabled: !!user && user.userType === "member",
    staleTime: 30_000,
  });

  return data?.data.filter((r) => r.status === "pending").length ?? 0;
}
