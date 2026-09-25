// =============================================================
// ドラッグ&ドロップ並び替え中、「ここに挿入されます」を示す線
// useDragReorder と組み合わせて使う
// =============================================================
export function DropInsertionLine({ show }: { show: boolean }) {
  return (
    <div
      aria-hidden
      style={{
        height: show ? 3 : 0,
        margin: show ? "4px 2px" : 0,
        borderRadius: 999,
        background: "var(--color-brand)",
        boxShadow: show ? "0 0 0 3px color-mix(in srgb, var(--color-brand) 18%, transparent)" : "none",
        transition: "height 120ms ease, margin 120ms ease",
        overflow: "hidden",
      }}
    />
  );
}
