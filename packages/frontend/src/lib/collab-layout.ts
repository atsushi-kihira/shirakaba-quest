// =============================================================
// 協働マップのアイコン配置：保存済みの位置を土台に「微量だけ」整える
//
// ・保存済みの位置が基本。新しいメンバー（保存位置なし）は自動配置の位置から始める
// ・アイコン同士が重なる／チームの塊に関係ない人が入り込む場合は、少しずつ位置をずらす
// ・1回の調整でずれる距離には上限があり、一気に別の場所へ動くことはない
// ・自分でドラッグして置いたアイコン（placed）はほとんど動かさない
// =============================================================

export type LayoutPoint = { x: number; y: number; placed: boolean };

type Mutable = { x: number; y: number };

/** 重ならないために保つ中心間の最小距離（アイコン直径＋名前ラベルの余白） */
const MIN_NODE_DISTANCE = 46;
/** 「あなた」のアイコンとの最小距離 */
const MIN_SELF_DISTANCE = 52;

/** 1回の調整で、元の位置から動かしてよい最大距離 */
const CAP_NEW = 90;       // 今回初めて配置する人（まだ誰の記憶にもない位置なので広めに）
const CAP_AUTO = 18;      // 自動配置のまま保存されていた人
const CAP_PLACED = 10;    // 本人がドラッグして置いた人

/** 重なり解消時の「動きやすさ」（大きいほど優先して動く） */
const MOBILITY_NEW = 1;
const MOBILITY_AUTO = 0.6;
const MOBILITY_PLACED = 0.15;

/** チームの仲間が中心から離れすぎているときに、1回で寄せる最大距離と、許容する広がり */
const COHESION_STEP = 12;
const COHESION_RADIUS = 70;
/** チームの外の人がチームの塊に入り込んでいるとき、1回で押し出す最大距離 */
const PUSH_STEP = 12;
const TEAM_PAD = 34;

const OVERLAP_PASSES = 10;

function capOf(p: LayoutPoint, isNew: boolean): number {
  if (isNew) return CAP_NEW;
  return p.placed ? CAP_PLACED : CAP_AUTO;
}
function mobilityOf(p: LayoutPoint, isNew: boolean): number {
  if (isNew) return MOBILITY_NEW;
  return p.placed ? MOBILITY_PLACED : MOBILITY_AUTO;
}

/**
 * base: これまでの配置（新規メンバーは自動配置の位置を入れておく）
 * newIds: base のうち、今回初めて配置するメンバーのID
 * teams: チームごとのメンバーID（「あなた」は含めない）
 * 戻り値: 微調整後の配置（placed の値はそのまま引き継ぐ）
 */
export function nudgeLayout(
  base: Map<string, LayoutPoint>,
  newIds: Set<string>,
  teams: string[][]
): Map<string, LayoutPoint> {
  const ids = [...base.keys()].sort();
  const origin = new Map<string, Mutable>();
  const cur = new Map<string, Mutable>();
  for (const id of ids) {
    const p = base.get(id)!;
    origin.set(id, { x: p.x, y: p.y });
    cur.set(id, { x: p.x, y: p.y });
  }

  // 元の位置からの移動距離が上限を超えないように動かす
  function move(id: string, dx: number, dy: number): void {
    const p = base.get(id)!;
    const o = origin.get(id)!;
    const c = cur.get(id)!;
    let nx = c.x + dx;
    let ny = c.y + dy;
    const cap = capOf(p, newIds.has(id));
    const dist = Math.hypot(nx - o.x, ny - o.y);
    if (dist > cap) {
      nx = o.x + ((nx - o.x) / dist) * cap;
      ny = o.y + ((ny - o.y) / dist) * cap;
    }
    c.x = nx;
    c.y = ny;
  }

  // 1) チームのまとまり：離れすぎている仲間を少し寄せ、塊に入り込んだ他の人を少し押し出す
  //    （本人が置いたアイコンは動かさない）
  for (const teamIds of teams) {
    const members = teamIds.filter((id) => cur.has(id));
    if (members.length < 2) continue;
    const cx = members.reduce((s, id) => s + cur.get(id)!.x, 0) / members.length;
    const cy = members.reduce((s, id) => s + cur.get(id)!.y, 0) / members.length;
    const memberSet = new Set(members);
    let blobR = 0;

    for (const id of members) {
      const p = cur.get(id)!;
      const d = Math.hypot(p.x - cx, p.y - cy);
      blobR = Math.max(blobR, d);
      if (base.get(id)!.placed || d <= COHESION_RADIUS) continue;
      const step = Math.min(COHESION_STEP, d - COHESION_RADIUS);
      move(id, ((cx - p.x) / d) * step, ((cy - p.y) / d) * step);
    }
    // 寄せたあとの広がりで、塊に入り込んでいる人を判定する
    blobR = Math.max(
      ...members.map((id) => Math.hypot(cur.get(id)!.x - cx, cur.get(id)!.y - cy))
    ) + TEAM_PAD;

    for (const id of ids) {
      if (memberSet.has(id) || base.get(id)!.placed) continue;
      const p = cur.get(id)!;
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d >= blobR) continue;
      const dirX = d > 0.01 ? (p.x - cx) / d : 1;
      const dirY = d > 0.01 ? (p.y - cy) / d : 0;
      move(id, dirX * Math.min(PUSH_STEP, blobR - d), dirY * Math.min(PUSH_STEP, blobR - d));
    }
  }

  // 2) 重なりの解消：近すぎる2人を、動きやすさに応じて分け合って離す
  for (let pass = 0; pass < OVERLAP_PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i];
      const pa = cur.get(a)!;

      // 「あなた」（原点）との距離：自分のアイコンは動かさず、相手だけを少しずらす
      const dSelf = Math.hypot(pa.x, pa.y);
      if (dSelf < MIN_SELF_DISTANCE) {
        const angle = dSelf > 0.01 ? Math.atan2(pa.y, pa.x) : (i * 2.399963) % (Math.PI * 2);
        const need = MIN_SELF_DISTANCE - dSelf;
        move(a, Math.cos(angle) * need, Math.sin(angle) * need);
        moved = true;
      }

      for (let j = i + 1; j < ids.length; j++) {
        const b = ids[j];
        const pb = cur.get(b)!;
        let dx = pb.x - pa.x;
        let dy = pb.y - pa.y;
        let d = Math.hypot(dx, dy);
        if (d >= MIN_NODE_DISTANCE) continue;
        if (d < 0.01) {
          // ぴったり重なっている場合は、IDの並びから決まる向きに離す（毎回同じ結果になる）
          const angle = ((i * 7 + j * 13) * 2.399963) % (Math.PI * 2);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          d = 1;
        }
        const need = MIN_NODE_DISTANCE - d;
        const ma = mobilityOf(base.get(a)!, newIds.has(a));
        const mb = mobilityOf(base.get(b)!, newIds.has(b));
        const total = ma + mb;
        const ux = dx / d;
        const uy = dy / d;
        move(a, -ux * need * (ma / total), -uy * need * (ma / total));
        move(b, ux * need * (mb / total), uy * need * (mb / total));
        moved = true;
      }
    }
    if (!moved) break;
  }

  const result = new Map<string, LayoutPoint>();
  for (const id of ids) {
    const c = cur.get(id)!;
    result.set(id, { x: c.x, y: c.y, placed: base.get(id)!.placed });
  }
  return result;
}
