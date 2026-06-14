// =============================================================
// お題ストーリー文中のUSP強調表示
// ストーリー文中で `[[USP名]]` のように二重角括弧で囲むと、
// そのUSP名が強調表示（バッジ風）される。
// =============================================================
import type { ReactNode } from "react";

/** ストーリー文中の `[[USP名]]` を強調表示しつつ描画する */
export function renderQuestStory(story: string): ReactNode[] {
  const parts = story.split(/(\[\[[^\[\]]+\]\])/g);

  return parts.map((part, i) => {
    const m = part.match(/^\[\[([^[\]]+)\]\]$/);
    if (!m) return <span key={i}>{part}</span>;

    return (
      <strong
        key={i}
        className="px-1 py-0.5 rounded-md font-bold"
        style={{ background: "rgba(212,160,59,0.22)", color: "var(--color-ink-900)" }}
      >
        {m[1]}
      </strong>
    );
  });
}

/** ストーリー文を強調表示付きで描画するコンポーネント */
export function QuestStory({ text, className, style }: { text: string; className?: string; style?: React.CSSProperties }) {
  return <p className={className} style={style}>{renderQuestStory(text)}</p>;
}
