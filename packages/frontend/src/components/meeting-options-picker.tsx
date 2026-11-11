// =============================================================
// ミーティング・定例会を主催するときの「開催のしかた」オプション（イベント種別の下に置く）
//   ・出欠を確認しない（お知らせのみ）: 対象者に開催を知らせるだけ。参加・欠席のご返事は求めない
//     （直前のリマインドメール、ホーム画面・通知への表示は、ふつうの会と同じ）
//   ・有料: 参加費を登録する。参加を登録する人には、有料であることを確認してもらう
// 「出欠を確認しない」は、日程が決まっているとき（確定日）だけ選べる。有料とは同時に選べない。
// =============================================================
import { useEffect } from "react";

export type MeetingOptionsValue = {
  noAttendanceCheck: boolean;
  isPaid: boolean;
  /** 入力中の参加費（円）。数字のみ */
  feeAmount: string;
  feeNote: string;
};

export const DEFAULT_MEETING_OPTIONS: MeetingOptionsValue = {
  noAttendanceCheck: false, isPaid: false, feeAmount: "", feeNote: "",
};

/** APIに送る項目 */
export function optionsToPayload(v: MeetingOptionsValue): {
  noAttendanceCheck?: boolean; isPaid?: boolean; feeAmount?: number; feeNote?: string;
} {
  return {
    ...(v.noAttendanceCheck && { noAttendanceCheck: true }),
    ...(v.isPaid && { isPaid: true, feeAmount: Number(v.feeAmount), feeNote: v.feeNote.trim() || undefined }),
  };
}

/** 入力のチェック。問題があれば、やさしい日本語のメッセージを返す */
export function validateMeetingOptions(v: MeetingOptionsValue): string {
  if (!v.isPaid) return "";
  const n = Number(v.feeAmount);
  if (!v.feeAmount.trim() || !Number.isInteger(n) || n < 1) return "有料の会は、参加費を1円以上の数字で入力してください";
  return "";
}

export function MeetingOptionsPicker({ value, onChange, dateIsConfirmed }: {
  value: MeetingOptionsValue;
  onChange: (v: MeetingOptionsValue) => void;
  /** 日程が決まっている作り方（確定日）か。「出欠を確認しない」は、このときだけ選べる */
  dateIsConfirmed: boolean;
}) {
  // 日程調整（投票）に切り替えたら、「出欠を確認しない」は外す
  useEffect(() => {
    if (!dateIsConfirmed && value.noAttendanceCheck) onChange({ ...value, noAttendanceCheck: false });
  }, [dateIsConfirmed, value, onChange]);

  const row = (opts: {
    checked: boolean; disabled?: boolean; emoji: string; title: string; sub: string; onToggle: () => void;
  }) => (
    <label
      className="flex items-start gap-3 px-3 py-2.5 rounded-2xl transition"
      style={{
        background: opts.checked ? "rgba(212,160,59,0.12)" : "var(--color-paper-200)",
        border: opts.checked ? "1.5px solid rgba(212,160,59,0.4)" : "1.5px solid transparent",
        opacity: opts.disabled ? 0.5 : 1,
        cursor: opts.disabled ? "not-allowed" : "pointer",
      }}
    >
      <input type="checkbox" className="mt-1" checked={opts.checked} disabled={opts.disabled} onChange={opts.onToggle} />
      <span className="text-base">{opts.emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>{opts.title}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>{opts.sub}</p>
      </div>
    </label>
  );

  return (
    <div>
      <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
        🧩 開催のしかた（必要なときだけ）
      </label>
      <div className="space-y-1.5">
        {row({
          checked: value.noAttendanceCheck,
          disabled: !dateIsConfirmed || value.isPaid,
          emoji: "📢",
          title: "出欠を確認しない（お知らせのみ）",
          sub: !dateIsConfirmed
            ? "日程が決まっているとき（「確定日」で作成するとき）だけ選べます"
            : value.isPaid
              ? "有料の会は、参加する方の登録が必要なので、同時には選べません"
              : "対象の方に開催をお知らせするだけで、参加・欠席のご返事は求めません。直前のリマインドメール、ホーム画面や通知への表示は、ふつうの会と同じように届きます",
          onToggle: () => onChange({ ...value, noAttendanceCheck: !value.noAttendanceCheck }),
        })}
        {row({
          checked: value.isPaid,
          disabled: value.noAttendanceCheck,
          emoji: "💴",
          title: "有料（参加費あり）",
          sub: value.noAttendanceCheck
            ? "「出欠を確認しない」会は、有料にできません"
            : "参加費を登録します。参加を登録する方には、有料であることを確認するメッセージが表示されます",
          onToggle: () => onChange({ ...value, isPaid: !value.isPaid }),
        })}
      </div>

      {value.isPaid && (
        <div className="mt-2 p-3 rounded-2xl space-y-2" style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
              参加費（円） <span style={{ color: "var(--color-brand)" }}>*</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={value.feeAmount}
                onChange={(e) => onChange({ ...value, feeAmount: e.target.value.replace(/[^0-9]/g, "").slice(0, 8) })}
                placeholder="例：3000"
                className="w-40 px-3 py-2.5 rounded-xl text-sm outline-none border"
                style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
              />
              <span className="text-sm" style={{ color: "var(--color-ink-600)" }}>円</span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
              支払い方法などの補足（任意）
            </label>
            <input
              type="text"
              value={value.feeNote}
              maxLength={200}
              onChange={(e) => onChange({ ...value, feeNote: e.target.value })}
              placeholder="例：当日、会場で現金でお支払いください"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none border"
              style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** 有料の会に、参加を登録する前の確認メッセージ。OKなら true */
export function confirmPaidParticipation(fee: number | null | undefined, note?: string | null): boolean {
  const amount = fee ? `${fee.toLocaleString("ja-JP")}円` : "参加費";
  return window.confirm(
    `💴 この会は有料です（参加費：${amount}）。${note ? `\n${note}` : ""}\n\n有料であることを理解したうえで、参加を登録しますか？`
  );
}
