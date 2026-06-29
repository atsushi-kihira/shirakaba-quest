// AES-GCM 256 による OAuth トークンの暗号化・復号
// 鍵は Workers Secret "SCHEDULER_TOKEN_KEY" に base64 で格納

const ALG = { name: "AES-GCM", length: 256 } as const;

async function importKey(secretBase64: string, usage: "encrypt" | "decrypt") {
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(secretBase64), (c) => c.charCodeAt(0)),
    ALG,
    false,
    [usage]
  );
}

export async function encryptToken(plain: string, secretBase64: string): Promise<string> {
  const key = await importKey(secretBase64, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain)
  );
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...out));
}

export async function decryptToken(encodedB64: string, secretBase64: string): Promise<string> {
  const key = await importKey(secretBase64, "decrypt");
  const blob = Uint8Array.from(atob(encodedB64), (c) => c.charCodeAt(0));
  const iv = blob.slice(0, 12);
  const ct = blob.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}
