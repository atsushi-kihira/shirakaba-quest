// =============================================================
// メンバー一覧の「並び順」と「分け方」（なかま一覧・管理画面のメンバー管理で共用）
//   並び順: アカウント登録の新しい順（標準）／古い順、入会の新しい順／古い順
//   分け方: 分けない（標準）／所在地（都道府県）で分ける／入会年で分ける
// 入会日・所在地が未登録の人は、並び順では末尾、分け方では最後の「未登録」のグループに入る。
// 選んだ内容は、この端末に覚えておく（画面ごと）。
// =============================================================
import { useEffect, useMemo, useState } from "react";
import { prefectureOrder } from "@shared/prefectures";
import { useSettings } from "@/hooks/use-settings";

export type MemberSortKey = "registered_desc" | "registered_asc" | "joined_desc" | "joined_asc";
export type MemberGroupKey = "none" | "prefecture" | "joined_year";

export const DEFAULT_SORT: MemberSortKey = "registered_desc";
export const DEFAULT_GROUP: MemberGroupKey = "none";

const SORT_KEYS: MemberSortKey[] = ["registered_desc", "registered_asc", "joined_desc", "joined_asc"];
const GROUP_KEYS: MemberGroupKey[] = ["none", "prefecture", "joined_year"];

/** 並べ替え・グループ分けに必要な値の取り出し方（画面によって項目名が違うため） */
export type MemberFieldAccessors<T> = {
  registeredAt: (m: T) => number;               // アカウント登録日時（Unix秒）
  joinedDate: (m: T) => string | null | undefined; // 入会日（"YYYY-MM-DD"）
  prefecture: (m: T) => string | null | undefined; // 所在地（都道府県）
};

export type MemberSection<T> = { key: string; label: string; items: T[] };

export function sortMembers<T>(list: T[], sort: MemberSortKey, f: MemberFieldAccessors<T>): T[] {
  const sorted = [...list];
  const byRegistered = (a: T, b: T) => f.registeredAt(b) - f.registeredAt(a); // 新しい順（同順位のときの並び）
  if (sort === "registered_desc") sorted.sort(byRegistered);
  else if (sort === "registered_asc") sorted.sort((a, b) => f.registeredAt(a) - f.registeredAt(b));
  else {
    sorted.sort((a, b) => {
      const ja = f.joinedDate(a) || "";
      const jb = f.joinedDate(b) || "";
      if (!ja && !jb) return byRegistered(a, b);
      if (!ja) return 1; // 入会日が未登録の人は、どちらの向きでも最後
      if (!jb) return -1;
      if (ja === jb) return byRegistered(a, b);
      const ascending = ja < jb ? -1 : 1;
      return sort === "joined_asc" ? ascending : -ascending;
    });
  }
  return sorted;
}

/** 並べ替え済みの一覧を、分け方に応じてグループにする（グループの中は、渡された順のまま） */
export function groupMembers<T>(sorted: T[], group: MemberGroupKey, sort: MemberSortKey, f: MemberFieldAccessors<T>): MemberSection<T>[] {
  if (group === "none") return [{ key: "all", label: "", items: sorted }];

  const buckets = new Map<string, T[]>();
  const push = (key: string, m: T) => { const l = buckets.get(key); if (l) l.push(m); else buckets.set(key, [m]); };
  const UNSET = "";
  for (const m of sorted) {
    if (group === "prefecture") push(f.prefecture(m) || UNSET, m);
    else push(f.joinedDate(m)?.slice(0, 4) || UNSET, m);
  }

  let keys = [...buckets.keys()].filter((k) => k !== UNSET);
  if (group === "prefecture") keys.sort((a, b) => prefectureOrder(a) - prefectureOrder(b));
  else {
    // 入会年は、並び順が「古い順」なら古い年から、それ以外は新しい年から
    const oldestFirst = sort === "registered_asc" || sort === "joined_asc";
    keys.sort((a, b) => (oldestFirst ? a.localeCompare(b) : b.localeCompare(a)));
  }
  if (buckets.has(UNSET)) keys = [...keys, UNSET];

  return keys.map((k) => ({
    key: k || "unset",
    label: k
      ? (group === "prefecture" ? `📍 ${k}` : `📅 ${k}年に入会`)
      : (group === "prefecture" ? "📍 所在地 未登録" : "📅 入会年 未登録"),
    items: buckets.get(k) ?? [],
  }));
}

function readSaved(storageKey: string): { sort: MemberSortKey; group: MemberGroupKey } {
  const result = { sort: DEFAULT_SORT, group: DEFAULT_GROUP };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as { sort?: string; group?: string };
    if (saved.sort && (SORT_KEYS as string[]).includes(saved.sort)) result.sort = saved.sort as MemberSortKey;
    if (saved.group && (GROUP_KEYS as string[]).includes(saved.group)) result.group = saved.group as MemberGroupKey;
  } catch { /* 覚えていた設定が読めなくても、標準の設定で表示する */ }
  return result;
}

/** 並び順・分け方を、この端末に覚えておく（localStorage が使えない環境でも、標準の設定で動く） */
export function useMemberListOptions(storageKey: string): {
  sort: MemberSortKey; group: MemberGroupKey; setSort: (s: MemberSortKey) => void; setGroup: (g: MemberGroupKey) => void;
} {
  const [sort, setSort] = useState<MemberSortKey>(() => readSaved(storageKey).sort);
  const [group, setGroup] = useState<MemberGroupKey>(() => readSaved(storageKey).group);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ sort, group })); } catch { /* 保存できなくても、表示には影響しない */ }
  }, [storageKey, sort, group]);
  return { sort, group, setSort, setGroup };
}

const selectStyle = { background: "var(--color-paper-50)", border: "1.5px solid var(--color-paper-300)", color: "var(--color-ink-800)" } as const;

export function MemberListOptions({ sort, group, onSort, onGroup }: {
  sort: MemberSortKey; group: MemberGroupKey; onSort: (s: MemberSortKey) => void; onGroup: (g: MemberGroupKey) => void;
}) {
  const { appTitle, termBusinessCommunity } = useSettings();
  const sortLabels: Record<MemberSortKey, string> = useMemo(() => ({
    registered_desc: `${appTitle}のアカウント登録が新しい順`,
    registered_asc: `${appTitle}のアカウント登録が古い順`,
    joined_desc: `${termBusinessCommunity}入会が新しい順`,
    joined_asc: `${termBusinessCommunity}入会が古い順`,
  }), [appTitle, termBusinessCommunity]);
  const groupLabels: Record<MemberGroupKey, string> = {
    none: "分けない（全員を順番に並べる）",
    prefecture: "会社・屋号の所在地（都道府県）で分ける",
    joined_year: `${termBusinessCommunity}入会年で分ける`,
  };
  const changed = sort !== DEFAULT_SORT || group !== DEFAULT_GROUP;
  return (
    <div className="mb-4 grid gap-2 sm:grid-cols-2">
      <label className="flex items-center gap-2 text-sm min-w-0" style={{ color: "var(--color-ink-600)" }}>
        <span className="font-medium shrink-0">↕️ 並び順</span>
        <select value={sort} onChange={(e) => onSort(e.target.value as MemberSortKey)}
          className="flex-1 min-w-0 rounded-xl px-2 py-1.5 text-sm outline-none" style={selectStyle}>
          {SORT_KEYS.map((k) => <option key={k} value={k}>{sortLabels[k]}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm min-w-0" style={{ color: "var(--color-ink-600)" }}>
        <span className="font-medium shrink-0">🗂️ 分け方</span>
        <select value={group} onChange={(e) => onGroup(e.target.value as MemberGroupKey)}
          className="flex-1 min-w-0 rounded-xl px-2 py-1.5 text-sm outline-none" style={selectStyle}>
          {GROUP_KEYS.map((k) => <option key={k} value={k}>{groupLabels[k]}</option>)}
        </select>
      </label>
      {changed && (
        <button type="button" onClick={() => { onSort(DEFAULT_SORT); onGroup(DEFAULT_GROUP); }}
          className="justify-self-start text-xs font-medium px-2.5 py-1.5 rounded-full sm:col-span-2"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          標準の並びに戻す
        </button>
      )}
    </div>
  );
}

/** グループの見出し（分け方を選んだときだけ表示する） */
export function MemberSectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <h2 className="flex items-baseline gap-2 text-sm font-semibold pt-2 pb-1 border-b"
      style={{ color: "var(--color-ink-700)", borderColor: "var(--color-paper-300)", fontFamily: "var(--font-klee)" }}>
      {label}
      <span className="text-xs font-normal" style={{ color: "var(--color-ink-400)" }}>{count}名</span>
    </h2>
  );
}
