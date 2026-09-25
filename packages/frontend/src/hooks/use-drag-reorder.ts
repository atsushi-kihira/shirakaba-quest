// =============================================================
// リスト項目のドラッグ&ドロップ並び替え（マウス・タッチ両対応の Pointer Events ベース）
// 候補日一覧など、配列 state をそのまま並び替えたい場面で使う。
//
// UX方針:
// ・ドラッグ中は配列を都度並べ替えず、「どの隙間に入るか（gapIndex）」だけを追跡する
//   （入力欄の値が動きながら書き換わって混乱するのを避けるため）。
// ・指を離した瞬間に1回だけ実際の並び替えを確定する。
// ・確定時、他の行がどれだけズレたかを計算し、FLIP法で「ズレた分だけ逆に一瞬動かしてから
//   0へアニメーションさせる」ことで、実際に動いたことが視覚的にわかるようにする。
// =============================================================
import { useLayoutEffect, useRef, useState } from "react";

const FLIP_DURATION_MS = 220;

export function useDragReorder<T extends { id: string }>(items: T[], onChange: (items: T[]) => void) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [gapIndex, setGapIndex] = useState<number | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const startYRef = useRef(0);
  const rowElsRef = useRef(new Map<string, HTMLElement>());
  const prevRectsRef = useRef(new Map<string, DOMRect>());

  function registerRow(id: string, el: HTMLElement | null) {
    if (el) rowElsRef.current.set(id, el);
    else rowElsRef.current.delete(id);
  }

  function handlePointerDown(id: string, e: React.PointerEvent) {
    e.preventDefault();
    const idx = items.findIndex((it) => it.id === id);
    if (idx === -1) return;
    setDragId(id);
    setGapIndex(idx);
    startYRef.current = e.clientY;
    setDragOffsetY(0);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // キャプチャに失敗しても、ポインタがハンドル上に留まる限りは動作するため無視する
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (dragId === null) return;
    // タッチ環境でブラウザ側のスクロール／パン操作に横取りされないよう、既定動作を抑止する
    e.preventDefault();
    setDragOffsetY(e.clientY - startYRef.current);

    const container = (e.currentTarget as HTMLElement).closest("[data-drag-list]");
    if (!container) return;
    const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-drag-row]"));
    const y = e.clientY;
    let newGap = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      if (y < rect.top + rect.height / 2) { newGap = i; break; }
    }
    setGapIndex(newGap);
  }

  function commit() {
    if (dragId === null || gapIndex === null) return;
    const dragIndex = items.findIndex((it) => it.id === dragId);
    if (dragIndex === -1) return;
    const target = gapIndex > dragIndex ? gapIndex - 1 : gapIndex;
    if (target === dragIndex) return;

    // FLIP: 並び替え前の各行の位置を記録しておく（次の再描画後、useLayoutEffectで比較する）
    prevRectsRef.current.clear();
    for (const [id, el] of rowElsRef.current) {
      prevRectsRef.current.set(id, el.getBoundingClientRect());
    }
    const next = [...items];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(target, 0, moved);
    onChange(next);
  }

  function handlePointerUp() {
    commit();
    setDragId(null);
    setGapIndex(null);
    setDragOffsetY(0);
  }

  // FLIP の再生: 直前に記録した位置と、再描画後の実際の位置との差分だけ逆方向に
  // 一瞬ずらしておき、次のフレームで transform をゼロへアニメーションさせる
  useLayoutEffect(() => {
    if (prevRectsRef.current.size === 0) return;
    const prevRects = prevRectsRef.current;
    prevRectsRef.current = new Map();

    for (const [id, el] of rowElsRef.current) {
      const prev = prevRects.get(id);
      if (!prev) continue;
      const next = el.getBoundingClientRect();
      const dy = prev.top - next.top;
      if (Math.abs(dy) < 0.5) continue;
      el.style.transition = "none";
      el.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = `transform ${FLIP_DURATION_MS}ms cubic-bezier(0.2, 0, 0.2, 1)`;
        el.style.transform = "";
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  return { dragId, gapIndex, dragOffsetY, registerRow, handlePointerDown, handlePointerMove, handlePointerUp };
}
