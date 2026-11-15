// =============================================================
// タグで絞り込むチップの列（なかま一覧・外部人脈一覧で使う）
//   一覧に出ている人のタグを数えて、多い順に並べる。押すと、そのタグを持つ人だけに絞り込める。もう一度押すと解除
//   タグは、登録した本人だけが見られる（あなたの資料メモのタグ）
// =============================================================
import { useMemo, useState } from "react";
import { Tag, X } from "lucide-react";
import { normTag } from "./profile-sheet-shared";

type Props = {
  /** 相手のIDごとのタグ */
  tagMap: Record<string, string[]> | undefined;
  /** 数える対象の相手のID（今の一覧に出ている人） */
  ids: string[];
  selected: string | null;
  onSelect: (tag: string | null) => void;
};

const INITIAL_COUNT = 10;

export function TagFilterBar({ tagMap, ids, selected, onSelect }: Props) {
  const [showAll, setShowAll] = useState(false);

  const tags = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const id of ids) {
      for (const t of tagMap?.[id] ?? []) {
        const key = normTag(t);
        if (!key) continue;
        const cur = counts.get(key);
        if (cur) cur.count += 1; else counts.set(key, { label: t, count: 1 });
      }
    }
    return [...counts.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ja"));
  }, [tagMap, ids]);

  if (tags.length === 0 && !selected) return null;

  const shown = showAll ? tags : tags.slice(0, INITIAL_COUNT);
  // 選んでいるタグが、隠れている側にあっても見えるようにする
  const selectedKey = selected ? normTag(selected) : null;
  const selectedHidden = selectedKey && !shown.some((t) => t.key === selectedKey);

  return (
    <div className="mb-3">
      <p className="text-[11px] mb-1.5 flex items-center gap-1" style={{ color: "var(--color-ink-500)" }}>
        <Tag size={11} /> タグで絞り込む（あなたの資料メモのタグ。あなただけが見られます）
      </p>
      <div className="flex flex-wrap gap-1.5">
        {selectedHidden && selected && (
          <button type="button" onClick={() => onSelect(null)} aria-pressed
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-white" style={{ background: "var(--color-brand)" }}>
            #{selected} <X size={11} />
          </button>
        )}
        {shown.map((t) => {
          const on = selectedKey === t.key;
          return (
            <button key={t.key} type="button" aria-pressed={on} onClick={() => onSelect(on ? null : t.label)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition"
              style={{
                background: on ? "var(--color-brand)" : "rgba(212,160,59,0.18)",
                color: on ? "white" : "var(--color-ink-700)",
                fontWeight: on ? 600 : 400,
              }}>
              #{t.label}
              <span className="text-[10px]" style={{ opacity: 0.75 }}>{t.count}</span>
              {on && <X size={11} />}
            </button>
          );
        })}
        {tags.length > INITIAL_COUNT && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="px-2.5 py-1 rounded-full text-xs"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            {showAll ? "少なく表示" : `もっと見る（${tags.length - INITIAL_COUNT}）`}
          </button>
        )}
      </div>
    </div>
  );
}
