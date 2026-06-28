// =============================================================
// 管理者ミーティング管理画面
// /admin/meetings
// =============================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, PauseCircle, Calendar, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";
import { fmtDateFull, fmtTime, fmtDateISO } from "@/lib/date";

type AdminMeeting = {
  id: string;
  title: string;
  description: string | null;
  status: "open" | "confirmed" | "cancelled";
  scope: string;
  host: { id: string; name: string; emoji: string } | null;
  candidateCount: number;
  confirmedDate: { startsAt: number; endsAt: number | null } | null;
  deadline: number | null;
  createdAt: number;
  updatedAt: number;
};

function formatDate(ts: number, endsAt: number | null | undefined, tz: string): string {
  const date = fmtDateFull(ts, tz);
  const t = fmtTime(ts, tz);
  if (endsAt) return `${date} ${t}〜${fmtTime(endsAt, tz)}`;
  return t === "00:00" ? date : `${date} ${t}`;
}

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  open:      { label: "募集中",   color: "var(--color-brand)",   bg: "rgba(181,56,75,0.1)" },
  confirmed: { label: "確定済み", color: "var(--color-success)", bg: "rgba(90,140,92,0.12)" },
  cancelled: { label: "キャンセル", color: "var(--color-ink-400)", bg: "var(--color-paper-300)" },
};
const SCOPE_LABEL: Record<string, string> = { all: "全メンバー", team: "チーム", selected: "指定メンバー" };

export function AdminMeetingsScreen() {
  const qc = useQueryClient();
  const { timezone: tz } = useSettings();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "meetings"],
    queryFn: () => api.get<{ data: AdminMeeting[] }>("/admin/meetings"),
  });

  const holdMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/meetings/${id}/hold`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "meetings"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/meetings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "meetings"] }),
  });

  const meetings = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          📅 ミーティング管理
        </h1>
        <span className="text-sm" style={{ color: "var(--color-ink-400)" }}>{meetings.length}件</span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 size={24} className="animate-spin" style={{ color: "var(--color-brand)" }} />
        </div>
      ) : meetings.length === 0 ? (
        <div className="text-center py-10" style={{ color: "var(--color-ink-400)" }}>
          ミーティングがありません
        </div>
      ) : (
        <div className="space-y-2">
          {meetings.map((m) => {
            const st = STATUS_LABEL[m.status] ?? STATUS_LABEL.open;
            const isExpanded = expandedId === m.id;
            return (
              <div key={m.id} className="card-paper rounded-2xl overflow-hidden">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : m.id)}
                  className="w-full px-4 py-3 flex items-start gap-3 text-left"
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: st.bg }}>
                    <Calendar size={16} style={{ color: st.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-900)" }}>
                      {m.title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                        style={{ background: st.bg, color: st.color }}>
                        {st.label}
                      </span>
                      <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>
                        {m.host?.emoji} {m.host?.name} · {SCOPE_LABEL[m.scope]}
                      </span>
                    </div>
                    {m.confirmedDate && (
                      <p className="text-xs mt-0.5 font-medium" style={{ color: "var(--color-success)" }}>
                        ✅ {formatDate(m.confirmedDate.startsAt, m.confirmedDate.endsAt, tz)}
                      </p>
                    )}
                  </div>
                  {isExpanded ? (
                    <ChevronUp size={16} style={{ color: "var(--color-ink-400)" }} />
                  ) : (
                    <ChevronDown size={16} style={{ color: "var(--color-ink-400)" }} />
                  )}
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3" style={{ borderTop: "1px solid var(--color-paper-300)" }}>
                    <div className="pt-3 space-y-1 text-sm" style={{ color: "var(--color-ink-600)" }}>
                      <p>候補日数：{m.candidateCount}件</p>
                      {m.deadline && <p>締切：{formatDate(m.deadline, null, tz)}</p>}
                      <p>作成：{fmtDateISO(m.createdAt, tz)}</p>
                      {m.description && (
                        <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--color-ink-700)" }}>
                          {m.description}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-2">
                      {m.status !== "cancelled" && (
                        <button
                          onClick={() => {
                            if (window.confirm(`「${m.title}」をキャンセル（保留）にしますか？`)) {
                              holdMutation.mutate(m.id);
                            }
                          }}
                          disabled={holdMutation.isPending}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition disabled:opacity-50"
                          style={{ background: "rgba(212,160,59,0.12)", color: "#D4A03B" }}
                        >
                          {holdMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <PauseCircle size={12} />}
                          保留にする
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (window.confirm(`「${m.title}」を完全に削除しますか？\nこの操作は元に戻せません。`)) {
                            deleteMutation.mutate(m.id);
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition disabled:opacity-50"
                        style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}
                      >
                        {deleteMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        削除する
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
