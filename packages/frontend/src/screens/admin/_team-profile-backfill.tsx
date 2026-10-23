// =============================================================
// 管理画面 — チームのプロフィールの状況（どのチームが、いまどの状態か）と、その内容
// チーム育成の機能ができる前からあるチームには、公開後に最初に誰かがアプリを開いたときに、AIが仮のプロフィールとメンバーの役割を自動で作る。
// ・状況ごとの件数を押すと、そのチームだけを一覧できる。チームを押すと、リーダーが見るのと同じ内容（確認待ちの仮の内容も）を見られる
// ・「いますぐ作る」で、作成待ち・失敗・途中で止まったものの作成を始める。作った内容は、リーダーのホームに「確認しましょう」と表示される
// =============================================================
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDateTimeFull } from "@/lib/date";
import { useSettings } from "@/hooks/use-settings";

type Status = "confirmed" | "provisional" | "missing" | "generating" | "failed" | "incomplete";
type TeamRow = {
  id: string; name: string; type: "loose" | "power"; archived: boolean; status: Status;
  leader: { id: string; name: string; gone: boolean };
  profile: { businessTitle: string; summary: string; targetCustomers: string; goal: string; firstSteps: string[]; updatedAt: number; confirmedAt: number | null } | null;
  generatedAt: number | null;
  members: { id: string; name: string; emoji: string; status: "active" | "pending"; isLeader: boolean; role: string | null }[];
  candidateCount: number;
  talents: { title: string; published: boolean; filled: boolean; role: string | null }[];
};
type Response = { data: { teams: TeamRow[]; counts: Record<Status, number> } };

const STATUS_META: Record<Status, { label: string; color: string; bg: string; hint: string }> = {
  provisional: { label: "仮の内容（確認待ち）", color: "#8a6414", bg: "rgba(212,160,59,0.18)", hint: "AIが仮に作りました。リーダーが確認するまで、チーム外のメンバーには見えません" },
  missing:     { label: "作成待ち", color: "var(--color-ink-600)", bg: "var(--color-paper-200)", hint: "まだ作っていません（誰かがアプリを開くと、自動で始まります）" },
  generating:  { label: "生成中", color: "#3b6ea5", bg: "rgba(59,110,165,0.12)", hint: "AIが作っている途中です。10分以上たっても変わらないときは、「いますぐ作る」を押してください" },
  failed:      { label: "失敗", color: "var(--color-brand)", bg: "rgba(181,56,75,0.1)", hint: "AIの生成に失敗しました。「いますぐ作る」で、もう一度作れます" },
  incomplete:  { label: "未入力", color: "var(--color-ink-600)", bg: "var(--color-paper-200)", hint: "プロフィールの入力が済んでいません（リーダーが入力します）" },
  confirmed:   { label: "確認済み", color: "var(--color-success)", bg: "rgba(90,140,92,0.14)", hint: "リーダーが確認・入力した、チーム外にも公開されている内容です" },
};
const ORDER: Status[] = ["provisional", "missing", "generating", "failed", "incomplete", "confirmed"];

function Pill({ status }: { status: Status }) {
  const m = STATUS_META[status];
  return <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: m.bg, color: m.color }}>{m.label}</span>;
}

export function TeamProfileBackfillPanel() {
  const qc = useQueryClient();
  const { timezone: tz } = useSettings();
  const [filter, setFilter] = useState<Status | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["admin", "collab", "team-profiles"],
    queryFn: () => api.get<Response>("/admin/collab/team-profiles"),
    refetchInterval: (q) => { const c = q.state.data?.data.counts; return c && (c.generating > 0 || c.missing > 0) ? 8000 : false; },
  });
  const start = useMutation({
    mutationFn: () => api.post("/admin/collab/team-profiles/backfill", {}),
    onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ["admin", "collab", "team-profiles"] }), 1500),
  });
  const teams = data?.data.teams ?? [];
  const counts = data?.data.counts;
  if (!counts || teams.length === 0) return null;
  const pending = counts.missing + counts.generating + counts.failed;
  const shown = (filter === "all" ? teams : teams.filter((t) => t.status === filter))
    .slice().sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.name.localeCompare(b.name, "ja"));

  return (
    <div className="card-paper p-4 mt-6">
      <h2 className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink-700)" }}>📝 チームのプロフィールの状況</h2>
      <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
        既存のチームには、AIが仮のプロフィールとメンバーの役割を作ります。作られた内容は、リーダーのホームに「確認しましょう」と表示されます（リーダーが確認するまで続きます）。
        件数を押すと、そのチームだけを一覧できます。チームを押すと、リーダーが見るのと同じ内容を確認できます。
      </p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        <button onClick={() => setFilter("all")} className="text-xs px-3 py-1.5 rounded-full font-medium"
          style={{ background: filter === "all" ? "var(--color-brand)" : "var(--color-paper-200)", color: filter === "all" ? "#fff" : "var(--color-ink-600)" }}>
          すべて <b>{teams.length}</b>
        </button>
        {ORDER.map((s) => (
          <button key={s} onClick={() => setFilter(filter === s ? "all" : s)} disabled={counts[s] === 0 && filter !== s}
            className="text-xs px-3 py-1.5 rounded-full font-medium disabled:opacity-45"
            style={{ background: filter === s ? STATUS_META[s].color : STATUS_META[s].bg, color: filter === s ? "#fff" : STATUS_META[s].color }}>
            {STATUS_META[s].label} <b>{counts[s]}</b>
          </button>
        ))}
      </div>

      <div className="space-y-1.5 mb-3">
        {shown.map((t) => {
          const open = openId === t.id;
          return (
            <div key={t.id} className="rounded-xl" style={{ background: "var(--color-paper-100)", border: "1px solid var(--color-paper-300)" }}>
              <button onClick={() => setOpenId(open ? null : t.id)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left">
                {open ? <ChevronDown size={14} style={{ color: "var(--color-ink-400)" }} /> : <ChevronRight size={14} style={{ color: "var(--color-ink-400)" }} />}
                <span className="flex-1 min-w-0">
                  <span className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>{t.type === "power" ? "⚡" : "🌿"} {t.name}</span>
                  {t.archived && <span className="text-[10px] ml-1.5" style={{ color: "var(--color-ink-400)" }}>⏸休止中</span>}
                  <span className="block text-[11px]" style={{ color: "var(--color-ink-500)" }}>リーダー：{t.leader.name}{t.leader.gone && "（退会済み）"}</span>
                </span>
                <Pill status={t.status} />
              </button>

              {open && (
                <div className="px-3 pb-3 pt-1 space-y-2.5" style={{ borderTop: "1px solid var(--color-paper-300)" }}>
                  <p className="text-[11px]" style={{ color: "var(--color-ink-500)" }}>
                    {STATUS_META[t.status].hint}
                    {t.generatedAt && t.status === "provisional" && `（AIが作成：${fmtDateTimeFull(t.generatedAt, tz)}）`}
                  </p>

                  {t.profile ? (
                    <div className="rounded-xl p-3" style={{ background: "rgba(90,140,92,0.08)" }}>
                      <p className="text-[10px] font-bold mb-0.5" style={{ color: "var(--color-success)" }}>協働事業のイメージ{t.status === "provisional" && "（仮）"}</p>
                      <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink-900)" }}>{t.profile.businessTitle || "（タイトル未入力）"}</p>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink-700)" }}>{t.profile.summary || "（概要は未入力です）"}</p>
                      <p className="text-xs leading-relaxed mt-2" style={{ color: "var(--color-ink-700)" }}>
                        <b style={{ color: "var(--color-success)" }}>🎯 お客様・対象：</b>{t.profile.targetCustomers || "（未入力です）"}
                      </p>
                      {t.profile.goal && <p className="text-xs leading-relaxed mt-2" style={{ color: "var(--color-ink-700)" }}><b>💭 考えたいこと：</b>{t.profile.goal}</p>}
                      {t.profile.firstSteps.length > 0 && (
                        <div className="mt-2">
                          <p className="text-[10px] font-bold mb-0.5" style={{ color: "var(--color-ink-500)" }}>最初の一歩</p>
                          <ol className="list-decimal pl-5 space-y-0.5 text-xs" style={{ color: "var(--color-ink-700)" }}>
                            {t.profile.firstSteps.map((s, i) => <li key={i}>{s}</li>)}
                          </ol>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>まだ、プロフィールの内容はありません。</p>
                  )}

                  <div>
                    <p className="text-[10px] font-bold mb-1" style={{ color: "var(--color-accent)" }}>メンバーの役割{t.status === "provisional" && "（仮）"}</p>
                    <ul className="space-y-1">
                      {t.members.map((m) => (
                        <li key={m.id} className="flex items-start gap-2 text-xs" style={{ color: "var(--color-ink-700)" }}>
                          <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-800)" }}>
                            <span>{m.emoji}</span>{m.name}{m.isLeader && "（リーダー）"}{m.status === "pending" && "（招待中）"}
                          </span>
                          <span className="pt-0.5" style={{ color: m.role ? undefined : "var(--color-ink-400)" }}>{m.role ?? "役割は未入力です"}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {(t.candidateCount > 0 || t.talents.length > 0) && (
                    <p className="text-[11px]" style={{ color: "var(--color-ink-500)" }}>
                      候補 {t.candidateCount}名
                      {t.talents.length > 0 && `／募集人材：${t.talents.map((x) => `${x.title}${x.filled ? "（充足）" : x.published ? "（公開中）" : ""}`).join("、")}`}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {shown.length === 0 && <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>該当するチームはありません。</p>}
      </div>

      <button onClick={() => start.mutate()} disabled={start.isPending || pending === 0} className="text-xs px-4 py-2 rounded-full font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
        {pending === 0 ? "作成待ち・失敗のものはありません" : start.isPending ? "開始しています…" : `いますぐ作る（作成待ち・生成中・失敗の${pending}チーム）`}
      </button>
      {start.isSuccess && <p className="text-xs mt-2" style={{ color: "var(--color-success)" }}>作成を始めました。数分かかることがあります。</p>}
    </div>
  );
}
