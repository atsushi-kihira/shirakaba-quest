// =============================================================
// 管理画面 — アクセス数の棒グラフ（日＝1時間ごと／週＝曜日ごと／月＝日ごと。前後の期間に切り替えて見られる）
// 「アクセス」= メンバーがアプリを開いた回数（同じメンバーの5分以内の連続アクセスは1回）
// =============================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useTimezone } from "@/hooks/use-timezone";
import { fmtDateISO } from "@/lib/date";
import { PeriodSwitcher, shiftDate, todayIn, type PeriodChoice, type PeriodUnit } from "./_period-switcher";

type Unit = PeriodUnit;
type AccessBucket = { key: string; label: string; count: number; members: number };
type AccessSummary = {
  unit: Unit;
  rangeStart: string;
  rangeEnd: string;
  buckets: AccessBucket[];
  total: number;
  uniqueMembers: number;
  trackingStartedAt: number | null;
};

export function AccessChart() {
  const tz = useTimezone();
  const [unit, setUnit] = useState<Unit>("day");
  const [date, setDate] = useState<string>(() => todayIn(tz));

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "usage-report", "access", unit, date, tz],
    queryFn: () => api.get<{ data: AccessSummary }>(`/admin/usage-report/access?unit=${unit}&date=${date}&tz=${encodeURIComponent(tz)}`),
  });
  const summary = data?.data;
  const today = todayIn(tz);
  const max = Math.max(1, ...(summary?.buckets.map((b) => b.count) ?? [1]));
  const dense = unit === "month" || unit === "day";

  return (
    <div className="card-paper p-5">
      <h2 className="font-semibold text-base mb-3" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
        📈 アクセス数
      </h2>
      <div className="mb-3">
        <PeriodSwitcher
          units={["day", "week", "month"]}
          unit={unit}
          rangeStart={summary?.rangeStart ?? null}
          rangeEnd={summary?.rangeEnd ?? null}
          today={today}
          onUnitChange={(u: PeriodChoice) => { if (u !== "all") { setUnit(u); setDate(todayIn(tz)); } }}
          onShift={(dir) => setDate(shiftDate(summary?.rangeStart ?? date, unit, dir))}
          onToday={() => setDate(todayIn(tz))}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-52"><Loader2 size={22} className="animate-spin" style={{ color: "var(--color-ink-400)" }} /></div>
      ) : isError || !summary ? (
        <p className="text-sm text-center py-16" style={{ color: "var(--color-ink-500)" }}>アクセス数を取得できませんでした。時間をおいてもう一度お試しください。</p>
      ) : (
        <>
          <div className="flex gap-5 mb-3 text-xs" style={{ color: "var(--color-ink-500)" }}>
            <span>アクセス <b className="text-base" style={{ color: "var(--color-brand)" }}>{summary.total.toLocaleString()}</b> 回</span>
            <span>アクセスした人 <b className="text-base" style={{ color: "var(--color-ink-900)" }}>{summary.uniqueMembers}</b> 人</span>
          </div>

          <div className="overflow-x-auto">
            <div className="flex items-end gap-[3px] h-48 pt-5" style={{ minWidth: dense ? `${summary.buckets.length * 22}px` : undefined, borderBottom: "1px solid var(--color-paper-300)" }}>
              {summary.buckets.map((b) => (
                <div key={b.key} className="flex-1 h-full flex flex-col justify-end items-center min-w-0"
                  title={`${b.label}${unit === "day" ? "時台" : ""}：${b.count}回（${b.members}人）`}>
                  {b.count > 0 && <span className="text-[10px] mb-0.5 leading-none" style={{ color: "var(--color-ink-600)" }}>{b.count}</span>}
                  <div className="w-full rounded-t"
                    style={{ height: b.count > 0 ? `${Math.max(3, Math.round((b.count / max) * 100))}%` : "0", background: "var(--color-brand)", opacity: 0.85 }} />
                </div>
              ))}
            </div>
            <div className="flex gap-[3px] mt-1" style={{ minWidth: dense ? `${summary.buckets.length * 22}px` : undefined }}>
              {summary.buckets.map((b) => (
                <span key={b.key} className="flex-1 text-center text-[10px] min-w-0 truncate" style={{ color: "var(--color-ink-500)" }}>{b.label}</span>
              ))}
            </div>
          </div>

          <p className="text-xs mt-3" style={{ color: "var(--color-ink-400)" }}>
            {unit === "day" ? "横軸は時刻（0〜23時）" : unit === "week" ? "横軸は曜日（月曜始まり）" : "横軸は日"}。
            メンバーがアプリを開いた回数です（5分以内の連続アクセスは1回）。
            {summary.trackingStartedAt
              ? ` 記録は${fmtDateISO(summary.trackingStartedAt, tz)}から始まっています。`
              : " まだ記録がありません。これからアクセスがあると、ここに表示されます。"}
          </p>
        </>
      )}
    </div>
  );
}
