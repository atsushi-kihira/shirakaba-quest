// =============================================================
// メニュー項目などに添える「ⓘ」説明アイコン。
// PC: ホバーで説明がポップアップ表示される
// スマホ（ホバーできない環境）: ⓘアイコンをタップすると同じ説明がトグル表示される
// ナビゲーションリンクの中に置かれることが多いため、クリック時は親リンクへの
// 遷移・伝播を止める。
// =============================================================
import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

type Placement = "above" | "below";

export function InfoTooltip({ text, placement = "above" }: { text: string; placement?: Placement }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  // ホバーできる環境（PC）では onMouseEnter/Leave だけで開閉を制御し、クリックはそれを邪魔しない
  // （ホバーで開いた直後にクリックのトグルが重なって即座に閉じてしまうのを防ぐ）。
  // ホバーできない環境（スマホ）でのみ、タップでの開閉トグルを有効にする。
  const supportsHover = typeof window !== "undefined" && window.matchMedia?.("(hover: hover)").matches;

  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [open]);

  return (
    <span
      ref={rootRef}
      className="relative inline-flex items-center justify-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!supportsHover) setOpen((v) => !v); }}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex items-center justify-center rounded-full transition"
        style={{ width: "16px", height: "16px", color: "var(--color-ink-400)", opacity: 0.7 }}
        aria-label="説明を表示"
      >
        <Info size={13} />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-50 text-xs leading-snug shadow-lg"
          style={{
            background: "var(--color-ink-900)",
            color: "var(--color-paper-50)",
            padding: "6px 10px",
            borderRadius: "10px",
            width: "180px",
            left: "50%",
            transform: "translateX(-50%)",
            ...(placement === "above" ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" }),
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
