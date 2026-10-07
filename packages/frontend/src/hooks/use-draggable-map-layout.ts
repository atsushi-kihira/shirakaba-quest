// =============================================================
// 協働マップのアイコン配置（ドラッグで移動・位置の記録・微調整・リセット）
// メンバー向けマップ（自分中心）と管理画面のマップ（組織全体）で共通に使う。
//
// ・保存済みの位置を基本にする。新しく増えたメンバーだけ自動配置の位置から始める
// ・メンバーやチームの顔ぶれが変わったときだけ、重なりなどを1回につき少しだけずらして保存する
// ・アイコンはドラッグで動かせ、置いた位置は自動で記録される
// =============================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { type LayoutPoint, nudgeLayout } from "@/lib/collab-layout";

type SavedPosition = { nodeId: string; x: number; y: number; userPlaced: boolean };
type MapPositionsResponse = { data: { positions: SavedPosition[] } };

type LayoutTeam = { id: string; type: string; archived: boolean; members: { id: string }[] };
type Point = { x: number; y: number };

export function useDraggableMapLayout(args: {
  /** 保存先のAPI（例: "/collab/map-positions"） */
  endpoint: string;
  /** 位置を決める対象のノード（中心に固定する「あなた」は含めない） */
  nodes: { id: string }[];
  /** 保存済みの位置がない人の、自動配置での位置 */
  autoPositions: { id: string; x: number; y: number }[];
  teams: LayoutTeam[];
  /** 原点（0,0）に固定のアイコンがあるか（メンバー向けマップの「あなた」） */
  centerFixed: boolean;
  /** タップ（ドラッグではない操作）されたとき */
  onSelect: (id: string) => void;
}) {
  const { endpoint, nodes, autoPositions, teams, centerFixed, onSelect } = args;
  const qc = useQueryClient();
  const queryKey = ["collab", "map-positions", endpoint];

  // 開いている間に別の値へ差し替わってアイコンが勝手に動かないよう、保存済みの配置は再取得しない
  const savedQ = useQuery({
    queryKey,
    queryFn: () => api.get<MapPositionsResponse>(endpoint),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const [layout, setLayout] = useState<Map<string, LayoutPoint> | null>(null);
  const [dragging, setDragging] = useState<{ id: string; x: number; y: number } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [resetting, setResetting] = useState(false);
  const layoutRef = useRef<Map<string, LayoutPoint> | null>(null);
  const persistedRef = useRef<Map<string, LayoutPoint>>(new Map()); // サーバーに保存済みと分かっている配置
  const processedKeyRef = useRef<string | null>(null);
  const svgGroupRef = useRef<SVGGElement>(null);
  const nodeDrag = useRef<{
    id: string; startClientX: number; startClientY: number; offX: number; offY: number; moved: boolean; last: Point | null;
  } | null>(null);
  const currentPositions = useRef<Map<string, Point>>(new Map());

  const structureKey = useMemo(() => {
    const teamKey = teams
      .filter((t) => !t.archived && (t.type === "power" || t.type === "loose"))
      .map((t) => `${t.id}:${t.members.map((m) => m.id).sort().join(",")}`)
      .sort()
      .join("|");
    return `${nodes.map((n) => n.id).sort().join(",")}#${teamKey}`;
  }, [nodes, teams]);

  function savePositions(items: { nodeId: string; x: number; y: number; userPlaced: boolean }[]): void {
    if (items.length === 0) return;
    for (const it of items) persistedRef.current.set(it.nodeId, { x: it.x, y: it.y, placed: it.userPlaced });
    for (let i = 0; i < items.length; i += 400) {
      const chunk = items.slice(i, i + 400);
      api.put(endpoint, { positions: chunk })
        .then(() => setSaveFailed(false))
        .catch(() => {
          for (const it of chunk) persistedRef.current.delete(it.nodeId);
          setSaveFailed(true);
        });
    }
  }

  function recomputeLayout(persist: boolean): void {
    const prior = layoutRef.current;
    const autoById = new Map(autoPositions.map((p) => [p.id, p]));
    const baseline = new Map<string, LayoutPoint>();
    const newIds = new Set<string>();
    for (const n of nodes) {
      const known = prior?.get(n.id) ?? persistedRef.current.get(n.id);
      if (known) {
        baseline.set(n.id, { x: known.x, y: known.y, placed: known.placed });
      } else {
        const auto = autoById.get(n.id);
        if (!auto) continue;
        baseline.set(n.id, { x: auto.x, y: auto.y, placed: false });
        newIds.add(n.id);
      }
    }
    const teamMemberIds = teams
      .filter((t) => !t.archived && (t.type === "power" || t.type === "loose"))
      .map((t) => t.members.map((m) => m.id).filter((id) => baseline.has(id)));
    const resolved = nudgeLayout(baseline, newIds, teamMemberIds, { centerFixed });
    layoutRef.current = resolved;
    setLayout(resolved);

    if (!persist) return;
    const changed: { nodeId: string; x: number; y: number; userPlaced: boolean }[] = [];
    for (const [id, p] of resolved) {
      const saved = persistedRef.current.get(id);
      if (!saved || Math.abs(saved.x - p.x) > 0.5 || Math.abs(saved.y - p.y) > 0.5 || saved.placed !== p.placed) {
        changed.push({ nodeId: id, x: p.x, y: p.y, userPlaced: p.placed });
      }
    }
    savePositions(changed);
  }

  useEffect(() => {
    if (savedQ.isPending) return; // 保存済みの配置を読み込み終えてから並べる
    if (processedKeyRef.current === structureKey && layoutRef.current) return;
    if (processedKeyRef.current === null) {
      persistedRef.current = new Map(
        (savedQ.data?.data.positions ?? []).map((p) => [p.nodeId, { x: p.x, y: p.y, placed: p.userPlaced }])
      );
    }
    processedKeyRef.current = structureKey;
    recomputeLayout(savedQ.isSuccess);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, savedQ.isPending, savedQ.isSuccess]);

  async function resetLayout(): Promise<void> {
    if (!window.confirm("アイコンの配置を、自動の並びに戻しますか？\n（動かした位置の記録は消えます）")) return;
    setResetting(true);
    try {
      await api.delete(endpoint);
      persistedRef.current = new Map();
      layoutRef.current = null;
      setSaveFailed(false);
      recomputeLayout(true);
      qc.removeQueries({ queryKey });
    } catch {
      setSaveFailed(true);
    } finally {
      setResetting(false);
    }
  }

  const positions = useMemo(() => {
    if (!layout) return [];
    return nodes.flatMap((n) => {
      const p = dragging && dragging.id === n.id ? dragging : layout.get(n.id);
      return p ? [{ id: n.id, x: p.x, y: p.y }] : [];
    });
  }, [layout, nodes, dragging]);
  currentPositions.current = new Map(positions.map((p) => [p.id, { x: p.x, y: p.y }]));

  // 画面上の座標 → マップ内（拡大・移動を取り除いた）の座標
  function toWorld(clientX: number, clientY: number): Point | null {
    const g = svgGroupRef.current;
    const m = g?.getScreenCTM();
    if (!g || !m) return null;
    const pt = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: pt.x, y: pt.y };
  }

  /** アイコン1つぶんのドラッグ用イベント（<g> に展開して使う） */
  function nodeHandlers(id: string) {
    return {
      onPointerDown: (e: React.PointerEvent<SVGGElement>) => {
        e.stopPropagation(); // 背景のドラッグ（マップ全体の移動）とは分ける
        const w = toWorld(e.clientX, e.clientY);
        const cur = currentPositions.current.get(id);
        if (!w || !cur) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        nodeDrag.current = { id, startClientX: e.clientX, startClientY: e.clientY, offX: cur.x - w.x, offY: cur.y - w.y, moved: false, last: null };
      },
      onPointerMove: (e: React.PointerEvent<SVGGElement>) => {
        const d = nodeDrag.current;
        if (!d || d.id !== id) return;
        e.stopPropagation();
        // 指がわずかに動いただけのタップは「選択」として扱う
        if (!d.moved && Math.hypot(e.clientX - d.startClientX, e.clientY - d.startClientY) < 6) return;
        d.moved = true;
        const w = toWorld(e.clientX, e.clientY);
        if (!w) return;
        const x = Math.max(-480, Math.min(480, w.x + d.offX));
        const y = Math.max(-480, Math.min(480, w.y + d.offY));
        d.last = { x, y };
        setDragging({ id, x, y });
      },
      onPointerUp: (e: React.PointerEvent<SVGGElement>) => {
        const d = nodeDrag.current;
        nodeDrag.current = null;
        if (!d || d.id !== id) return;
        e.stopPropagation();
        if (!d.moved || !d.last) {
          onSelect(id);
          return;
        }
        const { x, y } = d.last;
        const next = new Map(layoutRef.current ?? []);
        next.set(id, { x, y, placed: true });
        layoutRef.current = next;
        setLayout(next);
        setDragging(null);
        savePositions([{ nodeId: id, x, y, userPlaced: true }]);
      },
      onPointerCancel: () => {
        nodeDrag.current = null;
        setDragging(null);
      },
    };
  }

  return { positions, draggingId: dragging?.id ?? null, svgGroupRef, nodeHandlers, saveFailed, resetting, resetLayout };
}
