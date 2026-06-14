// =============================================================
// カード画像（R2）操作ヘルパー
// =============================================================

/** base64文字列（data URLプレフィックス有無どちらでも可）をR2に保存し、保存キーを返す */
export async function saveCardImage(
  r2: R2Bucket,
  memberId: string,
  imageBase64: string
): Promise<string> {
  // data URL プレフィックスを除去
  const base64 = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
  const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

  const key = `card-images/${memberId}.jpg`;
  await r2.put(key, binary, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  return key;
}

/** R2からカード画像を取得し、data URL形式で返す（存在しない場合は null） */
export async function getCardImageDataUrl(
  r2: R2Bucket,
  key: string
): Promise<string | null> {
  const obj = await r2.get(key);
  if (!obj) return null;

  const buf = await obj.arrayBuffer();
  const contentType = obj.httpMetadata?.contentType ?? "image/jpeg";

  // ArrayBuffer -> base64
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);

  return `data:${contentType};base64,${base64}`;
}
