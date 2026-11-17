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

/**
 * 自分が参加する予定か（1to1・自分が主催の会・○と答えた／出席予定で「参加」にした会）。
 * △は「たぶん参加」、無回答は日程が確定しているだけの「参考」の表示（欠席・辞退は、薄く表示する）
 */
export function isParticipating(ev: CalendarEvent): boolean {
  return ev.kind === "oneonone" || ev.isHost || ev.myStatus === "attending";
}

/** △（たぶん参加）と答えた予定（自分が主催の会は、含まない） */
export function isMaybe(ev: CalendarEvent): boolean {
  return !isParticipating(ev) && ev.myStatus === "maybe";
}

/** 無回答で、日程が確定しているだけの予定（△・欠席・辞退は、含まない） */
export function isReference(ev: CalendarEvent): boolean {
  return !isParticipating(ev) && ev.myStatus === "none";
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
