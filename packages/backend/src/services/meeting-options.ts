// =============================================================
// ミーティング・定例会の「開催のしかた」オプション
//   ・出欠を確認しない（お知らせのみ）: 対象者に開催を知らせるだけの会。参加・欠席の回答は求めない。
//     直前のリマインドメール、ホーム画面・通知への表示は、ふつうの会と同じように行う。
//   ・有料: 参加費を登録し、参加登録する人には、有料であることを確認してもらう。
// 定例会に設定した内容は、各開催回（meetings）にも引き継ぐ。
// =============================================================

export type MeetingOptionsInput = {
  noAttendanceCheck?: boolean;
  isPaid?: boolean;
  /** 参加費（円） */
  feeAmount?: number;
  /** 支払い方法などの補足 */
  feeNote?: string;
};

export type MeetingOptions = {
  noAttendanceCheck: 0 | 1;
  isPaid: 0 | 1;
  feeAmount: number | null;
  feeNote: string | null;
};

const MAX_FEE = 10_000_000;
const MAX_FEE_NOTE = 200;

export function parseMeetingOptions(
  input: MeetingOptionsInput,
  /** 日程がすでに確定している作り方か（出欠を確認しない会は、日程調整（投票）では作れない） */
  dateIsConfirmed: boolean,
): { ok: true; value: MeetingOptions } | { ok: false; message: string } {
  const noAttendanceCheck = input.noAttendanceCheck === true;
  const isPaid = input.isPaid === true;

  if (noAttendanceCheck && isPaid) {
    return { ok: false, message: "「出欠を確認しない」会は、有料にできません（有料の会は、参加する方の登録が必要です）" };
  }
  if (noAttendanceCheck && !dateIsConfirmed) {
    return { ok: false, message: "「出欠を確認しない」会は、日程が決まっているときだけ選べます。「確定日」で作成してください" };
  }
  if (!isPaid) {
    return { ok: true, value: { noAttendanceCheck: noAttendanceCheck ? 1 : 0, isPaid: 0, feeAmount: null, feeNote: null } };
  }

  const fee = input.feeAmount;
  if (typeof fee !== "number" || !Number.isInteger(fee) || fee < 1 || fee > MAX_FEE) {
    return { ok: false, message: "有料の会は、参加費を1円以上の整数で入力してください" };
  }
  const note = (input.feeNote ?? "").trim();
  if (note.length > MAX_FEE_NOTE) {
    return { ok: false, message: `参加費の補足は${MAX_FEE_NOTE}文字までで入力してください` };
  }
  return { ok: true, value: { noAttendanceCheck: 0, isPaid: 1, feeAmount: fee, feeNote: note || null } };
}

/** メール・通知の本文に添える、参加費の1行（有料でなければ空） */
export function feeLine(opts: { isPaid: number | boolean | null | undefined; feeAmount: number | null | undefined; feeNote?: string | null }): string {
  if (!opts.isPaid || !opts.feeAmount) return "";
  const note = opts.feeNote?.trim();
  return `💴 参加費：${opts.feeAmount.toLocaleString("ja-JP")}円（有料の会です）${note ? `\n　${note}` : ""}`;
}

/** 説明文に、参加費の1行を足す（メール用） */
export function withFeeLine(
  description: string | null | undefined,
  opts: { isPaid: number | boolean | null | undefined; feeAmount: number | null | undefined; feeNote?: string | null },
): string {
  const line = feeLine(opts);
  const base = (description ?? "").trim();
  return line ? (base ? `${base}\n\n${line}` : line) : base;
}
