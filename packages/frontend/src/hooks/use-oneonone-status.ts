// =============================================================
// 1to1の状態集計フック（ホームバッジ・ミーティング画面で共通利用）
// =============================================================
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/api";

export type OneOnOneSession = {
  id: string;
  status: "pending" | "accepted" | "completed" | "rejected" | "cancelled";
  requestedAt: number;
  scheduledFor: number | null;
  scheduledForEndUtc: number | null;
  completedAt: number | null;
  requesterCompletedAt: number | null;
  responderCompletedAt: number | null;
  myRole: "requester" | "responder";
  partner: { id: string; name: string; emoji: string; bgColor: string } | null;
  requesterSchedulerUrl?: string | null;
  conferenceType?: string | null;
  conferenceUrl?: string | null;
  autoTransitionReason?: "pending_timeout" | "date_passed" | null;
};

export function useOneOnOneSessions() {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: ["oneonone"],
    queryFn: () => api.get<{ data: OneOnOneSession[] }>("/oneonone"),
    enabled: !!user,
    refetchInterval: 30_000,
    staleTime: 10_000,
    // 外部の予約ページで日程確定してから戻ってきた直後でも必ず最新状態を取得する
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}

/** 今すぐ自分が対応すべき1to1（申込の承諾待ち／相手完了済みで自分だけ未完了） */
export function filterActionableOneOnOne(sessions: OneOnOneSession[]): OneOnOneSession[] {
  return sessions.filter((s) => {
    if (s.status === "pending" && s.myRole === "responder") return true;
    if (s.status === "accepted") {
      const myDone      = s.myRole === "requester" ? s.requesterCompletedAt : s.responderCompletedAt;
      const partnerDone = s.myRole === "requester" ? s.responderCompletedAt : s.requesterCompletedAt;
      return !myDone && !!partnerDone;
    }
    return false;
  });
}

/** 進行中の1to1（申込中・承諾済み。完了／却下／キャンセル済みは含まない） */
export function filterInFlightOneOnOne(sessions: OneOnOneSession[]): OneOnOneSession[] {
  return sessions.filter((s) => s.status === "pending" || s.status === "accepted");
}

/**
 * バッジ件数用の進行中1to1（自分がやることがないものは数えない）
 * 承諾済みで既に自分の完了記録を済ませ、相手の完了待ちのだけの状態は、
 * 自分が対応すべき案件ではないため件数から除外する（一覧表示自体は従来通り行う）
 */
export function filterInFlightOneOnOneForBadge(sessions: OneOnOneSession[]): OneOnOneSession[] {
  return sessions.filter((s) => {
    if (s.status === "pending") return s.myRole === "responder";
    if (s.status === "accepted") {
      const myDone = s.myRole === "requester" ? s.requesterCompletedAt : s.responderCompletedAt;
      return !myDone;
    }
    return false;
  });
}
