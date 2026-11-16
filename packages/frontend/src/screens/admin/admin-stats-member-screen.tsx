// =============================================================
// 管理画面 — 統計レポート：メンバー1人のページ
// これまでに取り込んだすべての月の数字、項目ごとの推移グラフ、数字から読み取れるアドバイス
// =============================================================
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { MemberAvatar } from "@/components/member-avatar";
import {
  MTLR_CATEGORY_LABEL, MTLR_CATEGORY_ORDER, MTLR_COLUMNS, MTLR_HEADERS, computeMtlr, mtlrYmLabel, summarizeChapter, totalColor,
  type AdviceItem, type MtlrCategoryKey, type MtlrColor,
} from "@shared/mtlr";
import { ChartCard, TrendChart } from "./_stats-charts";
import {
  COLOR_CLASS, MTLR_QUERY_KEY, cellColor, fmtJpDate, personHistory, rankInReport, useMemberAdvice, useMtlrData, ymShort,
} from "./_stats-shared";

const COLOR_WORD: Record<MtlrColor, string> = { green: "緑", yellow: "黄", red: "赤", gray: "グレー" };
const CAT_COLOR = (k: MtlrCategoryKey) => `var(--mtlr-cat-${k})`;

const ADVICE_SECTIONS: { kind: AdviceItem["kind"]; title: string }[] = [
  { kind: "good", title: "👍 いいところ" },
  { kind: "next", title: "🎯 次の一歩" },
  { kind: "watch", title: "👀 気をつけたいところ" },
  { kind: "info", title: "📝 見方のメモ" },
];

function lastTwo(values: number[]): { current: number; delta: number | null } {
  const current = values[values.length - 1];
  return { current, delta: values.length >= 2 ? Math.round((current - values[values.length - 2]) * 10) / 10 : null };
}

export function AdminStatsMemberScreen() {
  const { personKey: encoded = "" } = useParams();
  const personKey = decodeURIComponent(encoded);
  const { data, isLoading, isError } = useMtlrData();
  const reports = data?.reports;
  const advice = useMemberAdvice(reports ?? [], personKey);
  const hist = useMemo(() => personHistory(reports ?? [], personKey), [reports, personKey]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-24"><Loader2 size={24} className="animate-spin" style={{ color: "var(--color-ink-400)" }} /></div>;
  }
  if (isError || !data || !reports) {
    return <p className="text-sm text-center py-24" style={{ color: "var(--color-ink-500)" }}>読み込めませんでした。時間をおいて、もう一度お試しください。</p>;
  }
  if (hist.length === 0) {
    return (
      <div className="px-4 py-10 lg:px-0 text-center">
        <p className="text-sm mb-4" style={{ color: "var(--color-ink-600)" }}>このメンバーの記録は見つかりませんでした。</p>
        <Link to="/admin/stats" className="text-sm underline" style={{ color: "var(--color-brand)" }}>統計レポートへ戻る</Link>
      </div>
    );
  }

  const last = hist[hist.length - 1];
  const name = last.row.displayName;
  const linkedMember = data.members.find((m) => m.id === last.row.memberId) ?? null;
  const b = computeMtlr(last.row.raw);
  const rank = rankInReport(last.report, personKey);
  const labels = hist.map((h) => ymShort(h.report.ym));
  const raws = hist.map((h) => h.row.raw);
  const breakdowns = raws.map(computeMtlr);
  const chapterAvg = hist.map((h) => Math.round(summarizeChapter(h.report.rows.map((r) => r.raw)).averageScore * 10) / 10);
  const man = (k: number) => Math.round(k) / 10; // 千円 → 万円
  const fmtMan = (n: number) => (n >= 100 ? Math.round(n).toLocaleString() : String(Math.round(n * 10) / 10));

  const score = lastTwo(raws.map((r) => r.score));
  const tyfcb = lastTwo(raws.map((r) => man(r.tyfcb)));
  const given = lastTwo(raws.map((r) => r.refInGiven + r.refOutGiven));
  const received = lastTwo(raws.map((r) => r.refInReceived + r.refOutReceived));
  const visitors = lastTwo(raws.map((r) => r.visitors));
  const oneToOne = lastTwo(raws.map((r) => r.oneToOne));
  const attendance = lastTwo(breakdowns.map((x) => x.attendanceRate));
  const ceu = lastTwo(raws.map((r) => r.ceu));

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-24 space-y-5">
      <Link to={`/admin/stats?ym=${last.report.ym}`} className="inline-flex items-center gap-1 text-sm hover:underline" style={{ color: "var(--color-ink-600)" }}>
        <ArrowLeft size={15} />統計レポートへ戻る
      </Link>

      {/* ヘッダー */}
      <div className="card-paper p-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        {linkedMember && <MemberAvatar memberId={linkedMember.id} emoji={linkedMember.emoji} bgColor={linkedMember.bgColor} size="lg" />}
        <div className="min-w-[11rem] flex-1">
          <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>{name}</h1>
          <p className="text-xs mt-1" style={{ color: "var(--color-ink-500)" }}>
            {hist.length}か月分の記録（{mtlrYmLabel(hist[0].report.ym)}〜{mtlrYmLabel(last.report.ym)}）
            {linkedMember ? `\u3000／\u3000アプリのメンバー：${linkedMember.name}` : "\u3000／\u3000アプリのメンバーとは、まだ結びついていません"}
          </p>
          <MemberLinkEditor personKey={personKey} currentMemberId={last.row.memberId} data={data} />
        </div>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className={`rounded-2xl px-5 py-2 text-3xl font-bold tabular-nums ${COLOR_CLASS[totalColor(last.row.raw.score)]}`} style={{ color: "var(--color-ink-900)" }}>
              {last.row.raw.score}
            </div>
            <div className="text-xs mt-1" style={{ color: "var(--color-ink-500)" }}>{mtlrYmLabel(last.report.ym)}末のスコア</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold" style={{ color: "var(--color-ink-900)" }}>{rank}<span className="text-sm font-medium">位</span></div>
            <div className="text-xs mt-1" style={{ color: "var(--color-ink-500)" }}>{last.report.rows.length}人中</div>
          </div>
        </div>
      </div>

      {/* アドバイス */}
      {advice && (
        <div className="card-paper p-5">
          <h2 className="font-semibold text-base mb-2" style={{ color: "var(--color-ink-800)" }}>💡 このデータから読み取れること</h2>
          <p className="text-sm mb-4" style={{ color: "var(--color-ink-800)" }}>{advice.summary}</p>
          <div className="space-y-4">
            {ADVICE_SECTIONS.map((sec) => {
              const items = advice.items.filter((i) => i.kind === sec.kind);
              if (items.length === 0) return null;
              return (
                <section key={sec.kind}>
                  <h3 className="text-sm font-semibold mb-1.5" style={{ color: "var(--color-ink-700)" }}>{sec.title}</h3>
                  <ul className="space-y-2">
                    {items.map((it) => (
                      <li key={it.title} className="rounded-xl px-3 py-2.5 text-sm" style={{ background: "var(--color-paper-100)" }}>
                        <div className="font-medium" style={{ color: "var(--color-ink-900)" }}>{it.icon} {it.title}</div>
                        <div className="mt-0.5" style={{ color: "var(--color-ink-700)" }}>{it.body}</div>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
          <p className="text-xs mt-4" style={{ color: "var(--color-ink-500)" }}>
            アドバイスは、レポートの数字から決まったルールで作っています。数字に表れない事情（病気・出張・入会したばかりなど）は反映されていません。
          </p>
        </div>
      )}

      {/* 項目ごとの点数 */}
      <div className="card-paper p-5">
        <h2 className="font-semibold text-base mb-3" style={{ color: "var(--color-ink-800)" }}>🧮 {mtlrYmLabel(last.report.ym)}末の、項目ごとの点数</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {MTLR_CATEGORY_ORDER.map((k) => {
            const c = b.categories[k];
            return (
              <div key={k} className={`rounded-xl p-3 text-center ${COLOR_CLASS[c.color]}`} title={`${MTLR_CATEGORY_LABEL[k]}（${COLOR_WORD[c.color]}）`}>
                <div className="text-xs" style={{ color: "var(--color-ink-700)" }}>{MTLR_CATEGORY_LABEL[k]}</div>
                <div className="text-xl font-bold tabular-nums" style={{ color: "var(--color-ink-900)" }}>{c.points}<span className="text-xs font-medium"> / {c.max}</span></div>
              </div>
            );
          })}
        </div>
      </div>

      {/* グラフ */}
      <div>
        <h2 className="font-semibold text-base mb-1" style={{ color: "var(--color-ink-800)" }}>📈 月ごとの推移</h2>
        <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
          数字は、毎月ずらしながらの「直近6か月」の合計です。破線は、点数が上がる目安（その月までの定例会の回数にあわせた線）です。
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="スコアの推移" hint="背景の色は 緑（70〜）・黄（50〜）・赤（30〜）・グレー。破線はチャプターの平均" current={`${score.current}点`} delta={score.delta} deltaUnit="点">
            <TrendChart labels={labels} kind="line" yMin={0} yMax={100}
              bands={[{ from: 70, to: 100, color: "var(--mtlr-green)" }, { from: 50, to: 70, color: "var(--mtlr-yellow)" }, { from: 30, to: 50, color: "var(--mtlr-red)" }, { from: 0, to: 30, color: "var(--mtlr-gray)" }]}
              series={[
                { name: name, color: "var(--color-brand)", values: raws.map((r) => r.score) },
                { name: "チャプター平均", color: "var(--color-ink-600)", dashed: true, values: chapterAvg },
              ]} />
          </ChartCard>

          <ChartCard title="点数の内訳" hint="項目ごとに、何点取れているか（合計＝スコア）" current={`${b.total}点`}>
            <TrendChart labels={labels} kind="stack"
              series={MTLR_CATEGORY_ORDER.map((k) => ({ name: MTLR_CATEGORY_LABEL[k], color: CAT_COLOR(k), values: breakdowns.map((x) => x.categories[k].points) }))} />
          </ChartCard>

          <ChartCard title="サンキュー金額（TYFCB）の推移" hint="直近6か月のサンキュー金額（万円）。緑の目安は285万円〜" current={`${fmtMan(tyfcb.current)}万円`} delta={tyfcb.delta} deltaUnit="万円">
            <TrendChart labels={labels} kind="bar" series={[{ name: "サンキュー金額（万円）", color: CAT_COLOR("tyfcb"), values: raws.map((r) => man(r.tyfcb)) }]} fmt={fmtMan} />
          </ChartCard>

          <ChartCard title="リファーラルを渡した数（内／外）" hint="チャプター内（内与）とチャプター外（外与）。破線は週1.25件ペース（25点）" current={`${given.current}件`} delta={given.delta} deltaUnit="件">
            <TrendChart labels={labels} kind="stack"
              series={[
                { name: "内与（チャプター内へ）", color: "var(--mtlr-cat-attendance)", values: raws.map((r) => r.refInGiven) },
                { name: "外与（チャプター外へ）", color: CAT_COLOR("referrals"), values: raws.map((r) => r.refOutGiven) },
              ]}
              overlays={[{ name: "週1.25件ペース（25点）", color: "var(--color-ink-600)", values: breakdowns.map((x) => x.meetings * 1.25) }]} />
          </ChartCard>

          <ChartCard title="リファーラルをもらった数（内／外）" hint="チャプター内（内受）とチャプター外（外受）から、もらった件数" current={`${received.current}件`} delta={received.delta} deltaUnit="件">
            <TrendChart labels={labels} kind="stack"
              series={[
                { name: "内受（チャプター内から）", color: "var(--mtlr-cat-attendance)", values: raws.map((r) => r.refInReceived) },
                { name: "外受（チャプター外から）", color: CAT_COLOR("ceu"), values: raws.map((r) => r.refOutReceived) },
              ]} />
          </ChartCard>

          <ChartCard title="ビジターの数" hint="直近6か月に招待した人数。破線は5名（満点25点）" current={`${visitors.current}名`} delta={visitors.delta} deltaUnit="名">
            <TrendChart labels={labels} kind="bar" series={[{ name: "ビジター", color: CAT_COLOR("visitors"), values: raws.map((r) => r.visitors) }]}
              overlays={[{ name: "5名（25点）", color: "var(--color-ink-600)", values: raws.map(() => 5) }]} />
          </ChartCard>

          <ChartCard title="1to1の回数" hint="破線は、週1回のペース（20点）" current={`${oneToOne.current}回`} delta={oneToOne.delta} deltaUnit="回">
            <TrendChart labels={labels} kind="bar" series={[{ name: "1to1", color: CAT_COLOR("oneToOne"), values: raws.map((r) => r.oneToOne) }]}
              overlays={[{ name: "週1回のペース（20点）", color: "var(--color-ink-600)", values: breakdowns.map((x) => x.meetings) }]} />
          </ChartCard>

          <ChartCard title="出席率" hint="破線は 96%（緑・10点）と 88%（黄・5点）" current={`${attendance.current}%`} delta={attendance.delta} deltaUnit="%">
            <TrendChart labels={labels} kind="line" yMin={50} yMax={100}
              series={[{ name: "出席率（%）", color: CAT_COLOR("attendance"), values: breakdowns.map((x) => x.attendanceRate) }]}
              overlays={[
                { name: "96%（緑）", color: "var(--mtlr-green-strong)", values: raws.map(() => 96) },
                { name: "88%（黄）", color: "var(--mtlr-yellow-strong)", values: raws.map(() => 88) },
              ]} fmt={(n) => `${n}`} />
          </ChartCard>

          <ChartCard title="CEU（学びの単位）" hint="破線は、週0.5を超えるペース（10点）" current={`${ceu.current}`} delta={ceu.delta}>
            <TrendChart labels={labels} kind="bar" series={[{ name: "CEU", color: CAT_COLOR("ceu"), values: raws.map((r) => r.ceu) }]}
              overlays={[{ name: "週0.5のペース（10点）", color: "var(--color-ink-600)", values: breakdowns.map((x) => x.meetings * 0.5) }]} />
          </ChartCard>

          <ChartCard title="推薦・後援" hint="後援（スポンサー）は1名以上で5点。推薦は点数には入りません" current={`後援 ${raws[raws.length - 1].sponsor}名`}>
            <TrendChart labels={labels} kind="line"
              series={[
                { name: "後援（スポンサー）", color: CAT_COLOR("sponsors"), values: raws.map((r) => r.sponsor) },
                { name: "推薦", color: "var(--color-ink-500)", dashed: true, values: raws.map((r) => r.recommend) },
              ]} />
          </ChartCard>
        </div>
      </div>

      {/* 月ごとの数字（表） */}
      <div className="card-paper overflow-hidden">
        <div className="px-4 py-3 font-semibold text-sm" style={{ color: "var(--color-ink-800)", borderBottom: "1px solid var(--color-paper-300)" }}>📋 これまでの数字（新しい月が上）</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse" style={{ minWidth: 880 }}>
            <thead>
              <tr>
                <th className="sticky left-0 z-10 px-3 py-2 text-left font-semibold text-white whitespace-nowrap" style={{ background: "var(--color-brand)" }}>月</th>
                {MTLR_COLUMNS.map((c) => <th key={c} className="px-1.5 py-2 text-center font-semibold text-white whitespace-nowrap" style={{ background: "var(--color-brand)" }}>{MTLR_HEADERS[c]}</th>)}
              </tr>
            </thead>
            <tbody>
              {[...hist].reverse().map(({ report, row }) => (
                <tr key={report.ym} style={{ borderBottom: "1px solid var(--color-paper-300)" }}>
                  <td className="sticky left-0 z-10 px-3 py-1.5 whitespace-nowrap" style={{ background: "var(--color-paper-50)" }} title={`${fmtJpDate(report.periodFrom)} 〜 ${fmtJpDate(report.periodTo)}`}>
                    <Link to={`/admin/stats?ym=${report.ym}`} className="font-medium hover:underline" style={{ color: "var(--color-ink-900)" }}>{mtlrYmLabel(report.ym)}</Link>
                  </td>
                  {MTLR_COLUMNS.map((c) => {
                    const color = cellColor(c, row.raw);
                    const v = row.raw[c];
                    return (
                      <td key={c} className={`px-1.5 py-1.5 text-center tabular-nums ${color ? COLOR_CLASS[color] : ""}`}
                        style={{ color: c === "absent" && v > 0 ? "var(--color-brand)" : "var(--color-ink-900)", fontWeight: c === "score" ? 700 : 400, borderLeft: "1px solid var(--color-paper-300)" }}>
                        {c === "tyfcb" ? v.toLocaleString() : v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** このメンバーの名前と、アプリのメンバーを結びつける（小さな選択欄） */
function MemberLinkEditor({ personKey, currentMemberId, data }: {
  personKey: string;
  currentMemberId: string | null;
  data: NonNullable<ReturnType<typeof useMtlrData>["data"]>;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const members = useMemo(() => [...data.members].sort((a, b) => a.name.localeCompare(b.name, "ja")), [data.members]);
  const save = useMutation({
    mutationFn: (value: string) => api.put("/admin/mtlr/links", { personKey, memberId: value === "" ? null : value }),
    onSuccess: () => { setError(null); setOpen(false); void qc.invalidateQueries({ queryKey: MTLR_QUERY_KEY }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "保存できませんでした。もう一度お試しください。"),
  });
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="text-xs mt-1 underline" style={{ color: "var(--color-ink-600)" }}>メンバーとのひも付けを変更</button>;
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select defaultValue={currentMemberId ?? "__pick"} disabled={save.isPending} onChange={(e) => save.mutate(e.target.value)}
        className="rounded-xl px-3 py-1.5 text-sm" style={{ border: "1px solid var(--color-paper-300)", background: "var(--color-paper-50)", color: "var(--color-ink-900)" }}>
        {!currentMemberId && <option value="__pick" disabled>選んでください</option>}
        <option value="">メンバーではない</option>
        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <button type="button" onClick={() => setOpen(false)} className="text-xs" style={{ color: "var(--color-ink-500)" }}>閉じる</button>
      {error && <span className="text-xs" style={{ color: "var(--color-brand-dk)" }}>{error}</span>}
    </div>
  );
}
