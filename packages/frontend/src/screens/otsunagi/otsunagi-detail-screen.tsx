// =============================================================
// お繋ぎ（ご紹介）の詳細
//   紹介者: 進み具合を見る画面（見るだけ。確定した日時も表示。取り消しだけできる）
//   お繋ぎ先のメンバー: 日程の決め方を選ぶ（予約ページ／候補日）、または見送る
// =============================================================
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, Circle, Copy, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { GoogleNotConnectedWarning } from "@/components/google-not-connected-warning";
import { DurationSelect } from "@/components/duration-select";
import { SchedulingMethodSelector, type SchedulingMethod } from "../meetings/_scheduling-method-selector";
import { CandidateDateEntry, isValidCandidateSet, candidateRowsToPayload, emptyCandidateRow, type CandidateRow } from "../meetings/_candidate-date-entry";
import { StageBadge } from "./otsunagi-screen";
import { buildGuestMessage, fmtDate, fmtRange, type OtsunagiDetail } from "./_types";

function fmtSlot(startSec: number, endSec: number): string {
  const d = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(startSec * 1000));
  const e = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }).format(new Date(endSec * 1000));
  return `${d}〜${e}`;
}

type Step = { label: string; note?: string; done: boolean; current: boolean };

/** 紹介者向けの進み具合（4つの段階） */
function buildSteps(d: OtsunagiDetail): Step[] {
  const prepared = d.preparedAt !== null && d.stage !== "waiting_member";
  const finished = d.stage === "confirmed" || d.stage === "done";
  const stopped = d.stage === "declined" || d.stage === "cancelled" || d.stage === "expired";
  return [
    { label: "お繋ぎを作りました", note: `${fmtDate(d.createdAt)}`, done: true, current: false },
    {
      label: `${d.member.name}さんが、日程を準備`,
      note: prepared ? (d.method === "public_url" ? "予約ページを用意しました" : "候補日を送りました") : "準備待ち",
      done: prepared || finished, current: !prepared && !finished && !stopped,
    },
    {
      label: `${d.guestName}さんが、日時を選ぶ`,
      note: finished ? "選びました" : prepared
        ? [d.guestOpened ? "案内のページを開いています" : "まだ、案内のページは開かれていません", d.guestEmailRegistered ? "メールアドレス登録済み" : null].filter(Boolean).join(" ／ ")
        : undefined,
      done: finished, current: prepared && !finished && !stopped,
    },
    { label: "日程が決まりました", note: d.confirmed ? fmtRange(d.confirmed.startAtUtc, d.confirmed.endAtUtc) : undefined, done: finished, current: false },
  ];
}

function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
              style={{ background: s.done ? "var(--color-success)" : "var(--color-paper-200)", border: s.current ? "2px solid var(--color-brand)" : "none" }}>
              {s.done ? <Check size={13} color="white" /> : <Circle size={8} style={{ color: s.current ? "var(--color-brand)" : "var(--color-ink-300)" }} />}
            </div>
            {i < steps.length - 1 && <div className="w-0.5 flex-1 min-h-4" style={{ background: s.done ? "var(--color-success)" : "var(--color-paper-300)" }} />}
          </div>
          <div className="pb-4 min-w-0">
            <p className="text-sm font-medium" style={{ color: s.done || s.current ? "var(--color-ink-900)" : "var(--color-ink-400)" }}>{s.label}</p>
            {s.note && <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>{s.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function PrepareForm({ detail }: { detail: OtsunagiDetail }) {
  const qc = useQueryClient();
  const googleConnected = detail.googleConnected === true;
  const [method, setMethod] = useState<SchedulingMethod>(googleConnected ? "public_url" : "candidates");
  const [duration, setDuration] = useState(60);
  const [rows, setRows] = useState<CandidateRow[]>([emptyCandidateRow(), emptyCandidateRow()]);
  const [error, setError] = useState("");

  const prepare = useMutation({
    mutationFn: () => api.post(`/otsunagi/${detail.id}/prepare`, {
      method, durationMinutes: duration,
      candidateSlots: method === "candidates" ? candidateRowsToPayload(rows, duration) : undefined,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["otsunagi"] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : "うまく進められませんでした。少し待ってから、もう一度お試しください。"),
  });

  function submit() {
    setError("");
    if (method === "candidates" && !isValidCandidateSet(rows)) { setError("候補の日時を、2〜20件、正しく入力してください"); return; }
    prepare.mutate();
  }

  return (
    <section className="card-paper rounded-2xl p-4 mb-4">
      <h2 className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink-800)" }}>日程の決め方を選んでください</h2>
      <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
        あなたと{detail.guestName}さんの1to1になります。会議のURL（Zoom・Google Meet）は、あなたの連携先から、日時が決まったときに自動で作られます。
      </p>
      {!googleConnected && <GoogleNotConnectedWarning />}
      <SchedulingMethodSelector method={method} onChange={setMethod} googleConnected={googleConnected} copy="member" />
      <div className="mt-3"><DurationSelect value={duration} onChange={setDuration} label="所要時間" /></div>
      {method === "candidates" && (
        <div className="mt-3">
          <CandidateDateEntry candidates={rows} onChange={setRows} googleConnected={googleConnected} duration={duration} />
        </div>
      )}
      {error && <p className="text-xs mt-3 px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>{error}</p>}
      <button onClick={submit} disabled={prepare.isPending} className="mt-4 w-full py-3 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
        {prepare.isPending && <Loader2 size={15} className="animate-spin" />}
        {method === "public_url" ? "予約ページを用意する" : "この候補日で用意する"}
      </button>
      <p className="text-[11px] text-center mt-2" style={{ color: "var(--color-ink-400)" }}>
        用意ができると、{detail.guestName}さんに、日時を選べるようになったことが伝わります。
      </p>
    </section>
  );
}

export function OtsunagiDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const meName = useAuthStore((s) => s.user?.name) ?? "";
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["otsunagi", "detail", id],
    queryFn: () => api.get<{ data: OtsunagiDetail }>(`/otsunagi/${id}`),
    enabled: !!id,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const detail = data?.data;

  const decline = useMutation({
    mutationFn: () => api.post(`/otsunagi/${id}/decline`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["otsunagi"] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : "うまく進められませんでした"),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/otsunagi/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["otsunagi"] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : "うまく進められませんでした"),
  });

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* 手で選んでもらう */ }
  }

  const back = (
    <button onClick={() => navigate("/meetings?tab=otsunagi")} className="p-2 rounded-2xl hover:opacity-70" style={{ background: "var(--color-paper-200)" }} aria-label="お繋ぎの一覧へ">
      <ChevronLeft size={18} style={{ color: "var(--color-ink-600)" }} />
    </button>
  );

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="animate-spin" style={{ color: "var(--color-brand)" }} /></div>;
  if (isError || !detail) {
    return (
      <div className="px-4 py-6 max-w-xl mx-auto">
        <div className="mb-4">{back}</div>
        <p className="text-sm text-center py-10" style={{ color: "var(--color-ink-500)" }}>お繋ぎが見つかりませんでした。一覧から、開き直してください。</p>
      </div>
    );
  }

  const isIntroducer = detail.role === "introducer";
  const open = ["waiting_member", "arranging", "booking_cancelled"].includes(detail.stage);
  const canCancel = isIntroducer && (open || detail.stage === "expired");
  const guestText = detail.receptionUrl
    ? buildGuestMessage({ guestName: detail.guestName, introducerName: meName, memberName: detail.member.name, url: detail.receptionUrl })
    : "";

  return (
    <div className="px-4 py-6 pb-24 max-w-xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        {back}
        <h1 className="text-lg font-semibold truncate" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          🔗 {isIntroducer ? `${detail.member.name}さん ⇄ ${detail.guestName}さん` : `${detail.guestName}さんとのお繋ぎ`}
        </h1>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StageBadge item={detail} />
        <span className="text-[11px]" style={{ color: "var(--color-ink-400)" }}>
          {isIntroducer ? `${detail.member.name}さんへ` : `${detail.introducer.name}さんから`}・{fmtDate(detail.createdAt)}
        </span>
      </div>

      {detail.confirmed && (
        <section className="rounded-2xl p-4 mb-4" style={{ background: "rgba(90,140,92,0.12)", border: "1.5px solid var(--color-success)" }}>
          <p className="text-xs font-medium mb-1" style={{ color: "#3D6B3F" }}>📅 1to1の日時</p>
          <p className="text-base font-bold" style={{ color: "var(--color-ink-900)" }}>{fmtRange(detail.confirmed.startAtUtc, detail.confirmed.endAtUtc)}</p>
          {isIntroducer ? (
            <p className="text-[11px] mt-1.5" style={{ color: "var(--color-ink-500)" }}>
              {detail.member.name}さんと{detail.guestName}さんの1to1です。あなたは参加しないので、あなたのカレンダーには、予定を入れていません。
            </p>
          ) : detail.bookingId ? (
            <Link to={`/scheduler/bookings/${detail.bookingId}`} className="inline-block mt-2 text-xs font-medium underline" style={{ color: "var(--color-brand)" }}>予約の詳細（会議URLなど）を見る</Link>
          ) : null}
        </section>
      )}

      {/* 紹介者のひとこと／ご紹介の内容 */}
      <section className="card-paper rounded-2xl p-4 mb-4">
        <p className="text-xs font-medium mb-1.5" style={{ color: "var(--color-ink-500)" }}>
          {isIntroducer ? "あなたが書いたひとこと" : `${detail.introducer.name}さんからのひとこと`}
        </p>
        <p className="text-sm whitespace-pre-wrap" style={{ color: detail.message ? "var(--color-ink-800)" : "var(--color-ink-400)" }}>
          {detail.message || "（ひとことは、ありません）"}
        </p>
        <p className="text-xs mt-3" style={{ color: "var(--color-ink-500)" }}>
          外部の方：<span className="font-medium" style={{ color: "var(--color-ink-800)" }}>{detail.guestName}さん</span>{detail.guestCompany ? `（${detail.guestCompany}）` : ""}
        </p>
      </section>

      {/* お繋ぎ先のメンバー: 日程の準備 */}
      {!isIntroducer && (detail.stage === "waiting_member" || detail.stage === "booking_cancelled") && <PrepareForm detail={detail} />}

      {!isIntroducer && detail.stage === "arranging" && (
        <section className="card-paper rounded-2xl p-4 mb-4">
          <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink-800)" }}>日程の準備は、できています</p>
          <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
            {detail.guestName}さんが日時を選ぶのを、お待ちください。決まったら、予約のお知らせが届きます。
            {detail.method === "public_url" ? "（予約ページ方式）" : "（候補日方式）"}
          </p>
          {detail.candidateSlots.length > 0 && (
            <ul className="mt-2 space-y-1">
              {detail.candidateSlots.map((s, i) => <li key={i} className="text-xs" style={{ color: "var(--color-ink-700)" }}>・{fmtSlot(s.startAt, s.endAt)}</li>)}
            </ul>
          )}
        </section>
      )}

      {/* 紹介者: 進み具合 */}
      {isIntroducer && (
        <section className="card-paper rounded-2xl p-4 mb-4">
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink-800)" }}>お繋ぎの進み具合</h2>
          <StepList steps={buildSteps(detail)} />
          {open && <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>有効期限：{fmtDate(detail.expiresAt)}まで。あなたが、することはありません。</p>}
          {detail.stage === "declined" && <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>{detail.member.name}さんの都合で、今回は見送りになりました。</p>}
          {detail.stage === "expired" && <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>期限までに、日時が決まりませんでした。必要なら、新しくお繋ぎしてください。</p>}
        </section>
      )}

      {/* 紹介者: 案内文（必要なときだけ） */}
      {isIntroducer && open && detail.receptionUrl && (
        <details className="card-paper rounded-2xl p-4 mb-4">
          <summary className="text-sm font-medium cursor-pointer" style={{ color: "var(--color-ink-700)" }}>{detail.guestName}さんへの案内文を、もう一度見る</summary>
          <p className="text-xs mt-3 mb-2" style={{ color: "var(--color-ink-500)" }}>最初にお送りした案内が届いていないときだけ、使ってください。</p>
          <textarea readOnly value={guestText} rows={8} className="w-full px-3 py-2.5 rounded-xl border text-sm leading-relaxed"
            style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)", color: "var(--color-ink-800)" }} onFocus={(e) => e.currentTarget.select()} />
          <button onClick={() => copy(guestText)} className="mt-2 w-full py-2.5 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2" style={{ background: "var(--color-brand)" }}>
            {copied ? <><Check size={15} /> コピーしました</> : <><Copy size={15} /> 案内文をコピー</>}
          </button>
        </details>
      )}

      {error && <p className="text-xs mb-3 px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>{error}</p>}

      {!isIntroducer && open && (
        <button
          onClick={() => { if (window.confirm(`${detail.guestName}さんとのお繋ぎを、見送りますか？\n${detail.introducer.name}さんに、見送ったことをお知らせします。`)) decline.mutate(); }}
          disabled={decline.isPending} className="w-full py-2.5 rounded-2xl text-sm font-medium disabled:opacity-50" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          {decline.isPending ? "処理中…" : "今回は見送る"}
        </button>
      )}
      {canCancel && (
        <button
          onClick={() => { if (window.confirm("このお繋ぎを、取り消しますか？\n外部の方の案内ページは、使えなくなります。")) cancel.mutate(); }}
          disabled={cancel.isPending} className="w-full py-2.5 rounded-2xl text-sm font-medium disabled:opacity-50" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          {cancel.isPending ? "処理中…" : "このお繋ぎを取り消す"}
        </button>
      )}
    </div>
  );
}
