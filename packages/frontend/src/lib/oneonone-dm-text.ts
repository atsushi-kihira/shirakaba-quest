// =============================================================
// 1to1の案内をDM等で送るときの文面づくり
// 申込みのときに入力した任意のメッセージが、定型の文面（挨拶・お願い・結びの言葉）と重なって不自然にならないように整えて、
// 「お疲れ様です。◯◯です。」のあとに挿入する。
//   ・メッセージの先頭の挨拶（お疲れ様です／お世話になっております 等）・自己紹介・宛名は、定型にあるので省く
//   ・メッセージの最後の「よろしくお願いします」は、定型の結びと重なるので省く
//   ・メッセージにURLが入っていたら、定型のURLと重なるので省く（「こちらからどうぞ」のようにURLを指すだけの言葉も省く）
//   ・メッセージ自体が1to1のお願い・日程の依頼をしているときは、定型の同じ趣旨の文を省く／言い換える（定型が既定の文面のときだけ）
//   定型の文面は、管理画面（メール配信管理）で編集できる。書き換えたものは、AIで整えることもできる（oneonone-dm-message.tsx）
//   ・メッセージの文末に句点がなければ補う
// =============================================================

const GREETING = /^(?:いつも)?(?:お世話になっております|お世話になります|お疲れ様です|お疲れさまです|おつかれさまです|お疲れ様でございます|こんにちは|こんばんは|おはようございます|はじめまして|初めまして)[。、！!\s]*/;
const CLOSING = /[\s]*(?:どうぞ|何卒)?(?:今後とも)?(?:引き続き)?(?:どうぞ)?よろしくお願い(?:いた|致)?し(?:ます|まーす)[。！!\s]*$/;
const BUSY = /お忙しい|ご多忙|お忙しく/;
// メッセージ自体が、1to1・お時間・ご予定のお願いをしている
const ASKS = /(?:お時間|ご予定|ご都合|日程).{0,12}(?:いただ|頂|伺|お聞|教え|お願い|調整)|1to1.{0,18}(?:させていただ|お願い|実施|ご一緒|お話|してい|いかが)/;

export type DmTextInput = { partnerName?: string | null; senderName: string; url: string; note?: string | null; template?: string | null };

/** 定型の既定の文面（管理画面で編集していないときの文面。バックエンドの DM_DEFAULT_BODY と同じ） */
export const DM_DEFAULT_TEMPLATE = `{{partnerHeading}}お疲れ様です。{{senderName}}です。
{{noteBlock}}大変お忙しいかと思いますが、ぜひ{{partner}}と1to1を実施させていただきたいと思います。お時間をいただけますでしょうか？
よろしければ、以下から{{partner}}のご予定を伺わせてください。

{{url}}

よろしくお願いします。`;

const BUSY_PREFIX = "大変お忙しいかと思いますが、";
const REQUEST_SENTENCE = /(?:大変お忙しいかと思いますが、)?ぜひ\{\{partner\}\}と1to1を実施させていただきたいと思います。お時間をいただけますでしょうか？\n?/;
const GUIDE_SENTENCE = "よろしければ、以下から{{partner}}のご予定を伺わせてください。";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** メッセージから、定型文と重なる部分を省く */
export function cleanNote(raw: string | null | undefined, partnerName: string | null | undefined, senderName: string, url: string): string {
  let t = (raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!t) return "";
  // URL（定型のURLと同じもの）
  if (url && t.includes(url)) {
    t = t.split(url).join("").replace(/[ \t]+\n/g, "\n").trim();
    // 「こちらからどうぞ」のように、URLを指し示すだけで宙に浮いた末尾の言葉は省く
    t = t.replace(/(?:^|[。！？!?\n])[^。！？!?\n]*(?:こちら|以下|下記|リンク)[^。！？!?\n]*$/, (m) => (/^[。！？!?\n]/.test(m) ? m[0] : ""));
  }
  // 宛名（「◯◯さん、」「◯◯様」）
  const partner = partnerName?.trim();
  if (partner) t = t.replace(new RegExp(`^${esc(partner)}(?:さん|様|氏)?[、,\\s]*`), "");
  // 先頭の挨拶と自己紹介（組み合わせ・順番が違っても省く）。名前は、フルネームのほか、姓だけ・スペースなしでも省く
  const full = senderName.trim();
  const names = [...new Set([full, full.replace(/\s+/g, ""), full.split(/\s+/)[0]].filter(Boolean))].sort((a, b) => b.length - a.length);
  for (let i = 0; i < 4; i++) {
    const before = t;
    t = t.replace(GREETING, "");
    if (names.length > 0) t = t.replace(new RegExp(`^(?:私は?|わたくしは?)?(?:${names.map(esc).join("|")})(?:です|と申します|でございます)[。、！!\\s]*`), "");
    if (t === before) break;
  }
  // 最後の「よろしくお願いします」
  t = t.replace(CLOSING, "");
  t = t.trim();
  if (!t) return "";
  // 文末の句点がなければ補う
  return /[。！？!?）)」』…]$/.test(t) ? t : `${t}。`;
}

/** DMで送るメッセージの文面 */
export function buildOneOnOneDmText({ partnerName, senderName, url, note, template }: DmTextInput): string {
  const hasName = !!partnerName?.trim();
  const partner = hasName ? `${partnerName!.trim()}さん` : "ご担当の方";
  const cleaned = cleanNote(note, partnerName, senderName, url);

  // メッセージが、すでにお願いをしているときは、定型の同じ趣旨の文を省く。お忙しい旨を書いているときは、定型の前置きを省く
  // （定型の文面を書き換えていて、該当の文がないときは、何もしない。そのときは「AIで整える」を使う）
  let body = template?.trim() ? template : DM_DEFAULT_TEMPLATE;
  if (cleaned && ASKS.test(cleaned)) body = body.replace(REQUEST_SENTENCE, "").replace(GUIDE_SENTENCE, "以下のURLからご確認ください。");
  else if (cleaned && BUSY.test(cleaned)) body = body.replace(BUSY_PREFIX, "");

  const vars: Record<string, string> = {
    partnerHeading: hasName ? `${partner}\n` : "", partner, senderName, url, noteBlock: cleaned ? `${cleaned}\n` : "",
  };
  return body.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? "");
}
