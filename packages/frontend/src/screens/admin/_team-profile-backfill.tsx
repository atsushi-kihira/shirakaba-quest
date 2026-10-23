// =============================================================
// 管理画面 — 既存チームの「仮のプロフィール・役割」の作成状況
// チーム育成の機能ができる前からあるチームには、公開後に最初に誰かがアプリを開いたときに、AIが仮のプロフィールとメンバーの役割を自動で作る。
// ここでは、作成状況の確認と、「いますぐ作る」（失敗したものの再試行を含む）ができる。作った内容は、リーダーのホームに「確認しましょう」と表示される
// =============================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

type Summary = { teams: number; withProfile: number; provisional: number; missing: number; generating: number; failed: number };

export function TeamProfileBackfillPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin", "collab", "team-profiles", "summary"],
    queryFn: () => api.get<{ data: Summary }>("/admin/collab/team-profiles/summary"),
    refetchInterval: (q) => { const s = q.state.data?.data; return s && (s.generating > 0 || s.missing > 0) ? 8000 : false; },
  });
  const start = useMutation({
    mutationFn: () => api.post("/admin/collab/team-profiles/backfill", {}),
    onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ["admin", "collab", "team-profiles", "summary"] }), 1500),
  });
  const s = data?.data;
  if (!s || s.teams === 0) return null;
  const pending = s.missing + s.generating + s.failed;
  return (
    <div className="card-paper p-4 mt-6">
      <h2 className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink-700)" }}>📝 チームの仮プロフィール（AIが自動作成）</h2>
      <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>
        既存のチームには、AIが仮のプロフィールとメンバーの役割を作ります。作られた内容は、リーダーのホームに「確認しましょう」と表示されます（リーダーが確認するまで表示が続きます）。
      </p>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs mb-3" style={{ color: "var(--color-ink-700)" }}>
        <span>チーム <b>{s.teams}</b></span>
        <span>仮の内容（確認待ち） <b>{s.provisional}</b></span>
        <span>作成待ち <b>{s.missing}</b></span>
        <span>生成中 <b>{s.generating}</b></span>
        <span style={{ color: s.failed > 0 ? "var(--color-brand)" : undefined }}>失敗 <b>{s.failed}</b></span>
      </div>
      <button onClick={() => start.mutate()} disabled={start.isPending || pending === 0} className="text-xs px-4 py-2 rounded-full font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
        {pending === 0 ? "すべて作成済みです" : start.isPending ? "開始しています…" : "いますぐ作る（失敗したものも再試行）"}
      </button>
      {start.isSuccess && <p className="text-xs mt-2" style={{ color: "var(--color-success)" }}>作成を始めました。数分かかることがあります。</p>}
    </div>
  );
}
