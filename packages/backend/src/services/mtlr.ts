// =============================================================
// メンバー・トラフィック・ライト・レポート（MTLR）— 取り込みの下ごしらえ
// ・PDF上の名前を、アプリのメンバーに当てはめる（手でひも付けた結果 → 名前の一致 → ローマ字の一致 の順）
// ・取り込む行の確認（数字の範囲、同じ名前の重複）
// =============================================================
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { MTLR_COLUMNS, MTLR_HEADERS, mtlrDisplayName, mtlrLatinKey, mtlrPersonKey, type MtlrRaw } from "@shared/mtlr";

export type PersonMatch = {
  personKey: string;
  displayName: string;
  memberId: string | null;
  memberName: string | null;
  /** link=管理者が手でひも付けた / auto=名前が一致 / excluded=メンバーではないと決めてある / none=見つからない */
  via: "link" | "auto" | "excluded" | "none";
};

/** 名前の一覧を、アプリのメンバーに当てはめる */
export async function resolvePeople(db: Db, rawNames: string[]): Promise<PersonMatch[]> {
  const [links, members] = await Promise.all([
    db.select().from(schema.mtlrPersonLinks).all(),
    db.select({ id: schema.members.id, name: schema.members.name, romaji: schema.members.romaji, status: schema.members.status })
      .from(schema.members).where(inArray(schema.members.status, ["active", "on_leave"])).all(),
  ]);
  const linkMap = new Map(links.map((l) => [l.personKey, l.memberId]));
  const memberById = new Map(members.map((m) => [m.id, m]));

  const byName = new Map<string, string[]>();
  const byLatin = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, id: string) => {
    if (!key) return;
    const list = map.get(key) ?? [];
    if (!list.includes(id)) list.push(id);
    map.set(key, list);
  };
  for (const m of members) {
    push(byName, mtlrPersonKey(m.name), m.id);
    push(byLatin, mtlrLatinKey(m.romaji ?? ""), m.id);
  }
  const unique = (ids: string[] | undefined): string | null => (ids && ids.length === 1 ? ids[0] : null);

  return rawNames.map((rawName) => {
    const personKey = mtlrPersonKey(rawName);
    const displayName = mtlrDisplayName(rawName);
    const result = (memberId: string | null, via: PersonMatch["via"]): PersonMatch => ({
      personKey, displayName, memberId, memberName: memberId ? memberById.get(memberId)?.name ?? null : null, via,
    });

    if (linkMap.has(personKey)) {
      const linked = linkMap.get(personKey) ?? null;
      if (linked === null) return result(null, "excluded");
      if (memberById.has(linked)) return result(linked, "link");
      // ひも付けたメンバーが、いなくなっている（削除・却下など）→ 自動の当てはめに戻す
    }
    const byKey = unique(byName.get(personKey));
    if (byKey) return result(byKey, "auto");
    // 名前が全部ローマ字の人（「FUKANO HIROYUKI」）は、メンバーのローマ字名と照合する
    const latin = mtlrLatinKey(rawName);
    if (latin && !/[぀-ヿ㐀-鿿]/.test(rawName)) {
      const byRomaji = unique(byLatin.get(latin));
      if (byRomaji) return result(byRomaji, "auto");
    }
    return result(null, "none");
  });
}

export type ImportRowInput = { rawName: string; raw: MtlrRaw };

const MAX_NUMBER = 1_000_000_000;

/** 取り込む行を確認して、使える形にそろえる。問題があれば、やさしい日本語のメッセージを返す */
export function validateImportRows(input: unknown): { rows: ImportRowInput[] } | { error: string } {
  if (!Array.isArray(input) || input.length === 0) return { error: "取り込む行がありません。表が読み取れているか確認してください。" };
  if (input.length > 300) return { error: "行が多すぎます（300人まで）。" };
  const rows: ImportRowInput[] = [];
  const seen = new Map<string, string>();
  for (let i = 0; i < input.length; i++) {
    const item = input[i] as { rawName?: unknown; raw?: Record<string, unknown> } | null;
    const rawName = typeof item?.rawName === "string" ? item.rawName.trim() : "";
    if (!rawName || rawName.length > 120) return { error: `${i + 1}行目の名前が読み取れません。` };
    const raw = {} as MtlrRaw;
    for (const key of MTLR_COLUMNS) {
      const v = item?.raw?.[key];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_NUMBER) {
        return { error: `${rawName}さんの「${MTLR_HEADERS[key]}」の数字が読み取れません。` };
      }
      raw[key] = v;
    }
    if (raw.score > 100 || raw.refOutRate > 100) return { error: `${rawName}さんの数字が正しくないようです（スコアや外与率は100までです）。` };
    const key = mtlrPersonKey(rawName);
    if (!key) return { error: `${i + 1}行目の名前が読み取れません。` };
    const dup = seen.get(key);
    if (dup) return { error: `「${dup}」と「${rawName}」が同じ名前として扱われます。表に同じ人が2回入っていないか確認してください。` };
    seen.set(key, rawName);
    rows.push({ rawName, raw });
  }
  return { rows };
}
