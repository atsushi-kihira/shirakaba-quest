// =============================================================
// 1to1の候補日時が、自分（ログイン中のメンバー）のGoogleカレンダーで空いているかを調べる
// 候補日時の前後の日付ぶんの予定を取得し、候補ごとに「空いている／予定あり／終日の予定あり」を判定する。
// =============================================================
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

type CalendarEvent = { id: string; summary: string; startUtc: string; endUtc: string; allDay: boolean };
type CalendarEventsResponse = { data: { connected: boolean; events: CalendarEvent[] } };

export type CandidateSlotLike = { id: string; startAt: number; endAt: number };
export type SlotAvailability = {
  status: "free" | "busy" | "allday";
  /** 重なっている予定（時間指定のもの） */
  conflicts: { summary: string; startUtc: string; endUtc: string }[];
  /** その日にある終日の予定 */
  allDayTitles: string[];
};

function jstDate(unixSeconds: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(unixSeconds * 1000));
}

export function useCandidateAvailability(slots: CandidateSlotLike[], enabled: boolean) {
  const from = slots.length > 0 ? jstDate(Math.min(...slots.map((s) => s.startAt))) : "";
  // 終了日の翌日0時をまたぐ予定も拾えるよう、終了側は1日余裕を持たせる
  const to = slots.length > 0 ? jstDate(Math.max(...slots.map((s) => s.endAt)) + 86400) : "";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["scheduler", "my-calendar-events", "candidates", from, to],
    queryFn: () => api.get<CalendarEventsResponse>(`/scheduler/me/calendar-events?from=${from}&to=${to}`),
    enabled: enabled && slots.length > 0,
    retry: false,
  });

  const connected = data?.data.connected;
  const byId = new Map<string, SlotAvailability>();
  if (data?.data.connected) {
    const events = data.data.events;
    for (const slot of slots) {
      const startMs = slot.startAt * 1000;
      const endMs = slot.endAt * 1000;
      const conflicts = events
        .filter((e) => !e.allDay && new Date(e.startUtc).getTime() < endMs && new Date(e.endUtc).getTime() > startMs)
        .map((e) => ({ summary: e.summary, startUtc: e.startUtc, endUtc: e.endUtc }));
      const day = jstDate(slot.startAt);
      const allDayTitles = events.filter((e) => e.allDay && e.startUtc.slice(0, 10) <= day && day < e.endUtc.slice(0, 10)).map((e) => e.summary);
      byId.set(slot.id, {
        status: conflicts.length > 0 ? "busy" : allDayTitles.length > 0 ? "allday" : "free",
        conflicts, allDayTitles,
      });
    }
  }
  return { isLoading: enabled && slots.length > 0 && isLoading, isError, connected, byId };
}
