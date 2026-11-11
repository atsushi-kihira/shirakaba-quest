// =============================================================
// 週表示（時間軸つき）で、同じ時間帯に重なる予定を、横に並べて配置するための計算
// 分は「その日の0時からの分」（0〜1440）で扱う
// =============================================================

export type Placed<T> = T & { lane: number; lanes: number };

/**
 * 時間が重なる予定をグループにして、グループの中で左から順に列（lane）を割り当てる。
 * 戻り値の lanes は、そのグループの列の数（幅を 1/lanes にする）。
 */
export function layoutLanes<T extends { startMin: number; endMin: number }>(items: T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const out: Placed<T>[] = [];
  let cluster: Placed<T>[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    for (const it of cluster) it.lanes = Math.max(1, laneEnds.length);
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  };

  for (const it of sorted) {
    if (cluster.length > 0 && it.startMin >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= it.startMin);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.endMin); } else laneEnds[lane] = it.endMin;
    cluster.push({ ...it, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  flush();
  return out;
}

/** 予定（unix秒）の、ある1日の中の分（0〜1440）。その日にかからないときは null */
export function segmentInDay(startSec: number, endSec: number, dayStart: number, dayEnd: number): { startMin: number; endMin: number } | null {
  const s = Math.max(startSec, dayStart);
  const e = Math.min(Math.max(endSec, startSec + 60), dayEnd);
  if (e <= dayStart || s >= dayEnd) return null;
  return { startMin: Math.round((s - dayStart) / 60), endMin: Math.max(Math.round((e - dayStart) / 60), Math.round((s - dayStart) / 60) + 1) };
}
