// =============================================================
// 1to1のお誘いメッセージ（DM用）— 管理画面で編集できるひな形と、AIによる文面の調整
//   ・ひな形は、メール文面と同じ仕組み（email_templates）で、管理者が上書きできる（キー: oneonone_dm_message）
//   ・申込者が入力したメッセージがひな形と重なるときの整え方は2通り
//       1. 自動（無料）: 画面側で、重なる挨拶・お願い・URLなどを省く。既定の文面のときに働く
//       2. AI（ボタンを押したときだけ）: ひな形を書き換えていても、文脈に合わせて全体を自然に整える
// =============================================================
import { eq } from "drizzle-orm";
import { schema, type createDb } from "../db/index.ts";
import { DM_DEFAULT_BODY } from "./email-defaults.ts";
import { renderVars } from "./mailer.ts";
import { callClaude } from "./member-collab.ts";

type Db = ReturnType<typeof createDb>;

export const DM_TEMPLATE_KEY = "oneonone_dm_message";
const NOTE_MARK = "＜＜申込者のメッセージ＞＞";

/** 管理者が編集した文面（なければ既定の文面） */
export async function loadDmTemplate(db: Db): Promise<string> {
  const row = await db.select({ body: schema.emailTemplates.bodyHtml }).from(schema.emailTemplates)
    .where(eq(schema.emailTemplates.emailKey, DM_TEMPLATE_KEY)).get();
  return row?.body?.trim() ? row.body : DM_DEFAULT_BODY;
}

export type DmAiInput = {
  apiKey: string | undefined; isDev: boolean; template: string;
  partnerName: string | null; senderName: string; url: string; note: string;
};

function fill(template: string, v: { partnerName: string | null; senderName: string; url: string; noteBlock: string }): string {
  const hasName = !!v.partnerName?.trim();
  const partner = hasName ? `${v.partnerName!.trim()}さん` : "ご担当の方";
  return renderVars(template, {
    partnerHeading: hasName ? `${partner}\n` : "", partner, senderName: v.senderName, url: v.url, noteBlock: v.noteBlock,
  });
}

/** AIで、ひな形と申込者のメッセージの重なりを整えた文面にする。失敗したら null（画面側は自動で整えた文面のまま） */
export async function adjustDmWithAi(input: DmAiInput): Promise<string | null> {
  const { apiKey, isDev, template, partnerName, senderName, url, note } = input;
  if (isDev || !apiKey || apiKey === "dev-not-set") {
    // 開発用: AIは呼ばず、メッセージをそのまま差し込む
    return fill(template, { partnerName, senderName, url, noteBlock: `${note.trim()}\n` });
  }
  const base = fill(template, { partnerName, senderName, url, noteBlock: template.includes("{{noteBlock}}") ? `${NOTE_MARK}\n` : "" });
  const prompt = `あなたは、ビジネス交流会のメンバー同士が送る、1to1（短時間の個別面談）のお誘いメッセージを整える編集者です。
次の「ひな形」の文面に、申込者が自分で書いた「メッセージ」を組み込み、重複や不自然さのない、1通のDM文面に仕上げてください。

【ひな形】（${template.includes("{{noteBlock}}") ? `${NOTE_MARK} の位置に、申込者のメッセージが入ります` : "メッセージの差し込み位置の指定はありません。自然な位置に入れてください"}）
${base}

【申込者のメッセージ】
${note.trim()}

整え方のルール:
- 申込者のメッセージの内容・気持ち・言葉づかいは、できるだけそのまま活かす（要点は削らない）
- メッセージと同じ内容を、ひな形が重ねて言っている部分（挨拶、自己紹介、1to1のお願い、お時間・ご予定の依頼、結びの言葉など）は、ひな形側を省くか、言い換えて自然につなぐ
- メッセージの先頭の挨拶や自己紹介など、ひな形とだぶるものは、メッセージ側を省く
- 日程を選ぶURLは「${url}」を、文面の中にちょうど1回だけ入れる（形を変えない）
- ひな形の宛名、署名の名前、改行・段落の構成は、重複の解消に必要なとき以外は変えない
- 新しい事実・約束・日時を付け足さない
- 敬体（です・ます）で、DMで送ってすぐ使える自然な文面にする

整えた文面だけを出力してください（説明・前置き・引用符・コードブロックは付けない）。`;

  try {
    const out = (await callClaude(apiKey, prompt)).trim().replace(/^```[a-z]*\n?|\n?```$/g, "").trim();
    // 安全確認: URLがちょうど1回あり、差し込み用の目印が残っていない
    if (!out || out.split(url).length !== 2 || out.includes(NOTE_MARK)) return null;
    return out;
  } catch (e) {
    console.error("[oneonone-dm] AIでの調整に失敗", e);
    return null;
  }
}
