// =============================================================
// 協働マップのアイコン配置の保存（メンバー向けマップ・管理画面のマップで共通）
// 保存先は collab_map_positions。member_id 列には「配置の持ち主」のID（メンバー向けはメンバーID、
// 管理画面は管理者ID）を入れる。持ち主ごとに独立した配置を持つ。
// =============================================================
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";

const MAP_POSITION_LIMIT = 500;
const MAP_COORD_LIMIT = 1000;

export const MAP_POSITION_INVALID_MESSAGE = "保存する配置の内容が正しくありません。画面を開き直してもう一度お試しください";

export async function listMapPositions(db: Db, ownerId: string) {
  const rows = await db.select().from(schema.collabMapPositions).where(eq(schema.collabMapPositions.memberId, ownerId));
  return rows.map((r) => ({ nodeId: r.nodeId, x: r.x, y: r.y, userPlaced: r.userPlaced === 1 }));
}

/** 配置を保存（upsert）する。入力が不正なら null を返す */
export async function saveMapPositions(
  db: Db, ownerId: string,
  input: { nodeId?: unknown; x?: unknown; y?: unknown; userPlaced?: unknown }[] | undefined
): Promise<{ saved: number } | null> {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAP_POSITION_LIMIT) return null;
  const now = Math.floor(Date.now() / 1000);
  const rows: { nodeId: string; x: number; y: number; userPlaced: number }[] = [];
  for (const p of input) {
    if (typeof p.nodeId !== "string" || p.nodeId.length === 0 || p.nodeId.length > 100) continue;
    if (typeof p.x !== "number" || typeof p.y !== "number" || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    rows.push({
      nodeId: p.nodeId,
      x: Math.max(-MAP_COORD_LIMIT, Math.min(MAP_COORD_LIMIT, p.x)),
      y: Math.max(-MAP_COORD_LIMIT, Math.min(MAP_COORD_LIMIT, p.y)),
      userPlaced: p.userPlaced ? 1 : 0,
    });
  }
  if (rows.length === 0) return null;

  const statements = rows.map((r) =>
    db.insert(schema.collabMapPositions)
      .values({ memberId: ownerId, nodeId: r.nodeId, x: r.x, y: r.y, userPlaced: r.userPlaced, updatedAt: now })
      .onConflictDoUpdate({
        target: [schema.collabMapPositions.memberId, schema.collabMapPositions.nodeId],
        set: { x: r.x, y: r.y, userPlaced: r.userPlaced, updatedAt: now },
      })
  );
  await db.batch(statements as [typeof statements[number], ...typeof statements]);
  return { saved: rows.length };
}

export async function resetMapPositions(db: Db, ownerId: string): Promise<void> {
  await db.delete(schema.collabMapPositions).where(eq(schema.collabMapPositions.memberId, ownerId));
}
