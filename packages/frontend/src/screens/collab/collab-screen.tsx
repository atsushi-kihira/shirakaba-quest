// =============================================================
// 協働（協働マップ）
//
// 協働マップは「全員が同じものを見る公開レイヤー」（関係線・チームの塊）と
// 「自分だけに見える私的レイヤー」（自分から見た可能性/リファーラルのチェック、
// 自分との関係の強さによるレイアウト）の2層構造になっている。
// =============================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useIsFetching, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Handshake, Plus, Home as HomeIcon, RefreshCw, X } from "lucide-react";
import { api } from "@/lib/api";
import { matchesSearchQuery } from "@/lib/contact-search";
import {
  type Contact,
  type ContactSortOrder,
  VISIBILITY_STYLE,
  CONTACT_SORT_LABEL,
  sortContacts,
} from "@/lib/contacts";
import { useDraggableMapLayout } from "@/hooks/use-draggable-map-layout";
import { CreateCollabTeamModal } from "./_create-team-modal";
import { ActivityAndRecords } from "./_activity-and-records";

type GraphNode = { id: string; name: string; emoji: string; bgColor: string; isMe: boolean; hasActivity: boolean };
type Stage = "one" | "seed" | "loose";
type Stalled = "active" | "stalled" | "intervene";
// 全員が見る公開レイヤー：関係線（どちらから見ても同じ）
type GraphEdge = {
  memberAId: string;
  memberBId: string;
  stage: Stage;
  stalled: Stalled;
  oneOnOneCount: number;
  lastActivityAt: number | null;
};
// 自分だけに見える私的レイヤー：自分から見た可能性/リファーラルのチェック状態
type MyEdge = {
  partnerId: string;
  myPossible: boolean;
  partnerPossible: boolean;
  myReferral: boolean;
  partnerReferral: boolean;
};
type TeamMember = {
  id: string; name: string; emoji: string; bgColor: string;
  status: "active" | "pending" | "declined"; invitedBy: string | null;
};
type GraphTeam = {
  id: string;
  name: string;
  type: "loose" | "power";
  createdBy: string;
  archived: boolean;
  myStatus: "active" | "pending" | "declined" | null;
  members: TeamMember[];
};
type PendingConfirmation = { partnerId: string; name: string; emoji: string; bgColor: string; lastActivityAt: number | null };

// 遅延生成トリガーで一度に送るID数の上限（バックエンドのLAZY_SUMMARY_BATCH_LIMITと合わせる）
const LAZY_SUMMARY_BATCH_LIMIT = 30;

const TEAM_TYPE_META: Record<GraphTeam["type"], { color: string; icon: string }> = {
  loose: { color: "var(--color-success)", icon: "🌿" },
  power: { color: "var(--color-accent)", icon: "⚡" },
};
type GraphResponse = {
  data: {
    center: string; nodes: GraphNode[]; edges: GraphEdge[]; myEdges: MyEdge[]; teams: GraphTeam[];
    noActivityMembers: GraphNode[]; pendingConfirmations: PendingConfirmation[]; contacts: Contact[];
  };
};

const STAGE_META: Record<Stage, { label: string; color: string; dash?: string; width: number }> = {
  one:   { label: "1to1のみ", color: "var(--color-ink-300)", dash: "4 3", width: 1.5 },
  seed:  { label: "協働の芽", color: "var(--color-accent)", dash: "4 3", width: 2 },
  // 緩いチーム同士の線・チームの塊からはみ出したメンバーをつなぐ線は、どちらも同じ
  // 細い点線で表現する（マップ上の見た目と揃える）
  loose: { label: "緩いチーム", color: "var(--color-success)", dash: "3 3", width: 1.2 },
};

const STALLED_META: Record<Stalled, { label: string; color: string } | null> = {
  active: null,
  stalled: { label: "停滞ぎみ", color: "var(--color-accent)" },
  intervene: { label: "停滞中", color: "var(--color-brand)" },
};

function useCollabGraph() {
  return useQuery({
    queryKey: ["collab", "graph"],
    queryFn: () => api.get<GraphResponse>("/collab/graph"),
  });
}

/** 一部分だけを再表示するボタン（再取得中は回転して「動いている」ことを示す） */
function RefreshSectionButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={busy}
      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium transition disabled:opacity-60"
      style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
      <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
      {busy ? "更新中..." : label}
    </button>
  );
}

export function CollabScreen() {
  return <CollabMap />;
}

function CollabMap() {
  const qc = useQueryClient();
  const { data, isLoading } = useCollabGraph();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [createTeamMode, setCreateTeamMode] = useState<"loose" | "power" | null>(null);
  const [showContacts, setShowContacts] = useState(false);
  // 協働チーム一覧の「開いているチーム」。マップ上のチームの塊をタップしても、ここが切り替わる
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [teamScrollNonce, setTeamScrollNonce] = useState(0);

  const graph = data?.data;
  const myEdge = graph?.myEdges.find((e) => e.partnerId === selectedId) ?? null;
  const sharedEdge = graph?.edges.find(
    (e) => (e.memberAId === selectedId && e.memberBId === graph.center) || (e.memberBId === selectedId && e.memberAId === graph.center)
  ) ?? null;
  const selectedNode = graph?.nodes.find((n) => n.id === selectedId) ?? null;

  const acknowledge = useMutation({
    mutationFn: (partnerId: string) => api.post(`/collab/links/${partnerId}/acknowledge`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collab", "graph"] }),
  });

  // 協働マップ／活動記録は、それぞれの部分のデータだけを取り直して再表示する（ページ全体は再読み込みしない）
  const mapFetching = useIsFetching({ queryKey: ["collab", "graph"] }) > 0;
  const activityFetching =
    useIsFetching({ queryKey: ["collab", "feed"] }) +
      useIsFetching({ queryKey: ["share-stories"] }) +
      useIsFetching({ queryKey: ["collab", "team-action-items"] }) > 0;
  function refreshMap() {
    qc.refetchQueries({ queryKey: ["collab", "graph"] });
  }
  function refreshActivity() {
    qc.refetchQueries({ queryKey: ["collab", "feed"] });
    qc.refetchQueries({ queryKey: ["share-stories"] });
    qc.refetchQueries({ queryKey: ["collab", "team-action-items"] });
    qc.invalidateQueries({ queryKey: ["collab", "activity", "unread-count"] });
  }

  return (
    <div className="pb-24 lg:pb-6">
      <div className="px-4 pt-6 lg:px-0">
        <h1 className="text-2xl font-semibold flex items-center gap-2 mb-1"
          style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          <Handshake size={24} style={{ color: "var(--color-brand)" }} />
          協働マップ
        </h1>
        <p className="text-sm mb-4" style={{ color: "var(--color-ink-500)" }}>
          なかまとの1to1から育つ関係を、地図のように眺めてみましょう。
        </p>
      </div>

      {isLoading ? (
        <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>読み込み中...</div>
      ) : graph ? (
        <>
          {graph.pendingConfirmations.length > 0 && (
            <PendingConfirmationBanner
              pending={graph.pendingConfirmations[0]}
              restCount={graph.pendingConfirmations.length - 1}
              onCheck={(partnerId) => { setSelectedId(partnerId); acknowledge.mutate(partnerId); }}
              onDismiss={(partnerId) => acknowledge.mutate(partnerId)}
            />
          )}

          <SelfSummaryPanel graph={graph} />

          <div className="px-4 lg:px-0 mb-2 flex items-center justify-between gap-2">
            <RefreshSectionButton label="🗺️ マップを再表示" busy={mapFetching} onClick={refreshMap} />
            <button onClick={() => setShowContacts((v) => !v)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium transition"
              style={{ background: showContacts ? "var(--color-brand)" : "var(--color-paper-200)", color: showContacts ? "white" : "var(--color-ink-600)" }}>
              🌐 外部人脈：{showContacts ? "表示" : "非表示"}
            </button>
          </div>

          {showContacts && (
            <ContactSearchPanel
              graph={graph}
              activeOwnerId={selectedOwnerId}
              onSelectOwner={(id) => setSelectedOwnerId(id)}
              onClearOwner={() => setSelectedOwnerId(null)}
            />
          )}

          <GraphCanvas
            graph={graph}
            selectedId={selectedId}
            onSelect={(id) => { setSelectedId(id); setSelectedOwnerId(null); }}
            showContacts={showContacts}
            onSelectOwnerContacts={(id) => { setSelectedOwnerId(id); setSelectedId(null); }}
            highlightTeamId={expandedTeamId}
            onSelectTeam={(id) => { setExpandedTeamId(id); setTeamScrollNonce((n) => n + 1); }}
          />

          {selectedNode && sharedEdge && (
            <NodeDetailPanel
              node={selectedNode}
              sharedEdge={sharedEdge}
              myEdge={myEdge}
              onClose={() => setSelectedId(null)}
            />
          )}

          <div className="px-4 lg:px-0 mt-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
                🦄 協働チーム
              </h2>
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
                  ⚡ パワーチームを宣言
                </button>
              </div>
            </div>
            <CollabTeamsList teams={graph.teams} meId={graph.center}
              expandedId={expandedTeamId} onExpandedChange={setExpandedTeamId} scrollNonce={teamScrollNonce}
              candidateMembers={[...graph.nodes.filter((n) => !n.isMe), ...graph.noActivityMembers]} />
          </div>

          <div className="mt-8 pt-6" style={{ borderTop: "1px solid var(--color-paper-300)" }}>
            <div className="px-4 lg:px-0 mb-3 flex justify-end">
              <RefreshSectionButton label="📝 活動記録を再表示" busy={activityFetching} onClick={refreshActivity} />
            </div>
            <ActivityAndRecords />
          </div>
        </>
      ) : (
        <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>データを取得できませんでした</div>
      )}

      {createTeamMode && graph && (
        <CreateCollabTeamModal
          initialMode={createTeamMode}
          candidateMembers={[...graph.nodes.filter((n) => !n.isMe), ...graph.noActivityMembers]}
          onClose={() => setCreateTeamMode(null)}
        />
      )}
    </div>
  );
}

function PendingConfirmationBanner({
  pending,
  restCount,
  onCheck,
  onDismiss,
}: {
  pending: PendingConfirmation;
  restCount: number;
  onCheck: (partnerId: string) => void;
  onDismiss: (partnerId: string) => void;
}) {
  return (
    <div className="px-4 lg:px-0 mb-4">
      <div className="card-paper p-3 flex items-center gap-3" style={{ background: "rgba(212,160,59,0.12)", border: "1px solid rgba(212,160,59,0.35)" }}>
        <span className="text-lg shrink-0">🔔</span>
        <p className="text-sm flex-1" style={{ color: "var(--color-ink-700)" }}>
          {pending.emoji} <span className="font-medium">{pending.name}</span>さんとの1to1が完了しました。協業・協働の可能性はありそうですか？
          {restCount > 0 && <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>（ほか{restCount}件）</span>}
        </p>
        <button onClick={() => onCheck(pending.partnerId)}
          className="text-xs px-3 py-1.5 rounded-full font-medium text-white shrink-0"
          style={{ background: "var(--color-accent)" }}>
          確認する
        </button>
        <button onClick={() => onDismiss(pending.partnerId)} className="p-1 rounded-full shrink-0" style={{ color: "var(--color-ink-400)" }}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

function SelfSummaryPanel({ graph }: { graph: GraphResponse["data"] }) {
  const me = graph.nodes.find((n) => n.isMe);
  if (!me) return null;

  const powerCount = graph.teams.filter((t) => t.type === "power" && t.myStatus === "active" && !t.archived).length;
  const looseCount = graph.teams.filter((t) => t.type === "loose" && t.myStatus === "active" && !t.archived).length;
  const seedCount = graph.edges.filter(
    (e) => (e.memberAId === graph.center || e.memberBId === graph.center) && e.stage === "seed"
  ).length;

  return (
    <div className="px-4 lg:px-0 mb-4">
      <div className="card-paper p-4 flex items-center gap-3">
        <div className={`w-11 h-11 rounded-full flex items-center justify-center text-xl shrink-0 ${me.bgColor}`}>{me.emoji}</div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>{me.name}（あなた）</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
            なかまの丸をタップすると、その人との関係と、育てるための操作が出ます。
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--color-ink-600)" }}>
            ⚡パワーチーム{powerCount}・🌿緩いチーム{looseCount}・🌱協働の芽{seedCount}に参加中
          </p>
        </div>
      </div>
    </div>
  );
}

// 自分から見た関係の近さ（グラフ上の距離）を決める階層
type Tier = "loose" | "seed" | "one" | "team" | "far";
const TIER_RADIUS: Record<Tier, number> = { loose: 85, seed: 105, one: 135, team: 160, far: 210 };

function GraphCanvas({
  graph,
  selectedId,
  onSelect,
  showContacts,
  onSelectOwnerContacts,
  highlightTeamId,
  onSelectTeam,
}: {
  graph: GraphResponse["data"];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  showContacts: boolean;
  onSelectOwnerContacts: (ownerId: string) => void;
  highlightTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const panMoved = useRef(false); // 背景のドラッグで動かしたあとの「クリック」を、チームの選択と区別する

  const meId = graph.center;
  const myEdgeByPartner = useMemo(() => new Map(graph.myEdges.map((e) => [e.partnerId, e])), [graph.myEdges]);

  // 公開レイヤーの関係線を「相手ID → 自分との関係」の形に正規化しておく（自分と直接繋がる人向け）
  const sharedEdgeWithMe = useMemo(() => {
    const map = new Map<string, GraphEdge>();
    for (const e of graph.edges) {
      if (e.memberAId === meId) map.set(e.memberBId, e);
      else if (e.memberBId === meId) map.set(e.memberAId, e);
    }
    return map;
  }, [graph.edges, meId]);

  const myTeamIds = useMemo(
    () => new Set(graph.teams.filter((t) => t.myStatus === "active" && !t.archived).map((t) => t.id)),
    [graph.teams]
  );
  const teammateIds = useMemo(() => {
    const set = new Set<string>();
    for (const t of graph.teams) {
      if (!myTeamIds.has(t.id)) continue;
      for (const m of t.members) if (m.id !== meId) set.add(m.id);
    }
    return set;
  }, [graph.teams, myTeamIds, meId]);

  const others = useMemo(() => graph.nodes.filter((n) => !n.isMe), [graph.nodes]);

  function tierOf(nodeId: string): Tier {
    const edge = sharedEdgeWithMe.get(nodeId);
    if (edge) return edge.stage; // 'one' | 'seed' | 'loose'
    if (teammateIds.has(nodeId)) return "team";
    return "far";
  }

  const autoPositions = useMemo(() => {
    const total = others.length;
    if (total === 0) return [];
    const otherIds = new Set(others.map((n) => n.id));

    // パワーチーム・ゆるいチームのメンバーは角度をまとめて隣接させ、無関係なメンバーの
    // アイコンがチームの塊（teamBlobs）の中に紛れ込まないようにする。グループ間には
    // 隙間を空ける。複数のチームに所属するメンバーは、先に見つかったチームのグループに入れる。
    type Group = { ids: string[]; isTeam: boolean };
    const groups: Group[] = [];
    const grouped = new Set<string>();
    const powerTeams = graph.teams.filter((t) => t.type === "power" && !t.archived);
    const looseTeams = graph.teams.filter((t) => t.type === "loose" && !t.archived);
    for (const team of [...powerTeams, ...looseTeams]) {
      const memberIds = team.members.map((m) => m.id).filter((id) => !grouped.has(id) && otherIds.has(id));
      if (memberIds.length === 0) continue;
      memberIds.forEach((id) => grouped.add(id));
      groups.push({ ids: memberIds, isTeam: true });
    }
    const rest = others.map((o) => o.id).filter((id) => !grouped.has(id));
    if (rest.length > 0) groups.push({ ids: rest, isTeam: false });

    const GAP = Math.PI / 18; // グループ間の隙間
    // パワーチームは「メンバー1人ぶん強」の角度スロットだけを確保し、実際のメンバーは
    // その中心（アンカー地点）のごく近くに小さくまとめて配置する。個々の半径（自分との
    // 関係の近さ）ではなく、チーム全体の平均的な距離感で1箇所にまとまるため、背景の塊が
    // 丸に近い、こぢんまりした形になる。無所属メンバーはこれまで通り、残りの角度に
    // 個々の関係の近さ（半径）で配置する。
    const TEAM_SLOT_WEIGHT = 1.4;
    const weights = groups.map((g) => (g.isTeam ? TEAM_SLOT_WEIGHT : g.ids.length));
    const totalWeight = weights.reduce((s, w) => s + w, 0) || 1;
    const usableAngle = Math.PI * 2 - GAP * groups.length;

    const result: { id: string; x: number; y: number }[] = [];
    let cursor = -Math.PI / 2;
    groups.forEach((group, gi) => {
      const share = usableAngle * (weights[gi] / totalWeight);
      if (group.isTeam) {
        const midAngle = cursor + share / 2;
        const avgR = group.ids.reduce((s, id) => s + TIER_RADIUS[tierOf(id)], 0) / group.ids.length;
        const anchorX = Math.cos(midAngle) * avgR;
        const anchorY = Math.sin(midAngle) * avgR;
        const n = group.ids.length;
        // クラスタ半径がアンカーの原点からの距離を超えると、原点（自分）側まで
        // はみ出しかねないため、アンカー距離の6割を上限に抑える
        const clusterR = n <= 1 ? 0 : Math.min(Math.max(28, 14 * n), avgR * 0.6);
        group.ids.forEach((id, i) => {
          const a = (2 * Math.PI * i) / n;
          result.push({ id, x: anchorX + Math.cos(a) * clusterR, y: anchorY + Math.sin(a) * clusterR });
        });
      } else {
        group.ids.forEach((id, i) => {
          const angle = group.ids.length === 1 ? cursor + share / 2 : cursor + (share * i) / (group.ids.length - 1);
          const r = TIER_RADIUS[tierOf(id)];
          result.push({ id, x: Math.cos(angle) * r, y: Math.sin(angle) * r });
        });
      }
      cursor += share + GAP;
    });
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [others, sharedEdgeWithMe, teammateIds, graph.teams]);

  // ---- アイコン配置（ドラッグ移動・位置の記録・微調整・リセット） ----------------
  const { positions, draggingId, svgGroupRef, nodeHandlers, saveFailed, resetting, resetLayout } = useDraggableMapLayout({
    endpoint: "/collab/map-positions",
    nodes: others,
    autoPositions,
    teams: graph.teams,
    centerFixed: true,
    onSelect,
  });

  const positionById = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    map.set(meId, { x: 0, y: 0 });
    positions.forEach((p) => map.set(p.id, { x: p.x, y: p.y }));
    return map;
  }, [positions, meId]);

  // 緩いチームの塊（円）で表現する関係は、線でも二重に表現しない（パワーチームと同じ扱いにする）。
  // 緩いチームの現役メンバー同士のペアは、たとえ実際の1to1関係の段階が"loose"でなくても
  // バックエンド側で強制的にloose扱いの線が引かれるため、その分だけ線描画から除外する。
  const loosePairKeysCovered = useMemo(() => {
    const set = new Set<string>();
    for (const team of graph.teams) {
      if (team.type !== "loose" || team.archived) continue;
      const activeIds = team.members.filter((m) => m.status === "active").map((m) => m.id);
      for (let i = 0; i < activeIds.length; i++) {
        for (let j = i + 1; j < activeIds.length; j++) {
          const [lo, hi] = [activeIds[i], activeIds[j]].sort();
          set.add(`${lo}:${hi}`);
        }
      }
    }
    return set;
  }, [graph.teams]);

  // 全員が見る関係線（自分が絡むものも、第三者同士のものも含む）
  const renderEdges = useMemo(() => {
    return graph.edges
      .filter((e) => {
        const [lo, hi] = [e.memberAId, e.memberBId].sort();
        return !loosePairKeysCovered.has(`${lo}:${hi}`);
      })
      .map((e) => {
        const pa = positionById.get(e.memberAId);
        const pb = positionById.get(e.memberBId);
        if (!pa || !pb) return null;
        return { ...e, pa, pb };
      })
      .filter((e): e is GraphEdge & { pa: { x: number; y: number }; pb: { x: number; y: number } } => !!e);
  }, [graph.edges, positionById, loosePairKeysCovered]);

  // 塊（ぼかし背景）はパワーチーム・緩いチームの両方で表示する。
  // チームメンバーの実際の位置だけを包む凸包（＋パディング）を計算する。
  // 中心から半径だけで円を描くと、メンバー同士の距離のバラつき（「私」との関係の近さで
  // 半径が決まるため、同じチームでもメンバーごとに輪の位置が大きく異なりうる）によって
  // 円が無関係なメンバーのいる領域まで大きくスイープしてしまうため、輪郭を凸包にして
  // 実際のメンバー位置にできるだけ沿わせる。
  function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
    const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
      (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower: typeof pts = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper: typeof pts = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    upper.pop(); lower.pop();
    return [...lower, ...upper];
  }

  // 円（または凸包）が実際に無関係な人のアイコンを内側に巻き込んでいないかを判定する。
  // アイコン自体に半径があるため、境界ぎりぎりも「巻き込み」として扱う余白を持たせる。
  const NODE_R = 20;
  function pointInPolygon(pt: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      const intersect = (yi > pt.y) !== (yj > pt.y) && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  type Shape = { cx: number; cy: number; labelY: number; circle: { cx: number; cy: number; r: number } | null; polygon: { x: number; y: number }[] | null };

  function computeShape(pts: { x: number; y: number }[]): Shape {
    const PAD = 32;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    if (pts.length === 1) {
      return { cx, cy, labelY: pts[0].y - 40 - 6, circle: { cx: pts[0].x, cy: pts[0].y, r: 40 }, polygon: null };
    }
    if (pts.length === 2) {
      // 2点だけの場合は凸包が線分になってしまうため、2点を包むカプセル状の円として扱う
      const mcx = (pts[0].x + pts[1].x) / 2;
      const mcy = (pts[0].y + pts[1].y) / 2;
      const half = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / 2;
      const r = half + PAD;
      return { cx: mcx, cy: mcy, labelY: mcy - r - 6, circle: { cx: mcx, cy: mcy, r }, polygon: null };
    }
    const hull = convexHull(pts);
    const polygon = hull.map((p) => {
      const dx = p.x - cx, dy = p.y - cy;
      const len = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / len) * PAD, y: p.y + (dy / len) * PAD };
    });
    const labelY = Math.min(...polygon.map((p) => p.y)) - 6;
    return { cx, cy, labelY, circle: null, polygon };
  }

  function shapeContains(shape: Shape, pt: { x: number; y: number }): boolean {
    if (shape.circle) return Math.hypot(pt.x - shape.circle.cx, pt.y - shape.circle.cy) < shape.circle.r + NODE_R;
    if (shape.polygon) return pointInPolygon(pt, shape.polygon);
    return false;
  }

  const teamBlobs = useMemo(() => {
    type TeamBlob = {
      team: GraphTeam; cx: number; labelY: number; path: string | null;
      circle: { cx: number; cy: number; r: number } | null;
      tethers: { from: { x: number; y: number }; to: { x: number; y: number } }[];
    };
    // パワーチームを優先する：パワーチームの塊は従来通り無条件で描く（調整の対象にしない）。
    // ゆるいチームは、無関係な人を巻き込んでしまう場合のみ、はみ出しの原因になっている
    // メンバーを塊から外し、そのメンバーは細い線で塊（一番近いメンバー）とつなぐことで
    // 「チームであること」は示しつつ、無関係な人を丸の中に入れないようにする。
    const allTeams = graph.teams.filter((team) => (team.type === "power" || team.type === "loose") && !team.archived);
    const ordered = [...allTeams.filter((t) => t.type === "power"), ...allTeams.filter((t) => t.type === "loose")];

    return ordered.map((team): TeamBlob | null => {
      const memberIds = team.members.map((m) => m.id).filter((id) => positionById.has(id));
      if (memberIds.length === 0) return null;
      const memberIdSet = new Set(memberIds);

      if (team.type === "power" || memberIds.length === 1) {
        const pts = memberIds.map((id) => positionById.get(id)!);
        const shape = computeShape(pts);
        return { team, cx: shape.cx, labelY: shape.labelY, circle: shape.circle, tethers: [], path: shape.polygon ? `M ${shape.polygon.map((p) => `${p.x} ${p.y}`).join(" L ")} Z` : null };
      }

      const foreignPts = graph.nodes
        .filter((n) => !memberIdSet.has(n.id))
        .map((n) => positionById.get(n.id))
        .filter((p): p is { x: number; y: number } => !!p);

      let coreIds = [...memberIds];
      const excludedIds: string[] = [];
      while (coreIds.length > 1) {
        const corePts = coreIds.map((id) => positionById.get(id)!);
        const shape = computeShape(corePts);
        const hasViolation = foreignPts.some((p) => shapeContains(shape, p));
        if (!hasViolation) break;
        // 中心から最も遠いメンバーが塊を膨らませている可能性が高いため、そのメンバーを外して再計算する
        const cx = corePts.reduce((s, p) => s + p.x, 0) / corePts.length;
        const cy = corePts.reduce((s, p) => s + p.y, 0) / corePts.length;
        let farIdx = 0, farDist = -1;
        coreIds.forEach((id, i) => {
          const p = positionById.get(id)!;
          const d = Math.hypot(p.x - cx, p.y - cy);
          if (d > farDist) { farDist = d; farIdx = i; }
        });
        excludedIds.push(coreIds[farIdx]);
        coreIds.splice(farIdx, 1);
      }

      const corePts = coreIds.map((id) => positionById.get(id)!);
      const shape = computeShape(corePts);
      const tethers = excludedIds.map((id) => {
        const p = positionById.get(id)!;
        // 最も近いコアメンバーへ細い線でつなぐ
        let nearest = corePts[0];
        let nearestDist = Infinity;
        for (const cp of corePts) {
          const d = Math.hypot(p.x - cp.x, p.y - cp.y);
          if (d < nearestDist) { nearestDist = d; nearest = cp; }
        }
        return { from: p, to: nearest };
      });

      return {
        team, cx: shape.cx, labelY: shape.labelY, circle: shape.circle, tethers,
        path: shape.polygon ? `M ${shape.polygon.map((p) => `${p.x} ${p.y}`).join(" L ")} Z` : null,
      };
    }).filter((b): b is TeamBlob => !!b);
  }, [graph.teams, graph.nodes, positionById]);

  const pendingByMemberId = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const team of graph.teams) {
      for (const m of team.members) {
        if (m.status === "pending") map.set(m.id, true);
      }
    }
    return map;
  }, [graph.teams]);

  // 人脈レイヤー：個々の人脈を衛星ノードで並べると件数が多い人で潰れて1個しか見えなくなるため、
  // 所有者ごとに「件数バッジ」を1つだけ表示する。クリックすると一覧パネルが開く。
  const contactBadges = useMemo(() => {
    if (!showContacts) return [];
    const countByOwner = new Map<string, number>();
    for (const ct of graph.contacts) {
      if (ct.visibility === "private") continue; // 件数バッジには非公開の人脈を含めない
      countByOwner.set(ct.ownerId, (countByOwner.get(ct.ownerId) ?? 0) + 1);
    }
    const result: { ownerId: string; count: number; x: number; y: number }[] = [];
    for (const [ownerId, count] of countByOwner) {
      const center = positionById.get(ownerId);
      if (!center) continue;
      result.push({ ownerId, count, x: center.x + 16, y: center.y - 20 });
    }
    return result;
  }, [showContacts, graph.contacts, positionById]);

  function onPointerDown(e: React.PointerEvent) {
    panMoved.current = false;
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: offset.x, origY: offset.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    if (Math.hypot(dx, dy) > 5) panMoved.current = true;
    setOffset({ x: dragState.current.origX + dx, y: dragState.current.origY + dy });
  }
  function onPointerUp() {
    dragState.current = null;
  }
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    setScale((s) => Math.min(2.5, Math.max(0.4, s - e.deltaY * 0.001)));
  }

  // 自分から見た「協業・協働の可能性」「リファーラル」チェック状態によるアイコン塗り（私的レイヤー）
  function nodeFill(nodeId: string): string {
    const my = myEdgeByPartner.get(nodeId);
    if (!my) return "var(--color-paper-50)";
    if (my.myPossible) return "rgba(212,160,59,0.55)"; // 目立つゴールド
    if (my.myReferral) return "rgba(90,140,92,0.28)";  // やや薄めのグリーン
    return "var(--color-paper-50)";
  }

  return (
    <>
    <div className="relative mx-4 lg:mx-0 rounded-3xl overflow-hidden card-paper"
      style={{ height: 420, touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onWheel={onWheel}
    >
      <svg viewBox="-260 -260 520 520" className="w-full h-full" style={{ cursor: "grab" }}>
        <defs>
          <filter id="collab-blob-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
        </defs>
        <g ref={svgGroupRef} transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}>
          {/* 協働チームの塊（ぼかし背景・全員共通）。実際のメンバー位置を包む形にして、
              無関係なメンバーのアイコンが塊の中に紛れ込まないようにしている */}
          {teamBlobs.map(({ team, path, circle }) => {
            const picked = highlightTeamId === team.id;
            const common = {
              fill: TEAM_TYPE_META[team.type].color,
              opacity: picked ? 0.34 : 0.16,
              filter: "url(#collab-blob-blur)",
              style: { cursor: "pointer" },
              onClick: () => { if (!panMoved.current) onSelectTeam(team.id); },
            };
            return path ? (
              <path key={`blob-${team.id}`} d={path} {...common} />
            ) : circle ? (
              <circle key={`blob-${team.id}`} cx={circle.cx} cy={circle.cy} r={circle.r} {...common} />
            ) : null;
          })}
          {/* 丸に入れると無関係な人を巻き込んでしまうメンバーは、丸から外して細い線でチームとつなぐ */}
          {teamBlobs.flatMap(({ team, tethers }) =>
            tethers.map((t, i) => (
              <line key={`tether-${team.id}-${i}`} x1={t.from.x} y1={t.from.y} x2={t.to.x} y2={t.to.y}
                stroke={STAGE_META.loose.color} strokeWidth={STAGE_META.loose.width} strokeDasharray={STAGE_META.loose.dash} opacity={0.75} />
            ))
          )}
          {teamBlobs.map(({ team, cx, labelY }) => (
            <text key={`blob-label-${team.id}`} x={cx} textAnchor="middle" y={labelY}
              fontSize="11" fontWeight={700} fill={TEAM_TYPE_META[team.type].color}
              stroke="var(--color-paper-50)" strokeWidth={3} paintOrder="stroke"
              style={{ cursor: "pointer" }}
              textDecoration={highlightTeamId === team.id ? "underline" : undefined}
              onClick={() => { if (!panMoved.current) onSelectTeam(team.id); }}>
              {TEAM_TYPE_META[team.type].icon} {team.name}
            </text>
          ))}

          {/* 全員が見る関係線（自分絡み・第三者同士とも） */}
          {renderEdges.map((e) => {
            const meta = STAGE_META[e.stage];
            return (
              <line
                key={`edge-${e.memberAId}-${e.memberBId}`}
                x1={e.pa.x} y1={e.pa.y} x2={e.pb.x} y2={e.pb.y}
                stroke={meta.color}
                strokeWidth={Math.min(meta.width + e.oneOnOneCount * 0.4, 6)}
                strokeDasharray={meta.dash}
              />
            );
          })}

          {/* 自分ノード */}
          <g onClick={() => onSelect(null)} style={{ cursor: "pointer" }}>
            <circle r={22} fill="var(--color-brand)" />
            <text textAnchor="middle" dy="7" fontSize="18">{graph.nodes.find((n) => n.isMe)?.emoji ?? "😊"}</text>
            <text textAnchor="middle" y={38} fontSize="11" fontWeight={700}
              stroke="var(--color-paper-50)" strokeWidth={3} paintOrder="stroke" fill="var(--color-ink-800)">
              あなた
            </text>
          </g>

          {positions.map((p) => {
            const node = others.find((n) => n.id === p.id)!;
            const sharedEdge = sharedEdgeWithMe.get(p.id);
            const isSelected = selectedId === p.id;
            const isDragging = draggingId === p.id;
            return (
              <g
                key={p.id}
                transform={`translate(${p.x} ${p.y})`}
                {...nodeHandlers(p.id)}
                style={{ cursor: isDragging ? "grabbing" : "pointer", touchAction: "none" }}
                opacity={isDragging ? 0.85 : 1}
              >
                <circle
                  r={isSelected ? 20 : 17}
                  fill={nodeFill(p.id)}
                  stroke={sharedEdge ? STAGE_META[sharedEdge.stage].color : "var(--color-ink-300)"}
                  strokeWidth={isSelected ? 3 : 2}
                />
                <text textAnchor="middle" dy="6" fontSize="16">{node.emoji}</text>
                <text textAnchor="middle" y={32} fontSize="10" fontWeight={600}
                  stroke="var(--color-paper-50)" strokeWidth={3} paintOrder="stroke" fill="var(--color-ink-700)">
                  {node.name}
                </text>
                {sharedEdge && STALLED_META[sharedEdge.stalled] && (
                  <circle cx={13} cy={-13} r={4} fill={STALLED_META[sharedEdge.stalled]!.color} />
                )}
                {pendingByMemberId.has(node.id) && (
                  <text x={13} y={-9} textAnchor="middle" fontSize="12">⏳</text>
                )}
              </g>
            );
          })}

          {/* 人脈レイヤー：所有者ごとに件数バッジを1つだけ表示（個々の人脈は一覧パネルで見る） */}
          {contactBadges.map(({ ownerId, count, x, y }) => (
            <g key={`badge-${ownerId}`} transform={`translate(${x} ${y})`}
              onClick={(e) => { e.stopPropagation(); onSelectOwnerContacts(ownerId); }}
              style={{ cursor: "pointer" }}>
              <rect x={-15} y={-9} width={30} height={18} rx={9}
                fill="var(--color-accent)" stroke="var(--color-paper-50)" strokeWidth={1.5} />
              <text textAnchor="middle" dy="4" fontSize="9" fontWeight={700} fill="white">
                🪪{count > 99 ? "99+" : count}
              </text>
            </g>
          ))}
        </g>
      </svg>

      <div className="absolute top-3 left-3 right-3 flex items-start justify-between pointer-events-none">
        <p className="text-xs font-semibold px-2 py-1 rounded-full" style={{ background: "rgba(250,245,232,0.85)", color: "var(--color-ink-700)" }}>
          白樺チャプター 協働マップ
        </p>
        <p className="text-xs px-2 py-1 rounded-full" style={{ background: "rgba(250,245,232,0.85)", color: "var(--color-ink-500)" }}>
          丸＝なかま／線＝関係の強さ
        </p>
      </div>

      <div className="absolute bottom-3 left-3 rounded-2xl px-3 py-2 flex flex-col gap-1"
        style={{ background: "rgba(250,245,232,0.9)", boxShadow: "0 1px 4px rgba(0,0,0,0.1)" }}>
        {/* 1to1のみ：線ではなくアイコンの縁取りだけで示すため、線の代わりにテキストで示す */}
        <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-ink-600)" }}>
          <span className="w-5 text-center text-[9px] font-medium" style={{ color: STAGE_META.one.color }}>アイコン</span>
          {STAGE_META.one.label}
        </div>
        <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-ink-600)" }}>
          <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4"
            stroke={STAGE_META.seed.color} strokeWidth={STAGE_META.seed.width} strokeDasharray={STAGE_META.seed.dash} /></svg>
          {STAGE_META.seed.label}
        </div>
        {/* 緩いチーム：関係線（点線）とチームの塊（丸）は同じ意味なので1行にまとめる */}
        <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-ink-600)" }}>
          <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4"
            stroke={STAGE_META.loose.color} strokeWidth={STAGE_META.loose.width} strokeDasharray={STAGE_META.loose.dash} /></svg>
          <span className="w-3 h-3 rounded-full inline-block" style={{ background: TEAM_TYPE_META.loose.color, opacity: 0.5 }} />
          緩いチーム
        </div>
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

    <div className="mx-4 lg:mx-0 mt-2 flex items-center justify-between gap-3">
      <p className="text-[11px] leading-snug" style={{ color: saveFailed ? "var(--color-brand)" : "var(--color-ink-500)" }}>
        {saveFailed
          ? "配置を保存できませんでした。通信状況をご確認のうえ、もう一度動かしてみてください。"
          : "✋ 丸はドラッグで動かせます（置いた場所は自動で覚えます）。チームの色の塊をタップすると、下の協働チームが開きます。"}
      </p>
      <button onClick={resetLayout} disabled={resetting}
        className="shrink-0 text-[11px] px-2.5 py-1 rounded-full font-medium transition disabled:opacity-60"
        style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
        {resetting ? "戻しています..." : "↺ 自動の並びに戻す"}
      </button>
    </div>
    </>
  );
}

function NodeDetailPanel({
  node,
  sharedEdge,
  myEdge,
  onClose,
}: {
  node: GraphNode;
  sharedEdge: GraphEdge;
  myEdge: MyEdge | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const meta = STAGE_META[sharedEdge.stage];
  const stalledMeta = STALLED_META[sharedEdge.stalled];

  const togglePossible = useMutation({
    mutationFn: (on: boolean) => api.post("/collab/links/possible", { otherMemberId: node.id, on }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collab", "graph"] }),
  });
  const toggleReferral = useMutation({
    mutationFn: (on: boolean) => api.post("/collab/links/referral", { otherMemberId: node.id, on }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collab", "graph"] }),
  });

  return (
    <div className="px-4 lg:px-0 mt-4">
      <div className="card-paper p-4 relative">
        <button onClick={onClose} className="absolute top-3 right-3 p-1 rounded-full" style={{ background: "var(--color-paper-200)" }}>
          <X size={14} style={{ color: "var(--color-ink-500)" }} />
        </button>
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-11 h-11 rounded-full flex items-center justify-center text-xl shrink-0 ${node.bgColor}`}>{node.emoji}</div>
          <div>
            <p className="font-semibold" style={{ color: "var(--color-ink-800)" }}>{node.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: meta.color + "20", color: meta.color }}>
                {meta.label}
              </span>
              {stalledMeta && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: stalledMeta.color + "20", color: stalledMeta.color }}>
                  {stalledMeta.label}
                </span>
              )}
            </div>
          </div>
        </div>

        <p className="text-xs mb-3" style={{ color: "var(--color-ink-400)" }}>
          1to1 {sharedEdge.oneOnOneCount}回
        </p>

        {myEdge ? (
          <>
            <label className="flex items-center gap-2 py-2 text-sm cursor-pointer" style={{ color: "var(--color-ink-700)" }}>
              <input type="checkbox" checked={myEdge.myPossible}
                onChange={(e) => togglePossible.mutate(e.target.checked)}
                disabled={togglePossible.isPending} />
              🌱 協業・協働の可能性がありそう
              {myEdge.partnerPossible && !myEdge.myPossible && (
                <span className="text-xs" style={{ color: "var(--color-accent)" }}>（相手はチェック済み）</span>
              )}
            </label>
            <label className="flex items-center gap-2 py-2 text-sm cursor-pointer" style={{ color: "var(--color-ink-700)" }}>
              <input type="checkbox" checked={myEdge.myReferral}
                onChange={(e) => toggleReferral.mutate(e.target.checked)}
                disabled={toggleReferral.isPending} />
              🤝 リファーラルを提供できそう
              {myEdge.partnerReferral && !myEdge.myReferral && (
                <span className="text-xs" style={{ color: "var(--color-accent)" }}>（相手はチェック済み）</span>
              )}
            </label>
            <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
              ※どちらのチェックも、お互いがONにすると次の段階に育ちます
            </p>
          </>
        ) : (
          <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
            まだあなたとの直接の関係がありません
          </p>
        )}
      </div>
    </div>
  );
}

/** 人脈をお気に入り登録／解除する（検索結果・人脈一覧で共用） */
function useFavoriteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, favorite }: { contactId: string; favorite: boolean }) =>
      favorite ? api.post(`/collab/contacts/${contactId}/favorite`, {}) : api.delete(`/collab/contacts/${contactId}/favorite`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collab", "graph"] }),
  });
}

/** 人脈1件分の表示＋紹介依頼アクション（一覧パネル・検索パネルの詳細で共用） */
function ContactActionRow({ contact }: { contact: Contact }) {
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [showBusinessDetail, setShowBusinessDetail] = useState(false);
  const favoriteMutation = useFavoriteContact();

  const introRequest = useMutation({
    mutationFn: () => api.post(`/collab/contacts/${contact.id}/intro-request`, { message: message.trim() || undefined }),
    onSuccess: () => setSent(true),
  });

  const style = VISIBILITY_STYLE[contact.visibility];
  return (
    <div className="p-3 rounded-xl" style={{ background: style.bg, borderLeft: `4px solid ${style.border}` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {contact.name ? (
            <>
              <p className="text-sm font-semibold" style={{ color: "var(--color-ink-800)" }}>{contact.name}</p>
              {(contact.specialty || contact.company || contact.relationships.length > 0) && (
                <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
                  {[contact.specialty, contact.company, ...contact.relationships].filter(Boolean).join(" ・ ")}
                </p>
              )}
              {contact.note && <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>{contact.note}</p>}
            </>
          ) : (
            <>
              <p className="text-sm font-semibold" style={{ color: "var(--color-ink-800)" }}>
                {contact.specialty ? `${contact.specialty}の人脈あり` : "人脈あり（非公開）"}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>名前・会社名は非公開です</p>
            </>
          )}
        </div>
        <button
          onClick={() => favoriteMutation.mutate({ contactId: contact.id, favorite: !contact.isFavorite })}
          disabled={favoriteMutation.isPending}
          title={contact.isFavorite ? "お気に入りから外す" : "お気に入りに追加"}
          className="text-lg leading-none shrink-0 disabled:opacity-50">
          {contact.isFavorite ? "⭐️" : "☆"}
        </button>
      </div>

      {contact.businessSummary && (
        <div className="mt-1.5 pt-1.5" style={{ borderTop: "1px dashed var(--color-paper-300)" }}>
          <p className="text-xs font-medium" style={{ color: "var(--color-ink-700)" }}>🏢 {contact.businessSummary}</p>
          {contact.businessSummaryDetail && (
            showBusinessDetail ? (
              <p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: "var(--color-ink-700)" }}>
                {contact.businessSummaryDetail}
              </p>
            ) : (
              <button onClick={() => setShowBusinessDetail(true)}
                className="text-xs mt-1 font-medium underline underline-offset-2" style={{ color: "var(--color-brand)" }}>
                どんな会社か、もっと詳しく見る
              </button>
            )
          )}
        </div>
      )}

      {!contact.mine && !sent && (
        <div className="mt-2">
          <textarea value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="依頼メッセージ（任意）"
            className="w-full px-2 py-1.5 rounded-lg border text-xs resize-none mb-1.5" rows={2}
            style={{ borderColor: "var(--color-paper-300)" }} />
          <button onClick={() => introRequest.mutate()} disabled={introRequest.isPending}
            className="w-full py-1.5 rounded-full text-xs font-medium text-white disabled:opacity-50"
            style={{ background: "var(--color-accent)" }}>
            🙋 紹介依頼する
          </button>
        </div>
      )}
      {sent && <p className="text-xs mt-2 font-medium" style={{ color: "var(--color-success)" }}>紹介依頼を送りました</p>}
    </div>
  );
}

/**
 * 検索結果の1件。「詳細」を押すと、その場でこの人脈1件だけの詳細（ContactActionRowと同じ内容）を開く。
 * 以前は「詳細」を押すと持ち主の人脈が全件表示される仕様で、押した人脈とは無関係な一覧に見えて分かりにくかったため、
 * 押した人脈そのものの詳細をその場に展開する形にした。
 */
function SearchResultRow({ contact, owner, onViewOwnerContacts }: {
  contact: Contact;
  owner: GraphNode | null;
  onViewOwnerContacts: (ownerId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const favoriteMutation = useFavoriteContact();
  const style = VISIBILITY_STYLE[contact.visibility];

  return (
    <div className="p-2.5 rounded-xl" style={{ background: style.bg, borderLeft: `4px solid ${style.border}` }}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
            {owner?.emoji} {owner?.name}さんの人脈
          </p>
          <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>
            {contact.name ?? (contact.specialty ? `${contact.specialty}の人脈` : "人脈あり")}
          </p>
          {(contact.company || (contact.name && contact.specialty) || contact.relationships.length > 0) && (
            <p className="text-xs truncate" style={{ color: "var(--color-ink-500)" }}>
              {[contact.name ? contact.specialty : null, contact.company, ...contact.relationships].filter(Boolean).join(" ・ ")}
            </p>
          )}
          {contact.businessSummary && !expanded && (
            <p className="text-xs mt-0.5 truncate font-medium" style={{ color: "var(--color-ink-700)" }}>
              🏢 {contact.businessSummary}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => favoriteMutation.mutate({ contactId: contact.id, favorite: !contact.isFavorite })}
            disabled={favoriteMutation.isPending}
            title={contact.isFavorite ? "お気に入りから外す" : "お気に入りに追加"}
            className="text-lg leading-none disabled:opacity-50">
            {contact.isFavorite ? "⭐️" : "☆"}
          </button>
          <button onClick={() => setExpanded((v) => !v)}
            className="text-xs px-3 py-1.5 rounded-full font-medium"
            style={{ background: "var(--color-ink-700)", color: "white" }}>
            {expanded ? "閉じる" : "詳細"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-2 pt-2" style={{ borderTop: "1px dashed var(--color-paper-300)" }}>
          <ContactActionRow contact={contact} />
          {owner && (
            <button onClick={() => onViewOwnerContacts(owner.id)}
              className="text-xs mt-2 font-medium underline underline-offset-2" style={{ color: "var(--color-ink-500)" }}>
              {owner.name}さんの人脈をすべて見る
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 人脈レイヤーの結果表示は「地図の件数バッジをクリックした時」「検索した時」のどちらも
 * このパネル1箇所に統一する（以前は別々の場所に表示されて分かりにくかったため）。
 */
function ContactSearchPanel({
  graph,
  activeOwnerId,
  onSelectOwner,
  onClearOwner,
}: {
  graph: GraphResponse["data"];
  activeOwnerId: string | null;
  onSelectOwner: (ownerId: string) => void;
  onClearOwner: () => void;
}) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [selectedSpecialties, setSelectedSpecialties] = useState<Set<string>>(new Set());
  const [selectedRelationships, setSelectedRelationships] = useState<Set<string>>(new Set());
  const [ownerFilterQuery, setOwnerFilterQuery] = useState("");
  const [visibleTagCount, setVisibleTagCount] = useState(10);
  const [visibleRelationshipTagCount, setVisibleRelationshipTagCount] = useState(10);
  const [sortOrder, setSortOrder] = useState<ContactSortOrder>("newest");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [visibleResultCount, setVisibleResultCount] = useState(30);
  const panelRef = useRef<HTMLDivElement>(null);
  // 遅延生成：一度リクエスト済みのIDは同じセッション内で再送しない（バックエンドが冪等なので必須ではないが、通信を減らす）
  const requestedSummaryIdsRef = useRef<Set<string>>(new Set());
  const requestSummariesMutation = useMutation({
    mutationFn: (ids: string[]) => api.post<{ data: { processed: number } }>("/collab/contacts/request-summaries", { ids }),
    onSuccess: (res) => {
      // 生成をトリガーしたものがあれば、少し待ってから一覧を再取得して反映する
      if (res.data.processed > 0) {
        setTimeout(() => qc.invalidateQueries({ queryKey: ["collab", "graph"] }), 4000);
      }
    },
  });
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const activeOwner = activeOwnerId ? nodeById.get(activeOwnerId) ?? null : null;

  useEffect(() => {
    if (activeOwnerId) {
      setQuery("");
      setSelectedSpecialties(new Set());
      setSelectedRelationships(new Set());
      setOwnerFilterQuery("");
      setFavoritesOnly(false);
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [activeOwnerId]);

  // 検索条件・お気に入り絞り込みを切り替えたら、表示件数を30件にリセットする
  useEffect(() => {
    setVisibleResultCount(30);
  }, [query, favoritesOnly, sortOrder, selectedSpecialties, selectedRelationships]);

  const favoriteContacts = useMemo(
    () => sortContacts(graph.contacts.filter((ct) => ct.isFavorite && ct.visibility !== "private"), sortOrder),
    [graph.contacts, sortOrder]
  );

  const specialtyTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ct of graph.contacts) {
      if (!ct.specialty || ct.visibility === "private") continue;
      counts.set(ct.specialty, (counts.get(ct.specialty) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [graph.contacts]);

  const relationshipTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ct of graph.contacts) {
      if (ct.visibility === "private") continue;
      for (const r of ct.relationships) counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [graph.contacts]);

  const visibleSpecialtyTags = specialtyTags.slice(0, visibleTagCount);
  const visibleRelationshipTags = relationshipTags.slice(0, visibleRelationshipTagCount);

  // 専門分野・関係性は別々に複数選択でき、それぞれの選択内はOR、両者の間はANDで絞り込む。
  // 検索ボックスの自由入力（AND/OR構文対応）はさらにANDで重ねがけする。
  const hasFacetOrQuery = query.trim().length > 0 || selectedSpecialties.size > 0 || selectedRelationships.size > 0;

  const searchResults = useMemo(() => {
    if (!hasFacetOrQuery) return [];
    // 非公開の人脈は「人脈をさがす」の対象外（件数・一覧のどちらにも出さない）
    const matched = graph.contacts.filter((ct) => {
      if (ct.visibility === "private") return false;
      if (selectedSpecialties.size > 0 && (!ct.specialty || !selectedSpecialties.has(ct.specialty))) return false;
      if (selectedRelationships.size > 0 && !ct.relationships.some((r) => selectedRelationships.has(r))) return false;
      if (query.trim() && !matchesSearchQuery([ct.specialty, ct.company, ct.name, ...ct.relationships], query)) return false;
      return true;
    });
    return sortContacts(matched, sortOrder);
  }, [graph.contacts, query, sortOrder, selectedSpecialties, selectedRelationships, hasFacetOrQuery]);

  // 通常検索 or お気に入り絞り込み、どちらの一覧を表示中か
  const resultList = favoritesOnly ? favoriteContacts : searchResults;
  const isBrowsingResults = favoritesOnly || hasFacetOrQuery;

  function toggleSpecialtyTag(tag: string) {
    setFavoritesOnly(false);
    setSelectedSpecialties((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  }

  function toggleRelationshipTag(tag: string) {
    setFavoritesOnly(false);
    setSelectedRelationships((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  }

  function clearSearchFilters() {
    setQuery("");
    setSelectedSpecialties(new Set());
    setSelectedRelationships(new Set());
  }

  // 「〜さんの人脈」件数・一覧は非公開の人脈を含めない（本人が自分のバッジを見た場合も同様）
  const ownerContacts = useMemo(
    () => (activeOwnerId ? graph.contacts.filter((ct) => ct.ownerId === activeOwnerId && ct.visibility !== "private") : []),
    [graph.contacts, activeOwnerId]
  );

  const ownerSpecialtyTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ct of ownerContacts) {
      if (!ct.specialty) continue;
      counts.set(ct.specialty, (counts.get(ct.specialty) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [ownerContacts]);

  const filteredOwnerContacts = useMemo(() => {
    if (!ownerFilterQuery.trim()) return ownerContacts;
    return ownerContacts.filter((ct) => matchesSearchQuery([ct.specialty, ct.company, ct.name, ...ct.relationships], ownerFilterQuery));
  }, [ownerContacts, ownerFilterQuery]);

  const shown = resultList.slice(0, visibleResultCount);

  // 遅延生成：実際に画面に表示された人（検索結果／お気に入り／〜さんの人脈）だけ、会社概要の生成をトリガーする。
  // 一度も検索・参照されない人脈にはAIを使わないための仕組み。表示中の一覧が変わるたびに少し待ってから送る（連続入力対策）。
  const visibleForSummaryTrigger = activeOwnerId
    ? filteredOwnerContacts.slice(0, LAZY_SUMMARY_BATCH_LIMIT)
    : (isBrowsingResults ? shown : []);
  const visibleForSummaryTriggerKey = visibleForSummaryTrigger.map((ct) => ct.id).join(",");

  useEffect(() => {
    const targets = visibleForSummaryTrigger.filter(
      (ct) => !ct.businessSummary && !requestedSummaryIdsRef.current.has(ct.id)
    );
    if (targets.length === 0) return;
    const timer = setTimeout(() => {
      const ids = targets.map((ct) => ct.id);
      ids.forEach((id) => requestedSummaryIdsRef.current.add(id));
      requestSummariesMutation.mutate(ids);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleForSummaryTriggerKey]);

  return (
    <div ref={panelRef} className="px-4 lg:px-0 mb-4">
      <div className="card-paper p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
            🔍 人脈をさがす
          </p>
          {activeOwner && (
            <button onClick={onClearOwner} className="text-xs flex items-center gap-1" style={{ color: "var(--color-ink-400)" }}>
              <X size={12} /> 絞り込み解除
            </button>
          )}
        </div>

        {activeOwner ? (
          <>
            <p className="text-sm font-medium mb-1" style={{ color: "var(--color-ink-800)" }}>
              🪪 {activeOwner.emoji} {activeOwner.name}さんの人脈（{ownerContacts.length}件）
            </p>
            <p className="text-xs mb-2" style={{ color: "var(--color-ink-400)" }}>
              連絡先情報は保存されません。紹介できるかどうかは持ち主の判断によります。
            </p>

            {ownerContacts.length > 3 && (
              <>
                <input value={ownerFilterQuery} onChange={(e) => setOwnerFilterQuery(e.target.value)}
                  placeholder="この人の人脈を業種・専門分野・会社名・関係性で絞り込み"
                  className="w-full px-3 py-2 rounded-xl border text-sm mb-2" style={{ borderColor: "var(--color-paper-300)" }} />
                {!ownerFilterQuery && ownerSpecialtyTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {ownerSpecialtyTags.map(([tag, count]) => (
                      <button key={tag} onClick={() => setOwnerFilterQuery(tag)}
                        className="text-xs px-2.5 py-1 rounded-full font-medium"
                        style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                        {tag} {count}
                      </button>
                    ))}
                  </div>
                )}
                {ownerFilterQuery && (
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>{filteredOwnerContacts.length}件に絞り込み中</p>
                    <button onClick={() => setOwnerFilterQuery("")} className="text-xs" style={{ color: "var(--color-ink-400)" }}>絞り込み解除</button>
                  </div>
                )}
              </>
            )}

            {filteredOwnerContacts.length === 0 ? (
              <p className="text-xs py-2" style={{ color: "var(--color-ink-400)" }}>一致する人脈がありません</p>
            ) : (
              <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
                {filteredOwnerContacts.map((ct) => <ContactActionRow key={ct.id} contact={ct} />)}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="relative mb-2">
              <input value={query} onChange={(e) => { setQuery(e.target.value); setFavoritesOnly(false); }}
                placeholder="会社名で検索（AND/ORの検索式も使えます。例: システム開発 OR 税理士）"
                className="w-full px-3 pr-9 py-2 rounded-xl border text-sm" style={{ borderColor: "var(--color-paper-300)" }} />
              {query && (
                <button type="button" onClick={() => setQuery("")}
                  aria-label="検索条件をクリア"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full"
                  style={{ color: "var(--color-ink-400)" }}>
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => { setFavoritesOnly((v) => !v); clearSearchFilters(); }}
                className="text-xs px-2.5 py-1.5 rounded-full font-medium shrink-0"
                style={{ background: favoritesOnly ? "var(--color-accent)" : "var(--color-paper-200)", color: favoritesOnly ? "white" : "var(--color-ink-600)" }}>
                ⭐️ お気に入り（{favoriteContacts.length}）
              </button>
              {isBrowsingResults && (
                <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as ContactSortOrder)}
                  className="flex-1 min-w-0 px-2 py-1.5 rounded-full border text-xs" style={{ borderColor: "var(--color-paper-300)", color: "var(--color-ink-600)" }}>
                  {(Object.keys(CONTACT_SORT_LABEL) as ContactSortOrder[]).map((o) => (
                    <option key={o} value={o}>{CONTACT_SORT_LABEL[o]}</option>
                  ))}
                </select>
              )}
            </div>

            {!favoritesOnly && specialtyTags.length > 0 && (
              <div className="mb-2">
                <p className="text-[11px] mb-1" style={{ color: "var(--color-ink-400)" }}>専門分野で絞り込み（複数選択可）</p>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {visibleSpecialtyTags.map(([tag, count]) => {
                    const active = selectedSpecialties.has(tag);
                    return (
                      <button key={tag} onClick={() => toggleSpecialtyTag(tag)}
                        className="text-xs px-2.5 py-1 rounded-full font-medium"
                        style={{ background: active ? "var(--color-brand)" : "var(--color-paper-200)", color: active ? "white" : "var(--color-ink-600)" }}>
                        {tag} {count}
                      </button>
                    );
                  })}
                  {visibleTagCount < specialtyTags.length && (
                    <button onClick={() => setVisibleTagCount((n) => n + 10)}
                      className="text-xs px-2.5 py-1 rounded-full font-medium"
                      style={{ background: "var(--color-ink-700)", color: "white" }}>
                      さらに表示
                    </button>
                  )}
                </div>
              </div>
            )}

            {!favoritesOnly && relationshipTags.length > 0 && (
              <div className="mb-2">
                <p className="text-[11px] mb-1" style={{ color: "var(--color-ink-400)" }}>関係性で絞り込み（複数選択可）</p>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {visibleRelationshipTags.map(([tag, count]) => {
                    const active = selectedRelationships.has(tag);
                    return (
                      <button key={tag} onClick={() => toggleRelationshipTag(tag)}
                        className="text-xs px-2.5 py-1 rounded-full font-medium"
                        style={{ background: active ? "var(--color-accent)" : "var(--color-paper-200)", color: active ? "white" : "var(--color-ink-600)" }}>
                        {tag} {count}
                      </button>
                    );
                  })}
                  {visibleRelationshipTagCount < relationshipTags.length && (
                    <button onClick={() => setVisibleRelationshipTagCount((n) => n + 10)}
                      className="text-xs px-2.5 py-1 rounded-full font-medium"
                      style={{ background: "var(--color-ink-700)", color: "white" }}>
                      さらに表示
                    </button>
                  )}
                </div>
              </div>
            )}

            {!favoritesOnly && specialtyTags.length === 0 && relationshipTags.length === 0 && (
              <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>まだ検索できる人脈がありません</p>
            )}

            {!favoritesOnly && (query.trim() || selectedSpecialties.size > 0 || selectedRelationships.size > 0) && (
              <p className="text-xs mb-1">
                <button type="button" onClick={clearSearchFilters} className="underline" style={{ color: "var(--color-brand)" }}>
                  絞り込みを解除
                </button>
              </p>
            )}

            {isBrowsingResults && (
              shown.length === 0 ? (
                <p className="text-xs py-2" style={{ color: "var(--color-ink-400)" }}>
                  {favoritesOnly ? "お気に入りに登録した人脈がありません" : "見つかりませんでした"}
                </p>
              ) : (
                <div className="flex flex-col gap-2 mt-2 max-h-80 overflow-y-auto">
                  <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>{resultList.length}件が見つかりました</p>
                  {shown.map((ct) => (
                    <SearchResultRow key={ct.id} contact={ct} owner={nodeById.get(ct.ownerId) ?? null} onViewOwnerContacts={onSelectOwner} />
                  ))}
                  {resultList.length > shown.length && (
                    <button onClick={() => setVisibleResultCount((n) => n + 30)}
                      className="text-xs py-2 rounded-full font-medium text-center"
                      style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                      続きを表示（あと{resultList.length - shown.length}件）
                    </button>
                  )}
                </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}

type TeamActionItem = {
  id: string; task: string; assigneeMemberId: string | null;
  assignee: { id: string; name: string; emoji: string } | null;
  dueDate: string | null; visibility: "team" | "chapter" | "private"; completed: boolean; createdAt: number;
};

const ACTION_VISIBILITY_SHORT_LABEL: Record<TeamActionItem["visibility"], string> = { chapter: "📢公開", team: "🏠チーム内", private: "🔒非公開" };

function TeamActionItemsChecklist({ teamId, members, canEdit }: { teamId: string; members: TeamMember[]; canEdit: boolean }) {
  const qc = useQueryClient();
  const queryKey = ["collab", "team-action-items", teamId];
  const { data } = useQuery<{ data: TeamActionItem[] }>({
    queryKey,
    queryFn: () => api.get(`/collab/teams/${teamId}/action-items`),
  });
  const items = data?.data ?? [];
  const activeMembers = members.filter((m) => m.status === "active");

  const toggle = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) => api.patch(`/collab/team-action-items/${id}`, { completed }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/collab/team-action-items/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const [newTask, setNewTask] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newVisibility, setNewVisibility] = useState<TeamActionItem["visibility"]>("team");
  const add = useMutation({
    mutationFn: () => api.post("/collab/team-action-items", {
      teamId, task: newTask.trim(),
      assigneeMemberId: newAssignee || undefined,
      dueDate: newDueDate || undefined,
      visibility: newVisibility,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      setNewTask(""); setNewAssignee(""); setNewDueDate(""); setNewVisibility("team");
    },
  });

  return (
    <div className="mb-3 pb-3" style={{ borderBottom: "1px solid var(--color-paper-300)" }}>
      <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--color-ink-600)" }}>📋 次回までのアクション</p>
      {items.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-start gap-1.5 text-xs">
              <input type="checkbox" checked={item.completed} disabled={!canEdit} className="mt-0.5 shrink-0"
                onChange={(e) => toggle.mutate({ id: item.id, completed: e.target.checked })} />
              <div className="flex-1 min-w-0">
                <span style={{
                  color: item.completed ? "var(--color-ink-400)" : "var(--color-ink-700)",
                  textDecoration: item.completed ? "line-through" : "none",
                }}>
                  {item.task}
                </span>
                <span className="ml-1.5" style={{ color: "var(--color-ink-400)" }}>
                  {item.assignee && `${item.assignee.emoji}${item.assignee.name} ・ `}
                  {item.dueDate && `〜${item.dueDate} ・ `}
                  {ACTION_VISIBILITY_SHORT_LABEL[item.visibility]}
                </span>
              </div>
              {canEdit && (
                <button onClick={() => remove.mutate(item.id)} className="shrink-0" style={{ color: "var(--color-ink-300)" }} aria-label="削除">
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {!canEdit && items.length === 0 && (
        <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>アクションはありません</p>
      )}
      {canEdit && (
        <div className="rounded-xl p-2 space-y-1.5" style={{ background: "var(--color-paper-100)" }}>
          <div className="flex items-center gap-1.5">
            <input type="text" value={newTask} onChange={(e) => setNewTask(e.target.value)}
              placeholder="新しいアクションを追加"
              className="flex-1 min-w-0 px-2 py-1.5 rounded-lg text-xs outline-none border"
              style={{ borderColor: "var(--color-paper-300)", background: "#fff", color: "var(--color-ink-900)" }} />
            <button onClick={() => newTask.trim() && add.mutate()} disabled={!newTask.trim() || add.isPending}
              className="p-1.5 rounded-lg shrink-0 disabled:opacity-40" style={{ background: "var(--color-brand)", color: "white" }} aria-label="追加">
              <Plus size={13} />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <select value={newAssignee} onChange={(e) => setNewAssignee(e.target.value)}
              className="flex-1 min-w-0 px-2 py-1.5 rounded-lg text-xs outline-none border"
              style={{ borderColor: "var(--color-paper-300)", background: "#fff", color: "var(--color-ink-700)" }}>
              <option value="">👤 担当者</option>
              {activeMembers.map((m) => <option key={m.id} value={m.id}>{m.emoji} {m.name}</option>)}
            </select>
            <input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)}
              className="w-[124px] shrink-0 px-2 py-1.5 rounded-lg text-xs outline-none border"
              style={{ borderColor: "var(--color-paper-300)", background: "#fff", color: "var(--color-ink-700)" }} />
          </div>
          <select value={newVisibility} onChange={(e) => setNewVisibility(e.target.value as TeamActionItem["visibility"])}
            className="w-full px-2 py-1.5 rounded-lg text-xs outline-none border"
            style={{ borderColor: "var(--color-paper-300)", background: "#fff", color: "var(--color-ink-700)" }}>
            <option value="team">🏠 チーム内のみ</option>
            <option value="chapter">📢 チャプター公開</option>
            <option value="private">🔒 非公開</option>
          </select>
        </div>
      )}
    </div>
  );
}

function CollabTeamsList({ teams, meId, candidateMembers, expandedId, onExpandedChange: setExpandedId, scrollNonce }: {
  teams: GraphTeam[]; meId: string; candidateMembers: { id: string; name: string; emoji: string; bgColor: string }[];
  expandedId: string | null; onExpandedChange: (id: string | null) => void;
  /** マップ上でチームを選ぶたびに増える。増えたら、開いているチームの位置までスクロールする */
  scrollNonce: number;
}) {
  const qc = useQueryClient();
  useEffect(() => {
    if (scrollNonce === 0 || !expandedId) return;
    document.getElementById(`collab-team-${expandedId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollNonce]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [invitingTeamId, setInvitingTeamId] = useState<string | null>(null);
  const [transferringTeamId, setTransferringTeamId] = useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["collab", "graph"] });

  const respond = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) => api.post(`/collab/teams/${id}/respond`, { accept }),
    onSuccess: invalidate,
  });
  const leave = useMutation({
    mutationFn: (id: string) => api.post(`/collab/teams/${id}/leave`, {}),
    onSuccess: () => { invalidate(); setExpandedId(null); },
  });
  const disband = useMutation({
    mutationFn: (id: string) => api.delete(`/collab/teams/${id}`),
    onSuccess: () => { invalidate(); setExpandedId(null); },
  });
  const removeMember = useMutation({
    mutationFn: ({ teamId, memberId }: { teamId: string; memberId: string }) => api.post(`/collab/teams/${teamId}/members/${memberId}/remove`, {}),
    onSuccess: invalidate,
  });
  const approveJoin = useMutation({
    mutationFn: ({ teamId, memberId }: { teamId: string; memberId: string }) => api.post(`/collab/teams/${teamId}/members/${memberId}/approve`, {}),
    onSuccess: invalidate,
  });
  const rejectJoin = useMutation({
    mutationFn: ({ teamId, memberId }: { teamId: string; memberId: string }) => api.post(`/collab/teams/${teamId}/members/${memberId}/reject`, {}),
    onSuccess: invalidate,
  });
  const promote = useMutation({
    mutationFn: (id: string) => api.post(`/collab/teams/${id}/promote`, {}),
    onSuccess: invalidate,
  });
  const pause = useMutation({
    mutationFn: (id: string) => api.post(`/collab/teams/${id}/pause`, {}),
    onSuccess: invalidate,
  });
  const resume = useMutation({
    mutationFn: (id: string) => api.post(`/collab/teams/${id}/resume`, {}),
    onSuccess: invalidate,
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.patch(`/collab/teams/${id}`, { name }),
    onSuccess: () => { invalidate(); setRenamingId(null); },
  });

  if (teams.length === 0) {
    return <p className="text-sm" style={{ color: "var(--color-ink-400)" }}>まだ協働チームがありません</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {teams.map((t) => {
        const isCreator = t.createdBy === meId;
        const isExpanded = expandedId === t.id;
        const existingMemberIds = new Set(t.members.map((m) => m.id));
        return (
          <div key={t.id} id={`collab-team-${t.id}`} className="card-paper px-4 py-3"
            style={isExpanded ? { boxShadow: `0 0 0 2px ${TEAM_TYPE_META[t.type].color}` } : undefined}>
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
                      {t.type === "power" ? "⚡" : "🌿"} {t.name}
                    </span>
                    <span className="ml-2 text-xs" style={{ color: "var(--color-ink-400)" }}>
                      {t.type === "power" ? "パワーチーム" : "緩いチーム"}
                    </span>
                    {t.archived && (
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full" style={{ background: "var(--color-paper-300)", color: "var(--color-ink-500)" }}>
                        ⏸休止中
                      </span>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                {t.myStatus === "pending" ? (
                  <div className="flex gap-2">
                    <button onClick={() => respond.mutate({ id: t.id, accept: true })}
                      className="text-xs px-3 py-1 rounded-full font-medium text-white" style={{ background: "var(--color-success)" }}>
                      承諾
                    </button>
                    <button onClick={() => respond.mutate({ id: t.id, accept: false })}
                      className="text-xs px-3 py-1 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                      辞退
                    </button>
                  </div>
                ) : t.myStatus === "active" ? (
                  <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>参加中</span>
                ) : (
                  <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>他のメンバーのチーム</span>
                )}
                {/* メンバー確認は誰でも可能。除名・脱退・解散などの操作のみ、下記で権限に応じて絞る */}
                <button onClick={() => setExpandedId(isExpanded ? null : t.id)}
                  className="text-xs px-2 py-1 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
                  {isExpanded ? "閉じる" : isCreator || t.myStatus === "active" ? "管理" : "メンバーを見る"}
                </button>
              </div>
            </div>

            {isExpanded && (
              <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--color-paper-300)" }}>
                <div className="flex flex-col gap-1.5 mb-3">
                  {t.members.map((m) => {
                    const isSelfJoinRequest = m.status === "pending" && m.invitedBy === null;
                    return (
                      <div key={m.id} className="flex items-center justify-between text-xs gap-2">
                        <span style={{ color: "var(--color-ink-700)" }}>
                          {m.emoji} {m.name}
                          {m.id === t.createdBy && "（作成者）"}
                          {m.status === "pending" && (isSelfJoinRequest ? "（参加希望）" : "（招待中）")}
                        </span>
                        <div className="flex gap-1 shrink-0">
                          {isCreator && isSelfJoinRequest && (
                            <>
                              <button onClick={() => approveJoin.mutate({ teamId: t.id, memberId: m.id })}
                                className="text-xs px-2 py-0.5 rounded-full text-white" style={{ background: "var(--color-success)" }}>
                                承認
                              </button>
                              <button onClick={() => rejectJoin.mutate({ teamId: t.id, memberId: m.id })}
                                className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
                                却下
                              </button>
                            </>
                          )}
                          {isCreator && m.id !== meId && (
                            <button onClick={() => { if (confirm(`${m.name}さんをチームから除名しますか？`)) removeMember.mutate({ teamId: t.id, memberId: m.id }); }}
                              className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-brand)" }}>
                              除名
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <TeamActionItemsChecklist teamId={t.id} members={t.members} canEdit={t.myStatus === "active"} />
                <div className="flex flex-wrap gap-2">
                  {t.myStatus === "active" && (
                    <button onClick={() => { if (confirm(`「${t.name}」から脱退しますか？`)) leave.mutate(t.id); }}
                      className="text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                      脱退する
                    </button>
                  )}
                  {isCreator && (
                    <button onClick={() => setInvitingTeamId(t.id)}
                      className="text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                      ＋メンバーを招待
                    </button>
                  )}
                  {isCreator && t.type === "loose" && (
                    <button onClick={() => { if (confirm(`「${t.name}」をパワーチームに昇格しますか？`)) promote.mutate(t.id); }}
                      className="text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-accent)" }}>
                      ⚡パワーチームに昇格
                    </button>
                  )}
                  {isCreator && (
                    t.archived ? (
                      <button onClick={() => resume.mutate(t.id)}
                        className="text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-success)" }}>
                        ▶活動を再開する
                      </button>
                    ) : (
                      <button onClick={() => { if (confirm(`「${t.name}」の活動を休止しますか？（解散はしません。いつでも再開できます）`)) pause.mutate(t.id); }}
                        className="text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                        ⏸活動を休止する
                      </button>
                    )
                  )}
                  {isCreator && (
                    <button onClick={() => { setRenamingId(t.id); setRenameDraft(t.name); }}
                      className="text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                      チーム名を変更
                    </button>
                  )}
                  {isCreator && t.members.filter((m) => m.status === "active" && m.id !== meId).length > 0 && (
                    <button onClick={() => setTransferringTeamId(t.id)}
                      className="text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                      リーダーを引き継ぐ
                    </button>
                  )}
                  {isCreator && (
                    <button onClick={() => { if (confirm(`「${t.name}」を解散しますか？この操作は取り消せません。`)) disband.mutate(t.id); }}
                      className="text-xs px-3 py-1.5 rounded-full font-medium text-white" style={{ background: "var(--color-brand)" }}>
                      チームを解散する
                    </button>
                  )}
                </div>
              </div>
            )}

            {invitingTeamId === t.id && (
              <InviteTeamMembersModal
                teamId={t.id}
                candidateMembers={candidateMembers.filter((m) => !existingMemberIds.has(m.id))}
                onClose={() => setInvitingTeamId(null)}
              />
            )}
            {transferringTeamId === t.id && (
              <TransferLeaderModal
                teamId={t.id}
                candidates={t.members.filter((m) => m.status === "active" && m.id !== meId)}
                onClose={() => setTransferringTeamId(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function InviteTeamMembersModal({ teamId, candidateMembers, onClose }: {
  teamId: string; candidateMembers: { id: string; name: string; emoji: string; bgColor: string }[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const invite = useMutation({
    mutationFn: () => api.post<{ data: { invited: number } }>(`/collab/teams/${teamId}/invite`, { memberIds: selected }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collab", "graph"] });
      setDone(true);
    },
    onError: (e: Error) => setError(e.message || "招待に失敗しました"),
  });

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          メンバーを招待する
        </h2>
        {done ? (
          <>
            <p className="text-sm mb-4" style={{ color: "var(--color-ink-700)" }}>
              招待を送りました。承諾されるとチームに加わります。
            </p>
            <button onClick={onClose} className="w-full py-2.5 rounded-2xl text-sm text-white" style={{ background: "var(--color-brand)" }}>閉じる</button>
          </>
        ) : (
          <>
            {candidateMembers.length === 0 ? (
              <p className="text-sm mb-4" style={{ color: "var(--color-ink-400)" }}>招待できるメンバーがいません</p>
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
              <button onClick={() => { setError(""); if (selected.length === 0) { setError("招待するメンバーを選んでください"); return; } invite.mutate(); }}
                disabled={invite.isPending || candidateMembers.length === 0}
                className="flex-1 py-2.5 rounded-2xl text-sm text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
                招待する
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TransferLeaderModal({ teamId, candidates, onClose }: {
  teamId: string; candidates: TeamMember[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const transfer = useMutation({
    mutationFn: () => api.post(`/collab/teams/${teamId}/transfer-leader`, { newLeaderId: selectedId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["collab", "graph"] }); onClose(); },
    onError: (e: Error) => setError(e.message || "引き継ぎに失敗しました"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          リーダーを引き継ぐ
        </h2>
        <p className="text-xs mb-4" style={{ color: "var(--color-ink-400)" }}>
          引き継ぎ後は、除名・解散などの操作ができなくなります。
        </p>
        <div className="max-h-64 overflow-y-auto space-y-1 rounded-xl p-2 mb-4" style={{ background: "var(--color-paper-200)" }}>
          {candidates.map((m) => (
            <label key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:opacity-80">
              <input type="radio" name="new-leader" checked={selectedId === m.id} onChange={() => setSelectedId(m.id)} />
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 ${m.bgColor}`}>{m.emoji}</span>
              <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>{m.name}</span>
            </label>
          ))}
        </div>
        {error && <p className="text-xs mb-3" style={{ color: "var(--color-brand)" }}>{error}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl text-sm"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button onClick={() => { setError(""); if (!selectedId) { setError("引き継ぎ先を選んでください"); return; } if (confirm("本当に引き継ぎますか？")) transfer.mutate(); }}
            disabled={transfer.isPending}
            className="flex-1 py-2.5 rounded-2xl text-sm text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
            引き継ぐ
          </button>
        </div>
      </div>
    </div>
  );
}
