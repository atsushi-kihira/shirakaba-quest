// =============================================================
// メンバーを複数選ぶリスト（ミーティング・定例会の「指定」で使う）
// 名前の一部を入力して絞り込める。名前・読み仮名・ローマ字のどれでも探せる（空白・大文字小文字・ひらがな／カタカナの違いは無視）。
// 絞り込んでも、選んだ人は上に「選択中」として残り、そこから外せる。
// =============================================================
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";

export type SelectableMember = {
  id: string;
  name: string;
  emoji: string;
  bgColor: string;
  furigana?: string | null;
  romaji?: string | null;
};

/** 検索用に整える: 全角英数を半角に、空白を除き、英字は小文字に、カタカナはひらがなにそろえる */
function normalizeForSearch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/** 入力が、名前・読み仮名・ローマ字のどれかに含まれるか。入力が空なら、すべて該当 */
export function matchesMemberQuery(m: SelectableMember, query: string): boolean {
  const q = normalizeForSearch(query);
  if (!q) return true;
  return [m.name, m.furigana, m.romaji].some((v) => !!v && normalizeForSearch(v).includes(q));
}

type Props = {
  members: SelectableMember[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  /** 表示中（絞り込み結果）のメンバーをまとめて選ぶ・選択を空にする */
  onSetSelected: (ids: string[]) => void;
};

export function MemberSelectList({ members, selectedIds, onToggle, onSetSelected }: Props) {
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const filtered = useMemo(() => members.filter((m) => matchesMemberQuery(m, query)), [members, query]);
  const selectedMembers = useMemo(() => members.filter((m) => selected.has(m.id)), [members, selected]);
  const searching = query.trim() !== "";
  const allFilteredSelected = filtered.length > 0 && filtered.every((m) => selected.has(m.id));

  return (
    <div className="mt-3 space-y-2">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-ink-400)" }} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="名前の一部を入力して探す（例：やまだ、山田、yamada）"
          aria-label="メンバーを名前で探す"
          className="w-full rounded-2xl pl-9 pr-9 py-2.5 text-sm outline-none"
          style={{ background: "var(--color-paper-50)", border: "1.5px solid var(--color-paper-300)", color: "var(--color-ink-800)" }}
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="入力をクリア"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full" style={{ color: "var(--color-ink-400)" }}>
            <X size={14} />
          </button>
        )}
      </div>

      {/* 選択中の人（絞り込みで見えなくなっても、ここから確認・外せる） */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs pt-1" style={{ color: "var(--color-ink-500)" }}>
          選択中 <b style={{ color: selectedIds.length > 0 ? "var(--color-brand)" : "var(--color-ink-500)" }}>{selectedIds.length}</b> 名
        </p>
        {selectedIds.length > 0 && (
          <button type="button" onClick={() => onSetSelected([])} className="text-xs underline shrink-0 py-1" style={{ color: "var(--color-ink-500)" }}>
            すべて外す
          </button>
        )}
      </div>
      {selectedMembers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedMembers.map((m) => (
            <button key={m.id} type="button" onClick={() => onToggle(m.id)} aria-label={`${m.name}さんを外す`}
              className="flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-xs font-medium"
              style={{ background: "rgba(181,56,75,0.08)", border: "1px solid rgba(181,56,75,0.3)", color: "var(--color-ink-800)" }}>
              <span>{m.emoji}</span><span>{m.name}</span><X size={12} style={{ color: "var(--color-ink-500)" }} />
            </button>
          ))}
        </div>
      )}

      {searching && filtered.length > 0 && (
        <button type="button" onClick={() => onSetSelected(allFilteredSelected
          ? selectedIds.filter((id) => !filtered.some((m) => m.id === id))
          : [...new Set([...selectedIds, ...filtered.map((m) => m.id)])])}
          className="text-xs font-medium px-3 py-1.5 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
          {allFilteredSelected ? `見つかった ${filtered.length} 名を外す` : `見つかった ${filtered.length} 名をまとめて選ぶ`}
        </button>
      )}

      <div className="space-y-1.5 max-h-60 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-xs text-center py-5" style={{ color: "var(--color-ink-400)" }}>
            「{query.trim()}」に当てはまるメンバーがいません。ひらがなや、名字だけでも探せます。
          </p>
        ) : filtered.map((m) => {
          const on = selected.has(m.id);
          return (
            <label key={m.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl cursor-pointer transition"
              style={{ background: on ? "rgba(181,56,75,0.08)" : "var(--color-paper-200)", border: on ? "1.5px solid rgba(181,56,75,0.3)" : "1.5px solid transparent" }}>
              <input type="checkbox" checked={on} onChange={() => onToggle(m.id)} className="sr-only" />
              <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-lg ${m.bgColor}`}>{m.emoji}</span>
              <span className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>{m.name}</span>
              {on && <span className="ml-auto text-xs" style={{ color: "var(--color-brand)" }}>✓</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
}
