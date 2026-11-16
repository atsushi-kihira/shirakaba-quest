// =============================================================
// 管理画面「統計レポート」— 取り込み済みデータの取得と、画面共通の計算
// =============================================================
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import {
  MTLR_CATEGORY_ORDER, buildMemberAdvice, computeMtlr, summarizeChapter, totalColor,
  type ChapterContext, type MtlrColor, type MtlrHistoryPoint, type MtlrRaw,
} from "@shared/mtlr";

export type MtlrRowData = {
  personKey: string;
  displayName: string;
  rawName: string;
  memberId: string | null;
  raw: MtlrRaw;
};

export type MtlrReportData = {
  id: string;
  ym: string;
  periodFrom: string;
  periodTo: string;
  createdOn: string;
  standard: string;
  sourceFilename: string;
  importedAt: number;
  rows: MtlrRowData[];
};

export type MtlrMemberLite = { id: string; name: string; emoji: string; bgColor: string; status: string };

/** 管理者が手でひも付けた結果（memberId が null のものは「メンバーではない」） */
export type MtlrLink = { personKey: string; memberId: string | null };

export type MtlrAll = { reports: MtlrReportData[]; members: MtlrMemberLite[]; links: MtlrLink[] };

export const MTLR_QUERY_KEY = ["admin", "mtlr", "all"] as const;

export function useMtlrData() {
  return useQuery({
    queryKey: MTLR_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: MtlrAll }>("/admin/mtlr/all")).data,
    staleTime: 30_000,
  });
}

/** 信号の色 → 表のセルの色のクラス */
export const COLOR_CLASS: Record<MtlrColor, string> = {
  green: "mtlr-green", yellow: "mtlr-yellow", red: "mtlr-red", gray: "mtlr-gray",
};

/** 信号の色 → グラフ・バッジ用の濃い色 */
export const COLOR_STRONG: Record<MtlrColor, string> = {
  green: "var(--mtlr-green-strong)", yellow: "var(--mtlr-yellow-strong)", red: "var(--mtlr-red-strong)", gray: "var(--mtlr-gray-strong)",
};

/** 表の列ごとの、セルの色（色を付けない列は null）。レポートの表と同じ色の付き方 */
export function cellColor(column: keyof MtlrRaw, raw: MtlrRaw): MtlrColor | null {
  const b = computeMtlr(raw);
  switch (column) {
    case "attended": return b.categories.attendance.color;
    case "refInGiven":
    case "refOutGiven": return b.categories.referrals.color;
    case "visitors": return b.categories.visitors.color;
    case "oneToOne": return b.categories.oneToOne.color;
    case "tyfcb": return b.categories.tyfcb.color;
    case "ceu": return b.categories.ceu.color;
    case "sponsor": return b.categories.sponsors.color;
    case "score": return totalColor(raw.score);
    default: return null;
  }
}

/** "2026-10" → "26/10"（グラフの横軸用） */
export function ymShort(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y.slice(2)}/${Number(m)}`;
}

/** 1人の、月ごとの記録（古い順） */
export function personHistory(reports: MtlrReportData[], personKey: string): { report: MtlrReportData; row: MtlrRowData }[] {
  const list: { report: MtlrReportData; row: MtlrRowData }[] = [];
  for (const report of reports) {
    const row = report.rows.find((r) => r.personKey === personKey);
    if (row) list.push({ report, row });
  }
  return list;
}

/** その月の、スコアの高い順の順位（同点は同じ順位） */
export function rankInReport(report: MtlrReportData, personKey: string): number {
  const me = report.rows.find((r) => r.personKey === personKey);
  if (!me) return 0;
  return report.rows.filter((r) => r.raw.score > me.raw.score).length + 1;
}

export function chapterContext(report: MtlrReportData, personKey: string): ChapterContext {
  const s = summarizeChapter(report.rows.map((r) => r.raw));
  return { rank: rankInReport(report, personKey), count: s.count, averageScore: s.averageScore, maxMeetings: s.maxMeetings };
}

/** メンバー1人ぶんのアドバイス */
export function useMemberAdvice(reports: MtlrReportData[], personKey: string) {
  return useMemo(() => {
    const hist = personHistory(reports, personKey);
    if (hist.length === 0) return null;
    const points: MtlrHistoryPoint[] = hist.map((h) => ({ ym: h.report.ym, raw: h.row.raw }));
    const last = hist[hist.length - 1];
    return buildMemberAdvice(points, chapterContext(last.report, personKey));
  }, [reports, personKey]);
}

export { MTLR_CATEGORY_ORDER };

export function fmtImportedAt(sec: number): string {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** "2026-05-01" → "2026年5月1日" */
export function fmtJpDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

/** 「統計レポート」タイプの管理者か（レポートの削除・名前のひも付けの変更はできない） */
export function useIsStatsAdmin(): boolean {
  return useAuthStore((s) => s.user?.adminRole === "stats");
}
