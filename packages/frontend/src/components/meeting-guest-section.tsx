// =============================================================
// ミーティング・定例会の作成画面で、外部ゲスト（ビジター）を招待する部分
//   連絡のしかたは、次の2つ。どちらか一方でも、両方の組み合わせでもよい（画面でも、そのことがひと目でわかるよう、2枚のカードに分けて見せる）。
//   ・ゲスト用の共有URL: 作成する前に、URLだけ先に発行できる（有効期間は発行時に選べる。初期値は、管理設定の「日程調整のURLの有効期間」）。
//     作成すると、同じURLがそのままミーティング・定例会のゲスト用URLになる。作成せずにやめたものは、期限が来たら自動で削除される。
//     作成前にURLを開いた人には、「準備中」と表示される。
//   ・ゲストを個別に指定（メールで案内する方は、メールアドレスが必須。回答を、メールアドレスで対応づけるため）。次の2つの流れから選べる。
//       - 名前（とメール）だけで招待（かんたん）: 外部人脈には登録しない。ゲストが回答で会社名を入力したときだけ、人脈に自動登録される。
//         「招待メールを送る」をオフにすると、名前だけで加えられる（メールは送らず、作成の直後に、専用URLとDM用の文面を見せる）。
//         オン・オフの初期値は、管理設定「外部の方との連絡」に従う。
//       - 外部人脈から選ぶ・登録して招待: 登録済みの人脈から選ぶ。いない場合は、その場で人脈に登録（名前・会社名・メールアドレス・公開範囲）して招待する。
//         この方々には、設定に関わらず、いつも招待メールを送る。
//     作成と同時に、全員に招待メールを送る。人脈にメールアドレスがない場合は、ここで入力して人脈に保存することもできる。
//   ・DMなどで連絡する方には、共有URL（複数人にまとめて送れる）か、専用URLをお伝えする（回答時に、名前・メールアドレス・会社名を入力してもらう）。
// =============================================================
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link as LinkIcon, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";
import { fmtDateTimeFull } from "@/lib/date";
import { useTimezone } from "@/hooks/use-timezone";
import { GuestPicker, type GuestDraft } from "./guest-picker";

export { guestsToPayload, guestMissingEmail, hasDmGuest, type GuestDraft } from "./guest-picker";
type Reservation = { token: string; expiresAt: number; url: string };

// 有効期間の選択肢（時間）。管理設定の選択肢（6時間・12時間・1日・3日・1週間・2週間）に、30日・60日を加えたもの
const HOUR_OPTIONS = [6, 12, 24, 72, 168, 336, 720, 1440];
const FALLBACK_HOURS = 72;
function hoursLabel(h: number): string {
  if (h < 24) return `${h}時間`;
  if (h === 24) return "1日";
  if (h === 168) return "1週間";
  if (h === 336) return "2週間";
  return h % 24 === 0 ? `${h / 24}日間` : `${h}時間`;
}
const inputStyle = { background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" } as const;

/** 招待のしかた1つ分のカード（見出し・説明・いまの状態を示すバッジ） */
function MethodCard({ icon, title, lead, points, status, statusOn, children }: {
  icon: string; title: string; lead: string; points: string[]; status: string; statusOn: boolean; children: ReactNode;
}) {
  return (
    <section className="rounded-2xl p-3.5 space-y-3" style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 shrink-0 rounded-xl flex items-center justify-center text-base" style={{ background: "rgba(181,56,75,0.08)" }}>{icon}</span>
          <h3 className="flex-1 min-w-0 text-sm font-semibold" style={{ color: "var(--color-ink-900)" }}>{title}</h3>
          <span className="shrink-0 text-[11px] font-medium px-2.5 py-0.5 rounded-full"
            style={statusOn ? { background: "rgba(90,140,92,0.15)", color: "var(--color-success)" } : { background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
            {statusOn ? "✓ " : ""}{status}
          </span>
        </div>
        <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>{lead}</p>
        <ul className="rounded-xl px-3 py-2 space-y-1 text-xs" style={{ background: "rgba(90,140,92,0.08)", color: "var(--color-ink-700)" }}>
          {points.map((t) => (
            <li key={t} className="flex gap-1.5"><span className="shrink-0" style={{ color: "var(--color-success)" }} aria-hidden="true">✓</span><span>{t}</span></li>
          ))}
        </ul>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

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
  // 有効期間は、選ぶまでは管理設定の値（初期設定）。選んだあとは、その選択を優先する
  const [pickedHours, setPickedHours] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const reservationKey = ["invite-reservation", kind];
  const { data: reservationData } = useQuery({
    queryKey: reservationKey,
    queryFn: () => api.get<{ data: Reservation | null; defaultHours?: number }>(`/invite-reservations?kind=${kind}`),
  });
  const reservation = reservationData?.data ?? null;
  const defaultHours = reservationData?.defaultHours ?? FALLBACK_HOURS;
  const hours = pickedHours ?? defaultHours;
  const hourOptions = HOUR_OPTIONS.includes(hours) ? HOUR_OPTIONS : [...HOUR_OPTIONS, hours].sort((a, b) => a - b);
  useEffect(() => { onReservationChange(reservation?.token ?? null); }, [reservation?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const issue = useMutation({
    mutationFn: () => api.post<{ data: Reservation }>("/invite-reservations", { kind, hours }),
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
    <div className="space-y-3 rounded-2xl p-4" style={{ background: "var(--color-paper-100)", border: "1px solid var(--color-paper-300)" }}>
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>🌐 {termExternalGuest}を招待（任意）</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
          チャプター外の方への連絡のしかたは、次の2つです。<strong style={{ color: "var(--color-ink-700)" }}>どちらか一方だけでも、両方を組み合わせても</strong>使えます。
        </p>
      </div>

      {/* 方法1: ゲスト用の共有URL（作成前に発行） */}
      <MethodCard
        icon="🔗"
        title="ゲスト用の共有URLを送る"
        lead="DMやチャットで、同じURLを何人にもまとめて送れる、かんたんな方法です。先にURLだけ発行して、送っておくこともできます。"
        points={[
          "誰を呼ぶか決まっていなくても、先に送れます",
          "人数が多くても、同じURLを送るだけです",
        ]}
        status={reservation ? "発行済み" : "未発行"}
        statusOn={!!reservation}
      >
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
              <select value={hours} onChange={(e) => setPickedHours(Number(e.target.value))} className="px-3 py-1.5 rounded-xl border text-xs" style={inputStyle} aria-label="有効期間">
                {hourOptions.map((h) => <option key={h} value={h}>{hoursLabel(h)}{h === defaultHours ? "（初期設定）" : ""}</option>)}
              </select>
              <button type="button" onClick={() => issue.mutate()} disabled={issue.isPending}
                className="px-3 py-1.5 rounded-xl text-xs font-medium disabled:opacity-60" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
                {issue.isPending ? "更新中…" : "有効期間を、今からこの期間に変える"}
              </button>
              <button type="button" onClick={() => { if (window.confirm("このURLを無効にしますか？すでに送ったURLは、開けなくなります。")) discard.mutate(); }}
                disabled={discard.isPending} className="px-3 py-1.5 rounded-xl text-xs disabled:opacity-60" style={{ color: "var(--color-ink-500)" }}>
                URLを無効にする
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select value={hours} onChange={(e) => setPickedHours(Number(e.target.value))} className="px-3 py-2 rounded-xl border text-sm" style={inputStyle} aria-label="有効期間">
              {hourOptions.map((h) => <option key={h} value={h}>{hoursLabel(h)}有効{h === defaultHours ? "（初期設定）" : ""}</option>)}
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
      </MethodCard>

      {/* 2つの方法のつなぎ（組み合わせてもよいことを伝える） */}
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="flex-1 h-px" style={{ background: "var(--color-paper-300)" }} />
        <span className="text-xs font-medium px-3 py-1 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>＋ 組み合わせてもOK</span>
        <span className="flex-1 h-px" style={{ background: "var(--color-paper-300)" }} />
      </div>

      {/* 方法2: ゲストを個別に指定 */}
      <MethodCard
        icon="👤"
        title="ゲストを個別に指定する"
        lead="お一人ずつ名前を入れて、招待する方法です。招待メールを送ることも、その方だけの専用URLをDMでお渡しすることもできます。"
        points={[
          "回答を待つ間も、誰が回答済みで、誰が未回答かを、名前で確認できます",
          "未回答の方に、あとからリマインダーを送れます（メールで案内した方）",
          "招待メールが自動で届くので、DMを一人ずつ送る手間がかかりません",
          "外部人脈の方を選べば、人脈に残したまま招待できます",
        ]}
        status={guests.length > 0 ? `${guests.length}人 追加済み` : "未追加"}
        statusOn={guests.length > 0}
      >
        <GuestPicker guests={guests} onGuestsChange={onGuestsChange} allowNoEmail heading="追加のしかたを選んでください" />
      </MethodCard>
    </div>
  );
}
