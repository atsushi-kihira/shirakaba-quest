// =============================================================
// 通常ミーティングの通知集計フック（ホームバッジ・ミーティング画面で共通利用）
// =============================================================
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/api";
import { getMeetingEffectiveStatus, isActionableStatus } from "@/lib/meeting-status";

export type MeetingListItem = {
  id: string;
  title: string;
  host: { id: string; name: string; emoji: string } | null;
  isHost: boolean;
  status: string;
  hasResponded: boolean;
  deadline?: number | null;
  registrationDeadline?: number | null;
  confirmedDate: { startsAt: number; endsAt: number | null } | null;
};
export type MeetingNotification = { id: string; meetingId: string; type: string; message: string | null; createdAt: number };
export type PendingAttendance = { id: string; title: string; confirmedStartsAt: number };
export type SeriesListItem = {
  id: string; title: string; status: "voting" | "confirmed" | "ended" | "cancelled";
  isHost: boolean; hasResponded: boolean;
  host: { id: string; name: string; emoji: string } | null;
};

export function useMeetingAlerts() {
  const user = useAuthStore((s) => s.user);

  const { data: meetingsData } = useQuery({
    queryKey: ["meetings"],
    queryFn: () => api.get<{ data: MeetingListItem[] }>("/meetings"),
    enabled: !!user,
    staleTime: 30_000,
  });
  const { data: notifsData } = useQuery({
    queryKey: ["meetings", "notifications"],
    queryFn: () => api.get<{ data: MeetingNotification[] }>("/meetings/notifications"),
    enabled: !!user,
    staleTime: 30_000,
  });
  const { data: attendanceData } = useQuery({
    queryKey: ["meetings", "pending-attendance"],
    queryFn: () => api.get<{ data: PendingAttendance[] }>("/meetings/pending-attendance"),
    enabled: !!user,
    staleTime: 60_000,
  });
  const { data: seriesData } = useQuery({
    queryKey: ["meeting-series"],
    queryFn: () => api.get<{ data: SeriesListItem[] }>("/meeting-series"),
    enabled: !!user,
    staleTime: 30_000,
  });

  const nowSec = Math.floor(Date.now() / 1000);
  const notifications = notifsData?.data ?? [];
  const unreadMeetingIds = new Set(notifications.map((n) => n.meetingId));
  const pendingAttendances = attendanceData?.data ?? [];

  // 「新着・回答をお願いします」「回答をお願いします」の実効ステータスのものだけを
  // バッジ・一覧の両方で同じ判定関数を使ってカウントする
  const pendingMeetings = (meetingsData?.data ?? []).filter((m) => {
    if (m.isHost) return false;
    if (m.registrationDeadline != null && m.registrationDeadline <= nowSec) return false;
    const status = getMeetingEffectiveStatus(m, unreadMeetingIds.has(m.id), nowSec);
    return isActionableStatus(status);
  });

  // 投票中で自分がまだ何も回答していない定例会
  const pendingSeries = (seriesData?.data ?? []).filter((s) => s.status === "voting" && !s.isHost && !s.hasResponded);

  return {
    pendingMeetings,
    pendingSeries,
    notifications,
    pendingAttendances,
    unreadMeetingIds,
    count: pendingMeetings.length + pendingSeries.length + notifications.length + pendingAttendances.length,
  };
}
