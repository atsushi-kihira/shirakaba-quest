// 公開された版が、いま開いている画面の版と違うかを調べる（版の目印は vite.config.ts が書き出す /version.json）

/** 公開されている版が、いま開いている画面の版と違うか（確認できなかったときは false） */
export async function hasNewVersion(): Promise<boolean> {
  if (__BUILD_ID__ === "dev") return false;
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return false;
    const body = (await res.json()) as { id?: unknown };
    return typeof body.id === "string" && body.id !== __BUILD_ID__;
  } catch {
    return false;
  }
}
