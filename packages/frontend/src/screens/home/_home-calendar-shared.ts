// ホームのカレンダー（月表示・週表示）で共通して使うもの
import type { CalendarEvent, CalendarEventKind } from "@shared/types";

export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

/** 予定の種類ごとのアイコンと名前 */
export const KIND_INFO: Record<CalendarEventKind, { icon: string; label: string }> = {
  oneonone: { icon: "🤝", label: "1to1" },
  meeting: { icon: "📅", label: "ミーティング" },
  series: { icon: "🔁", label: "定例会" },
};

/** 週表示の枠の色（種類ごと） */
export const KIND_COLOR: Record<CalendarEventKind, string> = {
  oneonone: "var(--color-success)",
  meeting: "var(--color-brand)",
  series: "var(--color-accent-dk)",
};

export function isMuted(ev: CalendarEvent): boolean {
  return ev.myStatus === "absent" || ev.myStatus === "declined";
}

/** 重ねて表示する、自分のGoogleカレンダーの予定 */
export type GoogleEvent = {
  id: string;
  title: string;
  allDay: boolean;
  /** 時間のある予定：開始・終了（unix秒） */
  startsAt: number;
  endsAt: number;
  /** 終日の予定：開始日・終了日（"YYYY-MM-DD"。終了日は含まない） */
  startDate: string | null;
  endDate: string | null;
};
