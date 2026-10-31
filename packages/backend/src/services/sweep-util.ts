// =============================================================
// バックグラウンド一斉処理（sweep）の共通部品
// waitUntil は、応答後およそ30秒で打ち切られる。AIの Web検索が遅い回に、処理の終了を待ってから
// 次の呼び出しへ連鎖していると、連鎖する前に打ち切られて、残りが誰にも処理されなくなる。
// そのため、処理の完了は一定時間だけ待ち、時間が来たら（途中でも）次の連鎖に進む。
// 途中で打ち切られた行は 'processing' のまま残るが、一定時間後に再び対象になる。
// =============================================================

/** 1回の呼び出しで、処理の完了を待つ時間（ミリ秒）。waitUntil の制限（約30秒）より短くする */
export const SWEEP_WORK_DEADLINE_MS = 22_000;

/** 処理（work）の完了を最大 ms だけ待つ。間に合わなくても、work は失敗として扱わず、そのまま返る */
export async function waitUpTo(work: Promise<unknown>, ms: number = SWEEP_WORK_DEADLINE_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });
  try {
    await Promise.race([work.catch(() => {}), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
