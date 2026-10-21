// =============================================================
// ダイアログを「Esc」キーで閉じる（キャンセル扱い）ための、アプリ全体の共通処理
// 画面の一番手前に出ているダイアログ（fixed inset-0 の背景つきの要素）を探し、次の順で閉じる操作をする。
//   1. data-dialog-cancel を付けたボタン（キャンセルを意味するボタン）
//   2. aria-label="閉じる" のボタン（右上の「X」）
//   3. 「キャンセル」「閉じる」「あとで」の文字のボタン
//   4. 「X」アイコンのボタン（ダイアログの右上の閉じるボタン）
//   5. 背景（ダイアログの外側）のクリック
// 日本語入力の変換中の Esc は、変換の取り消しに使われるので何もしない。
// 送信中などでボタンが押せない（disabled）ときは、閉じない。
// =============================================================
import { useEffect } from "react";

const CANCEL_TEXT = /^(キャンセル|閉じる|あとで|やめる)$/;

function findDialogOverlays(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("div.fixed.inset-0")).filter((el) => /\bz-/.test(el.className));
}

function findCloseControl(overlay: HTMLElement): HTMLElement | null {
  const explicit = overlay.querySelector<HTMLElement>("[data-dialog-cancel]");
  if (explicit) return explicit;
  const xButton = overlay.querySelector<HTMLElement>('button[aria-label="閉じる"]');
  if (xButton) return xButton;
  const buttons = Array.from(overlay.querySelectorAll<HTMLButtonElement>("button"));
  const byText = buttons.find((b) => CANCEL_TEXT.test((b.textContent ?? "").trim()));
  if (byText) return byText;
  // 文字のない「X」アイコンだけのボタン（先頭にあるもの＝ダイアログ右上の閉じるボタン）
  return buttons.find((b) => !(b.textContent ?? "").trim() && b.querySelector("svg.lucide-x")) ?? null;
}

export function DialogEscapeSupport() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.isComposing || e.defaultPrevented) return;
      const overlays = findDialogOverlays();
      const top = overlays[overlays.length - 1];
      if (!top) return;
      const control = findCloseControl(top);
      if (control) {
        if ((control as HTMLButtonElement).disabled) return;
        e.preventDefault();
        control.click();
      } else {
        e.preventDefault();
        top.click();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
  return null;
}
