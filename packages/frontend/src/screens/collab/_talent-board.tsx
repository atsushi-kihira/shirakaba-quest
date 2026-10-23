// =============================================================
// 協働マップ — 募集中の人材（各チームが公開した「こんな人がいるとよい」）
// 興味があれば「興味あり」を押すと、そのチームのリーダーに参加希望が届く。リーダーが承認すると、チームに加わる
// =============================================================
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

type Talent = { prospectId: string; teamId: string; teamName: string; teamType: "loose" | "power"; title: string; profile: string; reason: string; isMember: boolean; interested: boolean };

export function TalentBoard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["collab", "talent-board"], queryFn: () => api.get<{ data: Talent[] }>("/collab/workspace/talent-board") });
  const interest = useMutation({
    mutationFn: (t: Talent) => api.post(`/collab/workspace/team/${t.teamId}/prospects/${t.prospectId}/interest`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["collab", "talent-board"] }); qc.invalidateQueries({ queryKey: ["collab", "graph"] }); },
  });
  const list = data?.data ?? [];
  if (list.length === 0) return null;
  return (
    <div className="px-4 lg:px-0 mt-4">
      <h2 className="text-sm font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>🔍 募集中の人材</h2>
      <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>チームが「こんな人がいるとよい」と公開しているものです。心当たりがあれば「興味あり」を押してください。</p>
      <div className="flex flex-col gap-2">
        {list.map((t) => (
          <div key={t.prospectId} className="card-paper px-4 py-3">
            <p className="text-sm font-semibold" style={{ color: "var(--color-ink-900)" }}>{t.title}</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
              <Link to={`/collab/teams/${t.teamId}`} className="underline">{t.teamType === "power" ? "⚡" : "🌿"} {t.teamName}</Link>
            </p>
            {t.profile && <p className="text-xs mt-1" style={{ color: "var(--color-ink-700)" }}><b style={{ color: "var(--color-accent)" }}>人物像：</b>{t.profile}</p>}
            {t.reason && <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-700)" }}><b style={{ color: "var(--color-success)" }}>補えること：</b>{t.reason}</p>}
            <div className="mt-2">
              {t.isMember ? <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>このチームの参加中のメンバーです</span>
                : t.interested ? <span className="text-xs" style={{ color: "var(--color-success)" }}>✓ 参加希望を出しています</span>
                : <button onClick={() => interest.mutate(t)} disabled={interest.isPending} className="text-xs px-3 py-1.5 rounded-full font-medium text-white disabled:opacity-50" style={{ background: "var(--color-success)" }}>🙋 興味あり</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
