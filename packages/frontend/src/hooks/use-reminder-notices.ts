// =============================================================
// 予定のリマインド（ホーム画面・通知画面で共通）の取得・既読化フック
// ホームの「もうすぐの予定」でも、通知画面でも、どちらから確認しても、同じ既読になる
// =============================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore, isApprovedMember } from "@/stores/auth-store";
import { api } from "@/lib/api";

export type ReminderNotice = { id: string; kind: string; title: string; body: string; linkPath: string | null; startsAt: number; createdAt: number };
export type ReminderHistoryItem = ReminderNotice & { readAt: number | null };

const NOTICES_KEY = ["reminders", "notices"];

export function useReminderNotices() {
  const user = useAuthStore((s) => s.user);
  const enabled = isApprovedMember(user);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: NOTICES_KEY,
    queryFn: () => api.get<{ data: ReminderNotice[] }>("/reminders/notices"),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/reminders/notices/${id}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reminders"] }),
  });
  return { notices: data?.data ?? [], markRead: (id: string) => markRead.mutate(id) };
}

/** 通知画面の履歴（確認済み・予定が始まったもの） */
export function useReminderHistory() {
  const user = useAuthStore((s) => s.user);
  const { data, isLoading } = useQuery({
    queryKey: ["reminders", "history"],
    queryFn: () => api.get<{ data: ReminderHistoryItem[] }>("/reminders/notices/history"),
    enabled: isApprovedMember(user),
    staleTime: 30_000,
  });
  return { history: data?.data ?? [], isLoading };
}
