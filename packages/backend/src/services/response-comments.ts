// =============================================================
// 日程の回答に添える「一言コメント」
// ミーティング・定例会の回答表に、回答した人ごとのコメントを出すための保存・取得・削除。
// コメントは候補日ごとではなく、「ミーティング（または定例会）1件につき、1人1つ」。
// =============================================================
import { and, eq, inArray } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import { newId } from "./auth.ts";

type Db = ReturnType<typeof createDb>;

export type CommentKind = "meeting" | "series";
/** コメントの主。メンバーか、外部ゲストのどちらか */
export type CommentOwner = { memberId: string } | { externalInviteeId: string };

/** 一言コメントの最大文字数 */
export const COMMENT_MAX_LENGTH = 100;

/**
 * 受け取った値をコメントとして整える。
 *  - undefined（項目が送られていない）: 何も変えない
 *  - null（空欄・空白だけ）: コメントを消す
 *  - 文字列: 前後の空白を除き、改行を空白にして、最大文字数までにする
 */
export function normalizeComment(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") return undefined;
  const text = raw.replace(/\s*[\r\n]+\s*/g, " ").trim().slice(0, COMMENT_MAX_LENGTH);
  return text === "" ? null : text;
}

function ownerWhere(kind: CommentKind, targetId: string, owner: CommentOwner) {
  return "memberId" in owner
    ? and(eq(schema.responseComments.kind, kind), eq(schema.responseComments.targetId, targetId), eq(schema.responseComments.memberId, owner.memberId))
    : and(eq(schema.responseComments.kind, kind), eq(schema.responseComments.targetId, targetId), eq(schema.responseComments.externalInviteeId, owner.externalInviteeId));
}

/** コメントを保存する（comment が undefined なら何もしない。null なら削除） */
export async function saveResponseComment(
  db: Db,
  kind: CommentKind,
  targetId: string,
  owner: CommentOwner,
  comment: string | null | undefined,
  now: number
): Promise<void> {
  if (comment === undefined) return;
  await db.delete(schema.responseComments).where(ownerWhere(kind, targetId, owner));
  if (comment === null) return;
  await db.insert(schema.responseComments).values({
    id: newId(),
    kind,
    targetId,
    memberId: "memberId" in owner ? owner.memberId : null,
    externalInviteeId: "externalInviteeId" in owner ? owner.externalInviteeId : null,
    comment,
    updatedAt: now,
  });
}

/** 1件のミーティング／定例会のコメントを、{ メンバーID・外部ゲストID → コメント } で返す */
export async function loadResponseComments(db: Db, kind: CommentKind, targetId: string): Promise<Map<string, string>> {
  const rows = await db.select().from(schema.responseComments)
    .where(and(eq(schema.responseComments.kind, kind), eq(schema.responseComments.targetId, targetId))).all();
  const map = new Map<string, string>();
  for (const r of rows) {
    const key = r.memberId ?? r.externalInviteeId;
    if (key) map.set(key, r.comment);
  }
  return map;
}

/** ミーティング／定例会が消えたときに、そのコメントもまとめて消す */
export async function deleteResponseCommentsForTargets(db: Db, kind: CommentKind, targetIds: string[]): Promise<void> {
  // D1 のバインド変数の上限に収まるよう、分けて消す
  for (let i = 0; i < targetIds.length; i += 50) {
    await db.delete(schema.responseComments).where(and(
      eq(schema.responseComments.kind, kind),
      inArray(schema.responseComments.targetId, targetIds.slice(i, i + 50))
    ));
  }
}

/** 特定の人（メンバー）が、あるミーティング／定例会から外れたときに、その人のコメントを消す */
export async function deleteMemberComments(db: Db, kind: CommentKind, targetId: string, memberIds: string[]): Promise<void> {
  if (memberIds.length === 0) return;
  await db.delete(schema.responseComments).where(and(
    eq(schema.responseComments.kind, kind), eq(schema.responseComments.targetId, targetId),
    inArray(schema.responseComments.memberId, memberIds)
  ));
}

/** 特定の外部ゲストが外れたときに、そのゲストのコメントを消す */
export async function deleteExternalComments(db: Db, kind: CommentKind, targetId: string, externalInviteeIds: string[]): Promise<void> {
  if (externalInviteeIds.length === 0) return;
  await db.delete(schema.responseComments).where(and(
    eq(schema.responseComments.kind, kind), eq(schema.responseComments.targetId, targetId),
    inArray(schema.responseComments.externalInviteeId, externalInviteeIds)
  ));
}
