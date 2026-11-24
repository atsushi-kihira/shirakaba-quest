// =============================================================
// 回答ボタンを押した場所から、画面の位置を変えないための道具
//   回答を送ると、上にある回答表の並びや行数が変わり、押したボタンの位置がずれることがある。
//   押す前の画面上の位置を覚えておき、表示が更新されたあとに、同じ位置へ戻す。
// =============================================================

/** 押す前の位置を覚える。返った関数を、表示の更新が終わったあとに呼ぶと、同じ位置へ戻る */
export function holdScrollPosition(button: Element | null): () => Promise<void> {
  // ボタン自体が作り直されることもあるので、囲んでいるカードも覚えておく
  const card = button?.closest(".card-paper") ?? null;
  const anchor = button ?? card;
  const before = anchor?.getBoundingClientRect().top ?? null;

  return async () => {
    if (before === null) return;
    // 画面の描き直しが終わるまで待つ
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const target = anchor?.isConnected ? anchor : card?.isConnected ? card : null;
    if (!target) return;
    const diff = target.getBoundingClientRect().top - before;
    if (Math.abs(diff) >= 1) window.scrollBy({ top: diff, behavior: "instant" });
  };
}
