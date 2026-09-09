// =============================================================
// 管理者向け 協働ダッシュボード
// 一般メンバー向けの協働マップと同じ情報（マップ・チーム構成・活動タイムライン・
// シェアストーリー）を、組織全体を俯瞰する形（自分中心ではない）で表示する。
// チーム作成では管理者自身が作成者になることはなく、指定したメンバーを
// リーダー（＝内部的な作成者）として登録する。投稿・ストーリーの新規作成は行わず、
// 不適切な投稿・ストーリーの削除のみ行える。
// =============================================================
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Handshake, Plus, Home as HomeIcon, Search, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";

type GraphNode = { id: string; name: string; emoji: string; bgColor: string; hasActivity: boolean };
type Stage = "one" | "seed" | "loose";
type Stalled = "active" | "stalled" | "intervene";
type GraphEdge = { memberAId: string; memberBId: string; stage: Stage; stalled: Stalled; oneOnOneCount: number; lastActivityAt: number | null };
type TeamMember = {
  id: string; name: string; emoji: string; bgColor: string;
  status: "active" | "pending" | "declined"; invitedBy: string | null;
};
type GraphTeam = { id: string; name: string; type: "loose" | "power"; createdBy: string; archived: boolean; members: TeamMember[] };
type GraphResponse = { data: { nodes: GraphNode[]; edges: GraphEdge[]; teams: GraphTeam[] } };

const TEAM_TYPE_META: Record<GraphTeam["type"], { color: string; icon: string; label: string }> = {
  loose: { color: "var(--color-success)", icon: "🌿", label: "緩いチーム" },
  power: { color: "var(--color-accent)", icon: "⚡", label: "パワーチーム" },
};
const STAGE_META: Record<Stage, { label: string; color: string; dash?: string; width: number }> = {
  one: { label: "1to1のみ", color: "var(--color-ink-300)", dash: "4 3", width: 1.5 },
  seed: { label: "協働の芽", color: "var(--color-accent)", dash: "4 3", width: 2 },
  loose: { label: "緩いチーム", color: "var(--color-success)", width: 3 },
};
const STALLED_META: Record<Stalled, { label: string; color: string } | null> = {
  active: null,
  stalled: { label: "停滞ぎみ", color: "var(--color-accent)" },
  intervene: { label: "停滞中", color: "var(--color-brand)" },
};

function useAdminCollabGraph() {
  return useQuery({
    queryKey: ["admin", "collab", "graph"],
    queryFn: () => api.get<GraphResponse>("/admin/collab/graph"),
  });
}

export function AdminCollabScreen() {
  const { data, isLoading } = useAdminCollabGraph();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createTeamMode, setCreateTeamMode] = useState<"loose" | "power" | null>(null);

  const graph = data?.data;
  const selectedNode = graph?.nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2" style={{ color: "var(--color-ink-900)" }}>
          <Handshake size={24} style={{ color: "var(--color-brand)" }} />
          協働ダッシュボード
        </h1>
      </div>
      <p className="text-sm mb-4" style={{ color: "var(--color-ink-500)" }}>
        チャプター全体の協働マップを俯瞰し、管理者としてチームを編成したり、活動タイムライン・シェアストーリーの不適切な投稿を削除したりできます。
      </p>

      {isLoading ? (
        <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>読み込み中...</div>
      ) : graph ? (
        <>
          <AdminGraphCanvas graph={graph} selectedId={selectedId} onSelect={setSelectedId} />

          {selectedNode && (
            <AdminNodeDetailPanel node={selectedNode} graph={graph} onClose={() => setSelectedId(null)} />
          )}

          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold" style={{ color: "var(--color-ink-700)" }}>🦄 協働チーム</h2>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setCreateTeamMode("loose")}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium text-white"
                  style={{ background: "var(--color-success)" }}
                >
                  <Plus size={12} /> 緩いチームを作る
                </button>
                <button
                  onClick={() => setCreateTeamMode("power")}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium text-white"
                  style={{ background: "var(--color-accent)" }}
                >
                  ⚡ パワーチームを作る
                </button>
              </div>
            </div>
            <AdminCollabTeamsList teams={graph.teams} allMembers={graph.nodes} />
          </div>

          <div className="mt-8 pt-6" style={{ borderTop: "1px solid var(--color-paper-300)" }}>
            <AdminActivityAndRecords teams={graph.teams} />
          </div>

          {createTeamMode && (
            <AdminCreateTeamModal
              mode={createTeamMode}
              members={graph.nodes}
              onClose={() => setCreateTeamMode(null)}
            />
          )}
        </>
      ) : (
        <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>データを取得できませんでした</div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// マップ（組織全体を俯瞰する円状レイアウト。個人中心のティア分けは行わない）
// ----------------------------------------------------------------
function AdminGraphCanvas({
  graph,
  selectedId,
  onSelect,
}: {
  graph: GraphResponse["data"];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const positionById = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    const count = Math.max(graph.nodes.length, 1);
    const r = 190;
    graph.nodes.forEach((n, i) => {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      map.set(n.id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    });
    return map;
  }, [graph.nodes]);

  const renderEdges = useMemo(() => {
    return graph.edges
      .map((e) => {
        const pa = positionById.get(e.memberAId);
        const pb = positionById.get(e.memberBId);
        if (!pa || !pb) return null;
        return { ...e, pa, pb };
      })
      .filter((e): e is GraphEdge & { pa: { x: number; y: number }; pb: { x: number; y: number } } => !!e);
  }, [graph.edges, positionById]);

  const teamBlobs = useMemo(() => {
    return graph.teams.filter((team) => team.type === "power").map((team) => {
      const pts = team.members.map((m) => positionById.get(m.id)).filter((p): p is { x: number; y: number } => !!p);
      if (pts.length === 0) return null;
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      const spread = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)), 0);
      const r = Math.max(spread + 40, 48);
      return { team, cx, cy, r };
    }).filter((b): b is { team: GraphTeam; cx: number; cy: number; r: number } => !!b);
  }, [graph.teams, positionById]);

  const pendingByMemberId = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const team of graph.teams) {
      for (const m of team.members) if (m.status === "pending") map.set(m.id, true);
    }
    return map;
  }, [graph.teams]);

  function onPointerDown(e: React.PointerEvent) {
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: offset.x, origY: offset.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setOffset({ x: dragState.current.origX + dx, y: dragState.current.origY + dy });
  }
  function onPointerUp() {
    dragState.current = null;
  }
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    setScale((s) => Math.min(2.5, Math.max(0.4, s - e.deltaY * 0.001)));
  }

  return (
    <div className="relative rounded-3xl overflow-hidden card-paper"
      style={{ height: 460, touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onWheel={onWheel}
    >
      <svg viewBox="-260 -260 520 520" className="w-full h-full" style={{ cursor: "grab" }}>
        <defs>
          <filter id="admin-collab-blob-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
        </defs>
        <g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}>
          {teamBlobs.map(({ team, cx, cy, r }) => (
            <circle key={`blob-${team.id}`} cx={cx} cy={cy} r={r}
              fill={TEAM_TYPE_META[team.type].color} opacity={0.16} filter="url(#admin-collab-blob-blur)" />
          ))}
          {teamBlobs.map(({ team, cx, cy, r }) => (
            <text key={`blob-label-${team.id}`} x={cx} textAnchor="middle" y={cy - r - 6}
              fontSize="11" fontWeight={700} fill={TEAM_TYPE_META[team.type].color}
              stroke="var(--color-paper-50)" strokeWidth={3} paintOrder="stroke">
              {TEAM_TYPE_META[team.type].icon} {team.name}
            </text>
          ))}

          {renderEdges.map((e) => {
            const meta = STAGE_META[e.stage];
            return (
              <line key={`edge-${e.memberAId}-${e.memberBId}`}
                x1={e.pa.x} y1={e.pa.y} x2={e.pb.x} y2={e.pb.y}
                stroke={meta.color}
                strokeWidth={Math.min(meta.width + e.oneOnOneCount * 0.4, 6)}
                strokeDasharray={meta.dash} />
            );
          })}

          {graph.nodes.map((node) => {
            const p = positionById.get(node.id);
            if (!p) return null;
            const isSelected = selectedId === node.id;
            return (
              <g key={node.id} transform={`translate(${p.x} ${p.y})`} onClick={() => onSelect(node.id)} style={{ cursor: "pointer" }}>
                <circle r={isSelected ? 20 : 17} fill="var(--color-paper-50)"
                  stroke={isSelected ? "var(--color-brand)" : "var(--color-ink-300)"}
                  strokeWidth={isSelected ? 3 : 2} />
                <text textAnchor="middle" dy="6" fontSize="16">{node.emoji}</text>
                <text textAnchor="middle" y={32} fontSize="10" fontWeight={600}
                  stroke="var(--color-paper-50)" strokeWidth={3} paintOrder="stroke" fill="var(--color-ink-700)">
                  {node.name}
                </text>
                {pendingByMemberId.has(node.id) && (
                  <text x={13} y={-9} textAnchor="middle" fontSize="12">⏳</text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute top-3 left-3 right-3 flex items-start justify-between pointer-events-none">
        <p className="text-xs font-semibold px-2 py-1 rounded-full" style={{ background: "rgba(250,245,232,0.85)", color: "var(--color-ink-700)" }}>
          チャプター全体の協働マップ
        </p>
        <p className="text-xs px-2 py-1 rounded-full" style={{ background: "rgba(250,245,232,0.85)", color: "var(--color-ink-500)" }}>
          丸＝メンバー／線＝関係の強さ
        </p>
      </div>

      <div className="absolute bottom-3 left-3 rounded-2xl px-3 py-2 flex flex-col gap-1"
        style={{ background: "rgba(250,245,232,0.9)", boxShadow: "0 1px 4px rgba(0,0,0,0.1)" }}>
        {(Object.keys(STAGE_META) as Stage[]).map((s) => (
          <div key={s} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-ink-600)" }}>
            <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4"
              stroke={STAGE_META[s].color} strokeWidth={STAGE_META[s].width} strokeDasharray={STAGE_META[s].dash} /></svg>
            {STAGE_META[s].label}
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-ink-600)" }}>
          <span className="w-3 h-3 rounded-full inline-block" style={{ background: TEAM_TYPE_META.power.color, opacity: 0.5 }} />
          パワーチーム
        </div>
      </div>

      <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
        <button onClick={() => setScale((s) => Math.min(2.5, s + 0.2))}
          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
          style={{ background: "var(--color-paper-50)", color: "var(--color-ink-600)", boxShadow: "0 1px 4px rgba(0,0,0,0.15)" }}>+</button>
        <button onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: "var(--color-paper-50)", color: "var(--color-ink-600)", boxShadow: "0 1px 4px rgba(0,0,0,0.15)" }}>
          <HomeIcon size={14} />
        </button>
        <button onClick={() => setScale((s) => Math.max(0.4, s - 0.2))}
          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
          style={{ background: "var(--color-paper-50)", color: "var(--color-ink-600)", boxShadow: "0 1px 4px rgba(0,0,0,0.15)" }}>−</button>
      </div>
    </div>
  );
}

function AdminNodeDetailPanel({ node, graph, onClose }: { node: GraphNode; graph: GraphResponse["data"]; onClose: () => void }) {
  const nodeMap = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const relatedEdges = graph.edges
    .filter((e) => e.memberAId === node.id || e.memberBId === node.id)
    .map((e) => {
      const partnerId = e.memberAId === node.id ? e.memberBId : e.memberAId;
      return { ...e, partner: nodeMap.get(partnerId) };
    })
    .filter((e) => !!e.partner);
  const teams = graph.teams.filter((t) => t.members.some((m) => m.id === node.id));

  return (
    <div className="card-paper p-4 mt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-8 h-8 rounded-full flex items-center justify-center text-lg shrink-0 ${node.bgColor}`}>{node.emoji}</span>
          <span className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>{node.name}</span>
        </div>
        <button onClick={onClose}><X size={16} style={{ color: "var(--color-ink-400)" }} /></button>
      </div>

      {teams.length > 0 && (
        <div className="mb-2">
          <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-500)" }}>所属チーム</p>
          <div className="flex flex-wrap gap-1.5">
            {teams.map((t) => (
              <span key={t.id} className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                {TEAM_TYPE_META[t.type].icon} {t.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {relatedEdges.length > 0 ? (
        <div>
          <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-500)" }}>なかまとの関係</p>
          <div className="flex flex-col gap-1">
            {relatedEdges.map((e) => (
              <div key={e.partner!.id} className="flex items-center justify-between text-xs">
                <span style={{ color: "var(--color-ink-700)" }}>{e.partner!.emoji} {e.partner!.name}</span>
                <span className="flex items-center gap-1">
                  <span style={{ color: STAGE_META[e.stage].color }}>{STAGE_META[e.stage].label}</span>
                  {STALLED_META[e.stalled] && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px]" style={{ background: "var(--color-paper-200)", color: STALLED_META[e.stalled]!.color }}>
                      {STALLED_META[e.stalled]!.label}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>まだ記録された関係はありません</p>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// チーム一覧（管理者はどのチームでも解散できる。脱退・承諾操作はない）
// ----------------------------------------------------------------
function AdminCollabTeamsList({ teams, allMembers }: { teams: GraphTeam[]; allMembers: GraphNode[] }) {
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [invitingTeamId, setInvitingTeamId] = useState<string | null>(null);
  const [transferringTeamId, setTransferringTeamId] = useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "collab", "graph"] });

  const disband = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/collab/teams/${id}`),
    onSuccess: () => { invalidate(); setExpandedId(null); },
  });
  const removeMember = useMutation({
    mutationFn: ({ teamId, memberId }: { teamId: string; memberId: string }) => api.post(`/admin/collab/teams/${teamId}/members/${memberId}/remove`, {}),
    onSuccess: invalidate,
  });
  const approveMember = useMutation({
    mutationFn: ({ teamId, memberId }: { teamId: string; memberId: string }) => api.post(`/admin/collab/teams/${teamId}/members`, { memberIds: [memberId] }),
    onSuccess: invalidate,
  });
  const promote = useMutation({
    mutationFn: (id: string) => api.post(`/admin/collab/teams/${id}/promote`, {}),
    onSuccess: invalidate,
  });
  const pause = useMutation({
    mutationFn: (id: string) => api.post(`/admin/collab/teams/${id}/pause`, {}),
    onSuccess: invalidate,
  });
  const resume = useMutation({
    mutationFn: (id: string) => api.post(`/admin/collab/teams/${id}/resume`, {}),
    onSuccess: invalidate,
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.patch(`/admin/collab/teams/${id}`, { name }),
    onSuccess: () => { invalidate(); setRenamingId(null); },
  });

  if (teams.length === 0) {
    return <p className="text-sm" style={{ color: "var(--color-ink-400)" }}>まだ協働チームがありません</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {teams.map((t) => {
        const isExpanded = expandedId === t.id;
        const existingMemberIds = new Set(t.members.map((m) => m.id));
        return (
          <div key={t.id} className="card-paper px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                {renamingId === t.id ? (
                  <div className="flex items-center gap-1.5">
                    <input value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)}
                      className="text-sm px-2 py-1 rounded-lg border" style={{ borderColor: "var(--color-paper-300)" }} />
                    <button onClick={() => renameDraft.trim() && rename.mutate({ id: t.id, name: renameDraft.trim() })}
                      className="text-xs px-2 py-1 rounded-full text-white" style={{ background: "var(--color-brand)" }}>保存</button>
                    <button onClick={() => setRenamingId(null)}
                      className="text-xs px-2 py-1 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>取消</button>
                  </div>
                ) : (
                  <>
                    <span className="font-medium text-sm" style={{ color: "var(--color-ink-800)" }}>
                      {TEAM_TYPE_META[t.type].icon} {t.name}
                    </span>
                    <span className="ml-2 text-xs" style={{ color: "var(--color-ink-400)" }}>{TEAM_TYPE_META[t.type].label}</span>
                    {t.archived && (
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full" style={{ background: "var(--color-paper-300)", color: "var(--color-ink-500)" }}>
                        ⏸休止中
                      </span>
                    )}
                  </>
                )}
              </div>
              <button onClick={() => setExpandedId(isExpanded ? null : t.id)}
                className="text-xs px-2 py-1 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
                {isExpanded ? "閉じる" : "管理"}
              </button>
            </div>

            {isExpanded && (
              <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--color-paper-300)" }}>
                <div className="flex flex-col gap-1.5 mb-3">
                  {t.members.map((m) => (
                    <div key={m.id} className="flex items-center justify-between text-xs gap-2">
                      <span style={{ color: "var(--color-ink-700)" }}>
                        {m.emoji} {m.name}
                        {m.id === t.createdBy && "（リーダー）"}
                        {m.status === "pending" && "（承諾待ち）"}
                      </span>
                      <div className="flex gap-1 shrink-0">
                        {m.status === "pending" && (
                          <button onClick={() => approveMember.mutate({ teamId: t.id, memberId: m.id })}
                            className="text-xs px-2 py-0.5 rounded-full text-white" style={{ background: "var(--color-success)" }}>
                            承認
                          </button>
                        )}
                        {m.id !== t.createdBy && (
                          <button onClick={() => { if (confirm(`${m.name}さんをチームから除名しますか？`)) removeMember.mutate({ teamId: t.id, memberId: m.id }); }}
                            className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-brand)" }}>
                            除名
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setInvitingTeamId(t.id)}
                    className="text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                    ＋メンバーを追加
                  </button>
                  {t.type === "loose" && (
                    <button onClick={() => { if (confirm(`「${t.name}」をパワーチームに昇格しますか？`)) promote.mutate(t.id); }}
                      className="text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-accent)" }}>
                      ⚡パワーチームに昇格
                    </button>
                  )}
                  {t.archived ? (
                    <button onClick={() => resume.mutate(t.id)}
                      className="text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-success)" }}>
                      ▶活動を再開する
                    </button>
                  ) : (
                    <button onClick={() => { if (confirm(`「${t.name}」の活動を休止しますか？（解散はしません。いつでも再開できます）`)) pause.mutate(t.id); }}
                      className="text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                      ⏸活動を休止する
                    </button>
                  )}
                  <button onClick={() => { setRenamingId(t.id); setRenameDraft(t.name); }}
                    className="text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                    チーム名を変更
                  </button>
                  {t.members.filter((m) => m.status === "active" && m.id !== t.createdBy).length > 0 && (
                    <button onClick={() => setTransferringTeamId(t.id)}
                      className="text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                      リーダーを変更
                    </button>
                  )}
                  <button onClick={() => { if (confirm(`「${t.name}」を解散しますか？この操作は取り消せません。`)) disband.mutate(t.id); }}
                    className="text-xs px-3 py-1.5 rounded-full font-medium text-white" style={{ background: "var(--color-brand)" }}>
                    チームを解散する
                  </button>
                </div>
              </div>
            )}

            {invitingTeamId === t.id && (
              <AdminInviteMembersModal
                teamId={t.id}
                candidateMembers={allMembers.filter((m) => !existingMemberIds.has(m.id))}
                onClose={() => setInvitingTeamId(null)}
              />
            )}
            {transferringTeamId === t.id && (
              <AdminTransferLeaderModal
                teamId={t.id}
                candidates={t.members.filter((m) => m.status === "active" && m.id !== t.createdBy)}
                onClose={() => setTransferringTeamId(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function AdminInviteMembersModal({ teamId, candidateMembers, onClose }: {
  teamId: string; candidateMembers: GraphNode[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");

  const add = useMutation({
    mutationFn: () => api.post<{ data: { added: number } }>(`/admin/collab/teams/${teamId}/members`, { memberIds: selected }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "collab", "graph"] }); onClose(); },
    onError: (e: Error) => setError(e.message || "追加に失敗しました"),
  });

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--color-ink-900)" }}>メンバーを追加する</h2>
        {candidateMembers.length === 0 ? (
          <p className="text-sm mb-4" style={{ color: "var(--color-ink-400)" }}>追加できるメンバーがいません</p>
        ) : (
          <div className="max-h-64 overflow-y-auto space-y-1 rounded-xl p-2 mb-4" style={{ background: "var(--color-paper-200)" }}>
            {candidateMembers.map((m) => (
              <label key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:opacity-80">
                <input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} />
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 ${m.bgColor}`}>{m.emoji}</span>
                <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>{m.name}</span>
              </label>
            ))}
          </div>
        )}
        {error && <p className="text-xs mb-3" style={{ color: "var(--color-brand)" }}>{error}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl text-sm"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button onClick={() => { setError(""); if (selected.length === 0) { setError("追加するメンバーを選んでください"); return; } add.mutate(); }}
            disabled={add.isPending || candidateMembers.length === 0}
            className="flex-1 py-2.5 rounded-2xl text-sm text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
            追加する
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminTransferLeaderModal({ teamId, candidates, onClose }: {
  teamId: string; candidates: TeamMember[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const transfer = useMutation({
    mutationFn: () => api.post(`/admin/collab/teams/${teamId}/transfer-leader`, { newLeaderId: selectedId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "collab", "graph"] }); onClose(); },
    onError: (e: Error) => setError(e.message || "変更に失敗しました"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--color-ink-900)" }}>リーダーを変更する</h2>
        <div className="max-h-64 overflow-y-auto space-y-1 rounded-xl p-2 mb-4" style={{ background: "var(--color-paper-200)" }}>
          {candidates.map((m) => (
            <label key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:opacity-80">
              <input type="radio" name="admin-new-leader" checked={selectedId === m.id} onChange={() => setSelectedId(m.id)} />
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 ${m.bgColor}`}>{m.emoji}</span>
              <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>{m.name}</span>
            </label>
          ))}
        </div>
        {error && <p className="text-xs mb-3" style={{ color: "var(--color-brand)" }}>{error}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl text-sm"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button onClick={() => { setError(""); if (!selectedId) { setError("変更先を選んでください"); return; } transfer.mutate(); }}
            disabled={transfer.isPending}
            className="flex-1 py-2.5 rounded-2xl text-sm text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
            変更する
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// チーム作成モーダル（管理者は作成者にならず、リーダーを指定する）
// ----------------------------------------------------------------
function AdminCreateTeamModal({ mode: initialMode, members, onClose }: { mode: "loose" | "power"; members: GraphNode[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"loose" | "power">(initialMode);
  const [name, setName] = useState("");
  const [leaderId, setLeaderId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const create = useMutation({
    mutationFn: () => {
      const memberIds = selected.filter((id) => id !== leaderId);
      return mode === "loose"
        ? api.post("/admin/collab/teams", { name: name.trim(), memberIds, leaderId })
        : api.post("/admin/collab/teams/declare", { name: name.trim(), memberIds, leaderId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "collab", "graph"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message || "作成に失敗しました"),
  });

  function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("チーム名を入力してください"); return; }
    if (!leaderId) { setError("リーダーを選択してください"); return; }
    const others = selected.filter((id) => id !== leaderId);
    if (others.length < 1) { setError("リーダー以外に1名以上選んでください"); return; }
    create.mutate();
  }

  const candidateMembers = members.filter((m) => m.id !== leaderId);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-ink-900)" }}>協働チームを作成する</h2>
          <button onClick={onClose}><X size={18} style={{ color: "var(--color-ink-400)" }} /></button>
        </div>

        <div className="flex gap-2 mb-3">
          <button onClick={() => setMode("loose")}
            className="flex-1 py-2 rounded-2xl text-sm font-medium transition"
            style={{ background: mode === "loose" ? "var(--color-success)" : "var(--color-paper-200)", color: mode === "loose" ? "white" : "var(--color-ink-600)" }}>
            🌿 緩いチーム
          </button>
          <button onClick={() => setMode("power")}
            className="flex-1 py-2 rounded-2xl text-sm font-medium transition"
            style={{ background: mode === "power" ? "var(--color-accent)" : "var(--color-paper-200)", color: mode === "power" ? "white" : "var(--color-ink-600)" }}>
            ⚡ パワーチーム
          </button>
        </div>

        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="チーム名"
          className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }} />

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
          リーダー（内部的な作成者として扱われます）
        </label>
        <select value={leaderId} onChange={(e) => { setLeaderId(e.target.value); setSelected((prev) => prev.filter((id) => id !== e.target.value)); }}
          className="w-full px-3 py-2 rounded-xl border text-sm mb-3" style={{ borderColor: "var(--color-paper-300)" }}>
          <option value="">リーダーを選択...</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.emoji} {m.name}</option>)}
        </select>

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
          リーダー以外のメンバー
        </label>
        <div className="max-h-48 overflow-y-auto border rounded-xl p-2 mb-3" style={{ borderColor: "var(--color-paper-300)" }}>
          {candidateMembers.length === 0 ? (
            <p className="text-xs py-2 text-center" style={{ color: "var(--color-ink-400)" }}>リーダーを選択してください</p>
          ) : candidateMembers.map((m) => (
            <label key={m.id} className="flex items-center gap-2 py-1 text-sm cursor-pointer" style={{ color: "var(--color-ink-700)" }}>
              <input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} />
              {m.emoji} {m.name}
            </label>
          ))}
        </div>

        {error && <p className="text-xs mb-3" style={{ color: "var(--color-brand)" }}>{error}</p>}

        <button onClick={handleSubmit} disabled={create.isPending}
          className="w-full py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50"
          style={{ background: mode === "loose" ? "var(--color-success)" : "var(--color-accent)" }}>
          {create.isPending ? "作成中..." : "チームを作成する"}
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// 活動タイムライン・シェアストーリー（モデレーション用：閲覧＋削除のみ）
// ----------------------------------------------------------------
type PostMember = { id: string; name: string; emoji: string; bgColor: string };
type Post = {
  id: string;
  authorId: string;
  contextType: "link" | "team";
  teamId: string | null;
  visibility: "team" | "chapter" | "private";
  isPrivate: boolean;
  source: "user" | "meeting" | "growth" | "system";
  body: string | null;
  createdAt: number;
  members: PostMember[];
  canDelete: boolean;
};
type Story = {
  id: string;
  teamId: string | null;
  teamName: string | null;
  authorId: string;
  title: string;
  summary: string | null;
  visibility: "team" | "chapter" | "private";
  createdAt: number;
  canDelete: boolean;
  attachments: { id: string; kind: string; label: string; url: string | null }[];
  members: PostMember[];
};

const PERIOD_LABELS: Record<string, string> = { "30": "直近30日", "90": "直近90日", "180": "直近180日", "365": "直近1年", all: "すべて" };
const VISIBILITY_LABEL: Record<Post["visibility"], string> = { team: "🏠 チーム内", chapter: "📢 チャプター公開", private: "🔒 非公開" };

function formatRelativeTime(unixSec: number): string {
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMin < 1) return "たった今";
  if (diffHour < 1) return `${diffMin}分前`;
  if (diffDay < 1) return `${diffHour}時間前`;
  if (diffDay < 30) return `${diffDay}日前`;
  if (diffMonth < 12) return `約${diffMonth}ヶ月前`;
  return `約${Math.floor(diffMonth / 12)}年前`;
}

/** タグの種類ごとに一意な値を持つ。クリックすると同じ(type,value)を持つ投稿だけに絞り込める */
type PostTag = { type: "author" | "partner" | "team" | "date" | "custom"; value: string; label: string };

const HASHTAG_RE = /#([^\s#　]+)/g;

/** 本文中の「#タグ」を抽出する（重複は除去、出現順を維持） */
function extractHashtags(body: string | null): string[] {
  if (!body) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of body.matchAll(HASHTAG_RE)) {
    const tag = m[1];
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      result.push(tag);
    }
  }
  return result;
}

function formatDateKey(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateTagLabel(unixSec: number): string {
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(new Date(unixSec * 1000));
}

/** 投稿1件に付くタグ一覧：投稿者／相手 or チーム／投稿日 ＋ 本文中の #タグ */
function getPostTags(post: Post, teams: GraphTeam[]): PostTag[] {
  const tags: PostTag[] = [];
  const author = post.members.find((m) => m.id === post.authorId);
  if (author) tags.push({ type: "author", value: author.id, label: `👤 ${author.name}` });

  if (post.contextType === "link") {
    const partner = post.members.find((m) => m.id !== post.authorId);
    if (partner) tags.push({ type: "partner", value: partner.id, label: `🤝 ${partner.name}` });
  } else if (post.teamId) {
    const team = teams.find((t) => t.id === post.teamId);
    if (team) tags.push({ type: "team", value: team.id, label: `${TEAM_TYPE_META[team.type].icon} ${team.name}` });
  }

  tags.push({ type: "date", value: formatDateKey(post.createdAt), label: `📅 ${formatDateTagLabel(post.createdAt)}` });

  for (const h of extractHashtags(post.body)) {
    tags.push({ type: "custom", value: h, label: `#${h}` });
  }

  return tags;
}

// ---------------------------------------------------------------
// キーワード検索（タグ・本文・投稿者名・相手/チーム名を対象に、軽量な類似語マッチも行う）
// ---------------------------------------------------------------

function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

function normalizeForSearch(s: string): string {
  return toHiragana(s.normalize("NFKC").toLowerCase()).replace(/[\s　・･/／,、.。]/g, "");
}

function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  if (s.length === 0) return set;
  if (s.length < 2) { set.add(s); return set; }
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function bigramContainment(queryGrams: Set<string>, textGrams: Set<string>): number {
  if (queryGrams.size === 0) return 0;
  let hit = 0;
  for (const g of queryGrams) if (textGrams.has(g)) hit++;
  return hit / queryGrams.size;
}

type SearchIndex = { normalized: string; grams: Set<string> };

function buildSearchIndex(post: Post, tags: PostTag[]): SearchIndex {
  const author = post.members.find((m) => m.id === post.authorId);
  const parts = [
    author?.name ?? "",
    ...post.members.filter((m) => m.id !== post.authorId).map((m) => m.name),
    post.body ?? "",
    ...tags.map((t) => t.label),
  ];
  const normalized = normalizeForSearch(parts.join(" "));
  return { normalized, grams: bigrams(normalized) };
}

function matchesSearch(index: SearchIndex, query: string): boolean {
  const terms = normalizeForSearch(query).length === 0 ? [] : query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  return terms.every((term) => {
    const normTerm = normalizeForSearch(term);
    if (!normTerm) return true;
    if (index.normalized.includes(normTerm)) return true;
    const termGrams = bigrams(normTerm);
    if (termGrams.size === 0) return false;
    if (normTerm.length < 3) return false;
    return bigramContainment(termGrams, index.grams) >= 0.6;
  });
}

function AdminActivityAndRecords({ teams }: { teams: GraphTeam[] }) {
  const [subTab, setSubTab] = useState<"timeline" | "stories">("timeline");
  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button onClick={() => setSubTab("timeline")}
          className="flex-1 py-1.5 rounded-2xl text-xs font-medium transition"
          style={{ background: subTab === "timeline" ? "var(--color-accent)" : "var(--color-paper-200)", color: subTab === "timeline" ? "white" : "var(--color-ink-600)" }}>
          🌊 活動タイムライン
        </button>
        <button onClick={() => setSubTab("stories")}
          className="flex-1 py-1.5 rounded-2xl text-xs font-medium transition"
          style={{ background: subTab === "stories" ? "var(--color-accent)" : "var(--color-paper-200)", color: subTab === "stories" ? "white" : "var(--color-ink-600)" }}>
          📚 シェアストーリーの棚
        </button>
      </div>
      {subTab === "timeline" ? <AdminActivityTimeline teams={teams} /> : <AdminShareStoryShelf teams={teams} />}
    </div>
  );
}

function TeamFilterBar({ teams, team, setTeam }: { teams: GraphTeam[]; team: string; setTeam: (v: string) => void }) {
  return (
    <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
      <button onClick={() => setTeam("all")}
        className="px-3 py-1.5 rounded-2xl text-xs font-medium whitespace-nowrap transition"
        style={{ background: team === "all" ? "var(--color-ink-700)" : "var(--color-paper-200)", color: team === "all" ? "white" : "var(--color-ink-600)" }}>
        すべて
      </button>
      {teams.map((t) => (
        <button key={t.id} onClick={() => setTeam(t.id)}
          className="px-3 py-1.5 rounded-2xl text-xs font-medium whitespace-nowrap transition"
          style={{ background: team === t.id ? "var(--color-ink-700)" : "var(--color-paper-200)", color: team === t.id ? "white" : "var(--color-ink-600)" }}>
          {TEAM_TYPE_META[t.type].icon} {t.name}
        </button>
      ))}
    </div>
  );
}

function AdminActivityTimeline({ teams }: { teams: GraphTeam[] }) {
  const qc = useQueryClient();
  const [period, setPeriod] = useState("30");
  const [team, setTeam] = useState("all");
  const [activeTag, setActiveTag] = useState<PostTag | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "collab", "feed", period, team],
    queryFn: () => api.get<{ data: Post[] }>(`/admin/collab/feed?period=${period}&team=${team}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (postId: string) => api.delete(`/admin/collab/posts/${postId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "collab", "feed"] }),
  });

  const posts = data?.data ?? [];
  const enrichedPosts = useMemo(
    () => posts.map((p) => {
      const tags = getPostTags(p, teams);
      return { post: p, tags, searchIndex: buildSearchIndex(p, tags) };
    }),
    [posts, teams]
  );
  const filteredPosts = enrichedPosts
    .filter(({ tags }) => !activeTag || tags.some((t) => t.type === activeTag.type && t.value === activeTag.value))
    .filter(({ searchIndex }) => matchesSearch(searchIndex, searchQuery));

  function handleTagClick(tag: PostTag) {
    setActiveTag((prev) => (prev && prev.type === tag.type && prev.value === tag.value ? null : tag));
  }

  return (
    <div>
      <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1">
        {Object.keys(PERIOD_LABELS).map((p) => (
          <button key={p} onClick={() => setPeriod(p)}
            className="px-3 py-1.5 rounded-2xl text-xs font-medium whitespace-nowrap transition"
            style={{ background: period === p ? "var(--color-brand)" : "var(--color-paper-200)", color: period === p ? "white" : "var(--color-ink-600)" }}>
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>
      <TeamFilterBar teams={teams} team={team} setTeam={setTeam} />

      <div className="relative mb-3">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-ink-400)" }} />
        <input
          type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="🔍 キーワードで検索（タグ・本文・投稿者・相手やチーム名）"
          className="w-full rounded-2xl pl-9 pr-9 py-2.5 text-sm outline-none"
          style={{ background: "var(--color-paper-50)", border: "1.5px solid var(--color-paper-300)", color: "var(--color-ink-800)" }}
        />
        {searchQuery && (
          <button type="button" onClick={() => setSearchQuery("")}
            aria-label="検索条件をクリア"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full"
            style={{ color: "var(--color-ink-400)" }}>
            <X size={14} />
          </button>
        )}
      </div>

      {activeTag && (
        <div className="flex items-center gap-2 mb-3 text-xs px-3 py-2 rounded-2xl"
          style={{ background: "rgba(181,56,75,0.1)", color: "var(--color-brand)" }}>
          <span>🔎 絞り込み中: {activeTag.label}</span>
          <button onClick={() => setActiveTag(null)} className="ml-auto shrink-0"><X size={14} /></button>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8" style={{ color: "var(--color-ink-400)" }}>読み込み中...</div>
      ) : posts.length === 0 ? (
        <p className="text-center text-sm py-8" style={{ color: "var(--color-ink-400)" }}>この期間の投稿はありません</p>
      ) : filteredPosts.length === 0 ? (
        <p className="text-center text-sm py-8" style={{ color: "var(--color-ink-400)" }}>
          {searchQuery ? "検索条件に一致する投稿はありません" : "このタグの投稿はありません"}
        </p>
      ) : (
        <div className="space-y-3">
          {filteredPosts.map(({ post: p, tags }) => {
            const author = p.members.find((m) => m.id === p.authorId);
            const isSystem = p.source === "system";
            return (
              <div key={p.id} className="card-paper p-4">
                <div className="flex items-center gap-2 mb-2">
                  {author && (
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0 ${author.bgColor}`}>{author.emoji}</span>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-700)" }}>
                      {p.members.filter((m) => m.id !== p.authorId).length > 0
                        ? `${author?.name ?? "だれか"} × ${p.members.filter((m) => m.id !== p.authorId).map((m) => m.name).join("・")}`
                        : author?.name ?? "だれか"}
                    </p>
                    <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>{formatRelativeTime(p.createdAt)}</p>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full shrink-0" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
                    {VISIBILITY_LABEL[p.visibility]}
                  </span>
                  {p.canDelete && !isSystem && (
                    <button onClick={() => { if (confirm("この投稿を削除しますか？")) deleteMutation.mutate(p.id); }}
                      className="p-1 rounded-lg shrink-0" style={{ color: "var(--color-ink-400)" }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <p className="text-sm mb-2" style={{ color: "var(--color-ink-800)" }}>{p.body ?? "（本文なし）"}</p>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((t) => {
                      const isActive = activeTag?.type === t.type && activeTag?.value === t.value;
                      return (
                        <button key={`${t.type}-${t.value}`} onClick={() => handleTagClick(t)}
                          className="text-[11px] px-2 py-0.5 rounded-full font-medium transition"
                          style={{ background: isActive ? "var(--color-brand)" : "var(--color-paper-200)", color: isActive ? "white" : "var(--color-ink-500)" }}>
                          {t.label}
                        </button>
                      );
                    })}
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

function AdminShareStoryShelf({ teams }: { teams: GraphTeam[] }) {
  const qc = useQueryClient();
  const [team, setTeam] = useState("all");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "collab", "stories", team],
    queryFn: () => api.get<{ data: Story[] }>(`/admin/collab/stories?team=${team}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/collab/stories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "collab", "stories"] }),
  });

  const stories = data?.data ?? [];

  return (
    <div>
      <TeamFilterBar teams={teams} team={team} setTeam={setTeam} />

      {isLoading ? (
        <div className="text-center py-8" style={{ color: "var(--color-ink-400)" }}>読み込み中...</div>
      ) : stories.length === 0 ? (
        <p className="text-center text-sm py-8" style={{ color: "var(--color-ink-400)" }}>まだシェアストーリーがありません</p>
      ) : (
        <div className="space-y-3">
          {stories.map((s) => (
            <div key={s.id} className="card-paper p-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>{s.title}</h3>
                {s.canDelete && (
                  <button onClick={() => { if (confirm("削除しますか？")) deleteMutation.mutate(s.id); }} style={{ color: "var(--color-ink-400)" }}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                {s.teamName && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
                    {s.teamName}
                  </span>
                )}
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
                  {VISIBILITY_LABEL[s.visibility]}
                </span>
              </div>
              {s.summary && <p className="text-sm mb-2 whitespace-pre-wrap" style={{ color: "var(--color-ink-700)" }}>{s.summary}</p>}
              {s.attachments.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {s.attachments.map((a) => (
                    a.url ? (
                      <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer"
                        className="text-xs underline underline-offset-2" style={{ color: "var(--color-brand)" }}>
                        📎 {a.label}
                      </a>
                    ) : (
                      <span key={a.id} className="text-xs" style={{ color: "var(--color-ink-500)" }}>📎 {a.label}</span>
                    )
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
