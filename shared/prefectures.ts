// =============================================================
// 都道府県（メンバー・外部人脈の「所在地」で使う）
// 並びは都道府県コード（北から南）順。一覧のグループ分けでもこの順に並べる。
// 日本国外にしかない会社・屋号は「海外」にする。
// =============================================================

export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県",
  "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const;

export const OVERSEAS = "海外";

/** 所在地として保存できる値（47都道府県＋海外） */
export const LOCATION_VALUES: readonly string[] = [...PREFECTURES, OVERSEAS];

/** グループ分けの並び順（都道府県コード順 → 海外）。未設定は呼び出し側で最後にする */
export function prefectureOrder(value: string): number {
  const i = LOCATION_VALUES.indexOf(value);
  return i === -1 ? LOCATION_VALUES.length : i;
}

/**
 * 文字列の中から都道府県名を見つけて返す（見つからなければ null）。
 * 「東京」「大阪市」のような県名の略し方は扱わない。住所の書き出し（「新潟県長岡市…」）や、
 * AIの回答（「新潟県」）から取り出すための関数。
 */
export function findPrefecture(text: string | null | undefined): string | null {
  if (!text) return null;
  const normalized = text.normalize("NFKC");
  // 先頭に近い方の県名を採用する（「京都府」と「東京都」のように、別の県名の一部にならない順で探す）
  let best: { index: number; value: string } | null = null;
  for (const p of PREFECTURES) {
    const i = normalized.indexOf(p);
    if (i !== -1 && (best === null || i < best.index)) best = { index: i, value: p };
  }
  if (best) return best.value;
  if (normalized.includes(OVERSEAS)) return OVERSEAS;
  return null;
}
