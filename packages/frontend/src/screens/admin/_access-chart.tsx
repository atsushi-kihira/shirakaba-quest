// =============================================================
// 管理画面 — アクセス数の棒グラフ（日＝1時間ごと／週＝曜日ごと／月＝日ごと。前後の期間に切り替えて見られる）
// 「アクセス」= メンバーがアプリを開いた回数（同じメンバーの5分以内の連続アクセスは1回）
// =============================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useTimezone } from "@/hooks/use-timezone";
import { fmtDateISO } from "@/lib/date";

type Unit = "day" | "week" | "month";
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

const UNITS: { key: Unit; label: string; prev: string; next: string; current: string }[] = [
  { key: "day", label: "日", prev: "前日", next: "翌日", current: "今日" },
  { key: "week", label: "週", prev: "前週", next: "翌週", current: "今週" },
  { key: "month", label: "月", prev: "前月", next: "翌月", current: "今月" },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const ymdToMs = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const msToYmd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** 基準日を、日・週・月の単位で前後にずらす */
function shiftDate(ymd: string, unit: Unit, dir: 1 | -1): string {
  const ms = ymdToMs(ymd);
  if (unit === "day") return msToYmd(ms + dir * DAY_MS);
  if (unit === "week") return msToYmd(ms + dir * 7 * DAY_MS);
  const d = new Date(ms);
  return msToYmd(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1));
}

function rangeTitle(s: AccessSummary): string {
  const [sy, sm, sd] = s.rangeStart.split("-").map(Number);
  const [ey, em, ed] = s.rangeEnd.split("-").map(Number);
  if (s.unit === "day") return `${sy}年${sm}月${sd}日`;
  if (s.unit === "month") return `${sy}年${sm}月`;
  return `${sy}年${sm}月${sd}日 〜 ${ey !== sy ? `${ey}年` : ""}${em}月${ed}日`;
}

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
  const labels = UNITS.find((u) => u.key === unit)!;
  // 今の期間より先（まだ来ていない期間）には進めない
  const atCurrent = !!summary && summary.rangeEnd >= today;
  const max = Math.max(1, ...(summary?.buckets.map((b) => b.count) ?? [1]));
  const dense = unit === "month" || unit === "day";

  return (
    <div className="card-paper p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="font-semibold text-base" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
          📈 アクセス数
        </h2>
        <div className="flex gap-1.5">
          {UNITS.map((u) => (
            <button key={u.key}
              onClick={() => { setUnit(u.key); setDate(todayIn(tz)); }}
              className="px-3.5 py-1.5 rounded-full text-xs font-medium transition"
              style={{
                background: unit === u.key ? "var(--color-brand)" : "var(--color-paper-200)",
                color: unit === u.key ? "white" : "var(--color-ink-600)",
              }}>
              {u.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 mb-3">
        <button onClick={() => setDate(shiftDate(summary?.rangeStart ?? date, unit, -1))}
          className="flex items-center gap-0.5 px-2.5 py-1.5 rounded-xl text-xs font-medium"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
          <ChevronLeft size={14} />{labels.prev}
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold" style={{ color: "var(--color-ink-900)" }}>{summary ? rangeTitle(summary) : "　"}</p>
          {!atCurrent && (
            <button onClick={() => setDate(todayIn(tz))} className="text-xs underline" style={{ color: "var(--color-brand)" }}>
              {labels.current}に戻る
            </button>
          )}
        </div>
        <button onClick={() => setDate(shiftDate(summary?.rangeStart ?? date, unit, 1))}
          disabled={atCurrent}
          className="flex items-center gap-0.5 px-2.5 py-1.5 rounded-xl text-xs font-medium disabled:opacity-35"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
          {labels.next}<ChevronRight size={14} />
        </button>
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
