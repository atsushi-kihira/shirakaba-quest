// =============================================================
// ダイアログを閉じる「X」ボタン（このサービスでは、ダイアログの右上に置く）
// 閉じる＝キャンセル扱い。Esc キーでも同じ動作になる（dialog-escape-support.tsx）。
// =============================================================
import { X } from "lucide-react";

export function DialogCloseButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label="閉じる"
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 w-8 h-8 -mr-1 -mt-1 rounded-full flex items-center justify-center transition hover:opacity-70 disabled:opacity-40"
    >
      <X size={18} style={{ color: "var(--color-ink-400)" }} />
    </button>
  );
}
