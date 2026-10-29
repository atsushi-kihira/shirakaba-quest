// =============================================================
// ミーティング・定例会の作成画面で、外部ゲスト（ビジター）を招待する部分
//   ・ゲスト用の共有URL: 作成する前に、URLだけ先に発行できる（有効期間は発行時に選べる。初期は7日）。
//     作成すると、同じURLがそのままミーティング・定例会のゲスト用URLになる。作成せずにやめたものは、期限が来たら自動で削除される。
//     作成前にURLを開いた人には、「準備中」と表示される。
//   ・ゲストを個別に指定（メールアドレスは必須。回答を、メールアドレスで対応づけるため）。次の2つの流れから選べる。
//       - 名前とメールアドレスだけで招待（かんたん）: 外部人脈には登録しない。ゲストが回答で会社名を入力したときだけ、人脈に自動登録される。
//       - 外部人脈から選ぶ・登録して招待: 登録済みの人脈から選ぶ。いない場合は、その場で人脈に登録（名前・会社名・メールアドレス・公開範囲）して招待する。
//     作成と同時に、全員に招待メールを送る。人脈にメールアドレスがない場合は、ここで入力して人脈に保存することもできる。
//   ・メールアドレスのわからない方には、共有URLを何らかの方法でお伝えする（回答時に、名前・メールアドレス・会社名を入力してもらう）。
// =============================================================
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link as LinkIcon, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";
import { fmtDateTimeFull } from "@/lib/date";
import { useTimezone } from "@/hooks/use-timezone";
import { GuestPicker, type GuestDraft } from "./guest-picker";

export { guestsToPayload, guestMissingEmail, type GuestDraft } from "./guest-picker";
type Reservation = { token: string; expiresAt: number; url: string };

const DAY_OPTIONS = [1, 3, 7, 14, 30, 60];
const inputStyle = { background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" } as const;

type Props = {
  kind: "meeting" | "series";
  guests: GuestDraft[];
  onGuestsChange: (g: GuestDraft[]) => void;
  /** 発行済みの共有URLの予約トークン（なければ null）。作成するときに、いっしょに送る */
  onReservationChange: (token: string | null) => void;
};

export function MeetingGuestSection({ kind, guests, onGuestsChange, onReservationChange }: Props) {
  const { termExternalGuest } = useSettings();
  const tz = useTimezone();
  const qc = useQueryClient();
  const [days, setDays] = useState(7);
  const [copied, setCopied] = useState(false);
  const reservationKey = ["invite-reservation", kind];
  const { data: reservationData } = useQuery({
    queryKey: reservationKey,
    queryFn: () => api.get<{ data: Reservation | null }>(`/invite-reservations?kind=${kind}`),
  });
  const reservation = reservationData?.data ?? null;
  useEffect(() => { onReservationChange(reservation?.token ?? null); }, [reservation?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const issue = useMutation({
    mutationFn: () => api.post<{ data: Reservation }>("/invite-reservations", { kind, days }),
    onSuccess: () => qc.invalidateQueries({ queryKey: reservationKey }),
  });
  const discard = useMutation({
    mutationFn: () => api.delete(`/invite-reservations?kind=${kind}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: reservationKey }),
  });

  function copy() {
    if (!reservation) return;
    navigator.clipboard.writeText(reservation.url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => undefined);
  }

  return (
    <div className="space-y-4 rounded-2xl p-4" style={{ background: "var(--color-paper-100)", border: "1px solid var(--color-paper-300)" }}>
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>🌐 {termExternalGuest}を招待（任意）</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
          チャプター外の方を、作成と同時に招待できます。メールアドレスがわかる方は、「名前とメールだけで招待」か「外部人脈に登録して招待」のどちらかで指定すると、招待メールが届きます。わからない方には、共有URLをお伝えください（回答のときに、名前・メールアドレス・会社名を入力してもらいます）。
        </p>
      </div>

      {/* ゲスト用の共有URL（作成前に発行） */}
      <div className="space-y-2">
        <p className="text-xs font-medium" style={{ color: "var(--color-ink-600)" }}>🔗 ゲスト用の共有URL（メールアドレスのわからない方に。先に発行して、送っておけます）</p>
        {reservation ? (
          <>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "var(--color-paper-200)" }}>
              <span className="flex-1 text-xs break-all" style={{ color: "var(--color-ink-600)" }}>{reservation.url}</span>
              <button type="button" onClick={copy} className="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl font-medium"
                style={{ background: copied ? "rgba(90,140,92,0.15)" : "var(--color-brand)", color: copied ? "var(--color-success)" : "white" }}>
                {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "コピー済" : "コピー"}
              </button>
            </div>
            <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
              {fmtDateTimeFull(reservation.expiresAt, tz)} まで有効です。作成するまでは、開いた方に「準備中」と表示されます。作成すると、そのまま日程の回答ができるようになります。作成せずにやめた場合は、期限が来ると自動で無効になります。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="px-3 py-1.5 rounded-xl border text-xs" style={inputStyle} aria-label="有効期間">
                {DAY_OPTIONS.map((d) => <option key={d} value={d}>{d}日間</option>)}
              </select>
              <button type="button" onClick={() => issue.mutate()} disabled={issue.isPending}
                className="px-3 py-1.5 rounded-xl text-xs font-medium disabled:opacity-60" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
                {issue.isPending ? "更新中…" : "有効期間を、今日からこの日数に変える"}
              </button>
              <button type="button" onClick={() => { if (window.confirm("このURLを無効にしますか？すでに送ったURLは、開けなくなります。")) discard.mutate(); }}
                disabled={discard.isPending} className="px-3 py-1.5 rounded-xl text-xs disabled:opacity-60" style={{ color: "var(--color-ink-500)" }}>
                URLを無効にする
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="px-3 py-2 rounded-xl border text-sm" style={inputStyle} aria-label="有効期間">
              {DAY_OPTIONS.map((d) => <option key={d} value={d}>{d}日間有効{d === 7 ? "（おすすめ）" : ""}</option>)}
            </select>
            <button type="button" onClick={() => issue.mutate()} disabled={issue.isPending}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-60" style={{ background: "var(--color-brand)", color: "white" }}>
              {issue.isPending ? <Loader2 size={14} className="animate-spin" /> : <LinkIcon size={14} />}URLを発行する
            </button>
          </div>
        )}
        {(issue.isError || discard.isError) && (
          <p className="text-xs" style={{ color: "var(--color-brand)" }}>
            {(issue.error ?? discard.error) instanceof ApiError ? (issue.error ?? discard.error)!.message : "うまくいきませんでした。時間をおいてもう一度お試しください"}
          </p>
        )}
      </div>

      {/* ゲストを個別に指定 */}
      <GuestPicker guests={guests} onGuestsChange={onGuestsChange} />
    </div>
  );
}
