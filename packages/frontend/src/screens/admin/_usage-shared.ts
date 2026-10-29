// =============================================================
// 管理画面 — 利用状況の共通の型・定数・フック（管理ダッシュボードの概要・利用状況レポート・メンバー別の詳細で共通に使う）
//   ・集計期間（日・週・月・累計）の状態と、訪問回数・画面閲覧数・操作件数の取得
//   ・訪問回数: 最後の利用から30分あいたら別の訪問と数える／画面閲覧数: 見た画面の数／操作件数: データを作る・更新する操作の件数
// 全体のサマリーの表示は _usage-summary-cards.tsx
// =============================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTimezone } from "@/hooks/use-timezone";
import { shiftDate, todayIn, type PeriodChoice } from "./_period-switcher";

export type MemberUsage = {
  id: string;
  name: string;
  status: string;
  registeredAt: number;
  lastLoginAt: number | null;
  /** 訪問回数（最後の利用から30分あいたら、別の訪問） */
  visits: number;
  /** 画面閲覧数（情報参照＋協働画面） */
  views: number;
  /** 画面閲覧数のうち、協働画面以外（ホーム・ミーティング・通知など） */
  view: number;
  /** 画面閲覧数のうち、協働画面（協働マップ・チーム詳細など） */
  collabView: number;
  oneonone: number;
  contact: number;
  contactEight: number;
  egg: number;
  goose: number;
  meeting: number;
  quest: number;
  cardOrder: number;
  enishi: number;
  /** 操作件数（1to1・人脈登録など、何かを作った・実行した件数。ログイン・訪問・画面の閲覧は含めない） */
  actions: number;
};

export type UsageReport = {
  data: MemberUsage[];
  generatedAt: number;
  unit: PeriodChoice;
  rangeStart: string | null;
  rangeEnd: string | null;
  viewBreakdown: { screen: string; label: string; count: number }[];
};

export const STATUS_LABEL: Record<string, string> = {
  active: "承認済み",
  on_leave: "休会中",
  guest: "ゲスト",
  pending: "承認待ち",
  rejected: "利用却下",
};

/** 操作件数の内訳（機能ごと） */
export type FeatureKey = "oneonone" | "contact" | "egg" | "goose" | "meeting" | "quest" | "cardOrder" | "enishi";

export const FEATURES: { key: FeatureKey; label: string }[] = [
  { key: "oneonone", label: "1to1" },
  { key: "contact", label: "人脈登録" },
  { key: "egg", label: "金の卵" },
  { key: "goose", label: "金のガチョウ" },
  { key: "meeting", label: "ミーティング主催" },
  { key: "quest", label: "クエスト挑戦" },
  { key: "cardOrder", label: "カード発注" },
  { key: "enishi", label: "ご縁さがし" },
];

export function fmtDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("ja-JP", { year: "numeric", month: "numeric", day: "numeric" });
}

/** 集計期間（日・週・月・累計）と基準日の状態。切り替えると基準日は今日に戻る（最初の基準日は initialDate で指定できる） */
export function useUsagePeriod(initial: PeriodChoice, initialDate?: string) {
  const tz = useTimezone();
  const [unit, setUnit] = useState<PeriodChoice>(initial);
  const [date, setDate] = useState<string>(() => initialDate ?? todayIn(tz));
  return {
    unit, date, tz, today: todayIn(tz),
    changeUnit: (u: PeriodChoice) => { setUnit(u); setDate(todayIn(tz)); },
    shift: (rangeStart: string | null, dir: 1 | -1) => { if (unit !== "all") setDate(shiftDate(rangeStart ?? date, unit, dir)); },
    backToToday: () => setDate(todayIn(tz)),
  };
}

/** 全メンバーの利用件数（期間に応じて集計） */
export function useUsageReport(unit: PeriodChoice, date: string, tz: string) {
  return useQuery({
    queryKey: ["admin", "usage-report", unit, date, tz],
    queryFn: () => api.get<UsageReport>(`/admin/usage-report?unit=${unit}&date=${date}&tz=${encodeURIComponent(tz)}`),
    // 期間を切り替えている間も、前の表示を残して画面がちらつかないようにする
    placeholderData: (prev) => prev,
  });
}

export function periodNounOf(unit: PeriodChoice): string {
  return unit === "all" ? "累計" : unit === "day" ? "この日" : unit === "week" ? "この週" : "この月";
}
