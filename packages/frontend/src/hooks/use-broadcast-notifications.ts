// =============================================================
// 運営からのお知らせ（管理画面から配信される通知）の取得・既読化フック
// ホーム画面・通知画面・サイドバーのバッジで同じクエリを共有する
// =============================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/api";

export type BroadcastNotification = { id: string; title: string; body: string; readAt: number | null; createdAt: number };
type Response = { data: BroadcastNotification[]; unreadCount: number };

const QUERY_KEY = ["notifications", "broadcast"];

export function useBroadcastNotifications() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<Response>("/notifications"),
    enabled: !!user,
    staleTime: 30_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
  const markAllRead = useMutation({
    mutationFn: () => api.post("/notifications/read-all", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const all = data?.data ?? [];
  return {
    all,
    unread: all.filter((n) => n.readAt === null),
    unreadCount: data?.unreadCount ?? 0,
    markRead: (id: string) => markRead.mutate(id),
    markAllRead: () => markAllRead.mutate(),
  };
}
