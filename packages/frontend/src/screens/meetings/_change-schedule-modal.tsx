// =============================================================
// 確定したあとの「日程を変更する」ダイアログ（複数人ミーティング・主催者用）
//  ・確定済みの日ごとに「そのまま／日時を変更／中止にする」を選べる
//  ・新しい日を追加できる（追加した日は、そのまま開催日になる）
//  ・まとめて確認 → 変更する、の2段階。確認画面で、お知らせメールの送り先が分かる
//  ・メールは、1人に1通にまとめて届く
//     - 中止・日時変更：その日に参加表明していた人（日時変更・中止になった日の回答は取り消され、選び直してもらう）
//     - 追加：もともとの案内の対象者全員
// =============================================================
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useTimezone } from "@/hooks/use-timezone";
import { formatRangeText } from "@/lib/schedule-text";
import { DEFAULT_START_TIME } from "@/lib/meeting-time";

export type ChangeScheduleDate = { id: string; startsAt: number; endsAt: number | null };

type Kind = "keep" | "change" | "cancel";
type DateState = { kind: Kind; date: string; time: string };
type AddRow = { key: string; date: string; time: string };

type Summary = {
  cancelCount: number;
  rescheduleCount: number;
  addCount: number;
  declaredNames: string[];
  addRecipientCount: number;
  mailCount: number;
};
type ChangeResponse = { ok: boolean; preview: boolean; summary: Summary };

const pad = (n: number) => String(n).padStart(2, "0");
function toLocalInputs(ts: number): { date: string; time: string } {
  const d = new Date(ts * 1000);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
function toUnix(date: string, time: string): number {
  return Math.floor(new Date(`${date}T${time}:00`).getTime() / 1000);
}
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const pill = (active: boolean, tone: "neutral" | "warn" | "danger") => {
  const color = tone === "danger" ? "var(--color-brand)" : tone === "warn" ? "var(--color-accent)" : "var(--color-success)";
  const bg = tone === "danger" ? "rgba(181,56,75,0.12)" : tone === "warn" ? "rgba(212,160,59,0.18)" : "rgba(90,140,92,0.15)";
  return {
    background: active ? bg : "var(--color-paper-200)",
    color: active ? color : "var(--color-ink-600)",
    border: active ? `1.5px solid ${color}` : "1.5px solid transparent",
  };
};

const inputStyle = { borderColor: "var(--color-paper-300)", background: "white" };

export function ChangeScheduleModal({ meetingId, dates, durationMinutes, onClose, onDone }: {
  meetingId: string;
  dates: ChangeScheduleDate[];
  /** 新しく追加する日の所要時間（分） */
  durationMinutes: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const tz = useTimezone();
  const [nowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [states, setStates] = useState<Record<string, DateState>>(() =>
    Object.fromEntries(dates.map((d) => [d.id, { kind: "keep" as Kind, ...toLocalInputs(d.startsAt) }])));
  const [adds, setAdds] = useState<AddRow[]>([]);
  const [step, setStep] = useState<"edit" | "confirm">("edit");
  const [preview, setPreview] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const durationOf = (d: ChangeScheduleDate): number => {
    const m = d.endsAt ? Math.round((d.endsAt - d.startsAt) / 60) : durationMinutes;
    return m > 0 && m <= 720 ? m : durationMinutes;
  };
  const isPast = (d: ChangeScheduleDate) => (d.endsAt ?? d.startsAt + 3600) < nowSec;
  const setKind = (id: string, kind: Kind) => setStates((s) => ({ ...s, [id]: { ...s[id], kind } }));
  const setField = (id: string, field: "date" | "time", value: string) => setStates((s) => ({ ...s, [id]: { ...s[id], [field]: value } }));

  const cancelIds = dates.filter((d) => states[d.id]?.kind === "cancel").map((d) => d.id);
  const changeRows = dates
    .filter((d) => states[d.id]?.kind === "change")
    .map((d) => ({ d, st: states[d.id], startsAt: states[d.id].date && states[d.id].time ? toUnix(states[d.id].date, states[d.id].time) : 0 }));
  const addRows = adds.map((a) => ({ a, startsAt: a.date && a.time ? toUnix(a.date, a.time) : 0 }));

  const changeValid = changeRows.every((r) => r.startsAt > nowSec && r.startsAt !== r.d.startsAt);
  const addValid = addRows.every((r) => r.startsAt > nowSec);
  const remainingDates = dates.length - cancelIds.length + adds.length;
  const hasChange = cancelIds.length + changeRows.length + adds.length > 0;
  const canReview = hasChange && changeValid && addValid && remainingDates > 0;

  const payload = {
    cancel: cancelIds,
    reschedule: changeRows.map((r) => ({ candidateId: r.d.id, startsAt: r.startsAt, endsAt: r.startsAt + durationOf(r.d) * 60 })),
    add: addRows.map((r) => ({ startsAt: r.startsAt, endsAt: r.startsAt + durationMinutes * 60 })),
  };

  const errorText = (e: unknown) => e instanceof ApiError ? e.message : "うまく送れませんでした。通信状況をご確認のうえ、もう一度お試しください。";

  const previewMutation = useMutation({
    mutationFn: () => api.post<ChangeResponse>(`/meetings/${meetingId}/schedule-changes`, { ...payload, preview: true }),
    onSuccess: (res) => { setPreview(res.summary); setStep("confirm"); setError(null); },
    onError: (e) => setError(errorText(e)),
  });
  const applyMutation = useMutation({
    mutationFn: () => api.post<ChangeResponse>(`/meetings/${meetingId}/schedule-changes`, payload),
    onSuccess: () => onDone(),
    onError: (e) => setError(errorText(e)),
  });
  const busy = previewMutation.isPending || applyMutation.isPending;

  const textOf = (startsAt: number, endsAt: number | null) => formatRangeText(startsAt, endsAt, tz);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(26,20,16,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="card-paper rounded-3xl w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <p className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>🗓️ 日程を変更する</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
            中止・日時の変更・日程の追加を、まとめて行えます。お知らせのメールは、<strong>1人に1通にまとめて</strong>お送りします。
          </p>
        </div>

        {step === "edit" ? (
          <>
            <div className="space-y-2">
              <p className="text-xs font-medium" style={{ color: "var(--color-ink-600)" }}>いまの開催日程</p>
              {dates.map((d) => {
                const st = states[d.id];
                const past = isPast(d);
                return (
                  <div key={d.id} className="rounded-2xl p-3 space-y-2" style={{ background: "var(--color-paper-100)", border: "1px solid var(--color-paper-300)" }}>
                    <p className="text-sm font-medium" style={{ color: "var(--color-ink-900)", textDecoration: st.kind === "cancel" ? "line-through" : "none", opacity: st.kind === "cancel" ? 0.6 : 1 }}>
                      {textOf(d.startsAt, d.endsAt)}
                    </p>
                    {past ? (
                      <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>すでに終わった日程のため、変更できません</p>
                    ) : (
                      <>
                        <div className="flex gap-1.5">
                          <button type="button" onClick={() => setKind(d.id, "keep")} className="flex-1 py-1.5 rounded-xl text-xs font-medium" style={pill(st.kind === "keep", "neutral")}>そのまま</button>
                          <button type="button" onClick={() => setKind(d.id, "change")} className="flex-1 py-1.5 rounded-xl text-xs font-medium" style={pill(st.kind === "change", "warn")}>日時を変更</button>
                          <button type="button" onClick={() => setKind(d.id, "cancel")} className="flex-1 py-1.5 rounded-xl text-xs font-medium" style={pill(st.kind === "cancel", "danger")}>中止にする</button>
                        </div>
                        {st.kind === "change" && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <input type="date" value={st.date} min={todayStr()} onChange={(e) => setField(d.id, "date", e.target.value)} className="px-2 py-1.5 rounded-lg text-xs border" style={inputStyle} />
                            <input type="time" value={st.time} onChange={(e) => setField(d.id, "time", e.target.value)} className="px-2 py-1.5 rounded-lg text-xs border" style={inputStyle} />
                            <span className="text-xs" style={{ color: "var(--color-ink-500)" }}>に変更（{durationOf(d)}分間）</span>
                          </div>
                        )}
                        {st.kind === "change" && !changeValid && (changeRows.find((r) => r.d.id === d.id)?.startsAt ?? 0) <= nowSec && (
                          <p className="text-xs" style={{ color: "var(--color-brand)" }}>未来の日時を入れてください</p>
                        )}
                        {st.kind === "change" && changeRows.find((r) => r.d.id === d.id)?.startsAt === d.startsAt && (
                          <p className="text-xs" style={{ color: "var(--color-brand)" }}>いまと同じ日時です。変えるか、「そのまま」を選んでください</p>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium" style={{ color: "var(--color-ink-600)" }}>新しく追加する日程</p>
              {adds.map((a) => (
                <div key={a.key} className="flex items-center gap-2 flex-wrap">
                  <input type="date" value={a.date} min={todayStr()} onChange={(e) => setAdds((rows) => rows.map((r) => r.key === a.key ? { ...r, date: e.target.value } : r))} className="px-2 py-1.5 rounded-lg text-xs border" style={inputStyle} />
                  <input type="time" value={a.time} onChange={(e) => setAdds((rows) => rows.map((r) => r.key === a.key ? { ...r, time: e.target.value } : r))} className="px-2 py-1.5 rounded-lg text-xs border" style={inputStyle} />
                  <span className="text-xs" style={{ color: "var(--color-ink-500)" }}>（{durationMinutes}分間）</span>
                  <button type="button" onClick={() => setAdds((rows) => rows.filter((r) => r.key !== a.key))} aria-label="この行を消す" className="ml-auto p-1.5 rounded-lg" style={{ color: "var(--color-ink-400)" }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {!addValid && <p className="text-xs" style={{ color: "var(--color-brand)" }}>追加する日程には、未来の日付と時刻を入れてください</p>}
              <button type="button" onClick={() => setAdds((rows) => [...rows, { key: crypto.randomUUID(), date: "", time: DEFAULT_START_TIME }])}
                className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-2xl border" style={{ borderColor: "var(--color-paper-300)", color: "var(--color-ink-600)", background: "white" }}>
                <Plus size={12} /> 日程を追加する
              </button>
            </div>

            {remainingDates === 0 && (
              <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>
                すべての日程を中止にはできません。会そのものをやめる場合は、画面の「ミーティングをキャンセル」をご利用ください。
              </p>
            )}
            {error && <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>{error}</p>}

            <div className="flex gap-2">
              <button type="button" onClick={onClose} disabled={busy} className="flex-1 py-2.5 rounded-2xl text-sm" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>閉じる</button>
              <button type="button" onClick={() => { setError(null); previewMutation.mutate(); }} disabled={!canReview || busy}
                className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-1.5" style={{ background: "var(--color-brand)" }}>
                {previewMutation.isPending && <Loader2 size={14} className="animate-spin" />}内容を確認する
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-2xl p-3 space-y-3 text-sm" style={{ background: "var(--color-paper-100)", border: "1px solid var(--color-paper-300)", color: "var(--color-ink-800)" }}>
              {cancelIds.length > 0 && (
                <div>
                  <p className="text-xs font-semibold" style={{ color: "var(--color-brand)" }}>中止にする日程（{cancelIds.length}日）</p>
                  {dates.filter((d) => cancelIds.includes(d.id)).map((d) => <p key={d.id}>・{textOf(d.startsAt, d.endsAt)}</p>)}
                </div>
              )}
              {changeRows.length > 0 && (
                <div>
                  <p className="text-xs font-semibold" style={{ color: "var(--color-accent)" }}>日時を変更する日程（{changeRows.length}日）</p>
                  {changeRows.map((r) => (
                    <p key={r.d.id}>・{textOf(r.d.startsAt, r.d.endsAt)}<br /><span style={{ marginLeft: "1em" }}>→ {textOf(r.startsAt, r.startsAt + durationOf(r.d) * 60)}</span></p>
                  ))}
                </div>
              )}
              {addRows.length > 0 && (
                <div>
                  <p className="text-xs font-semibold" style={{ color: "var(--color-success)" }}>追加する日程（{addRows.length}日）</p>
                  {addRows.map((r) => <p key={r.a.key}>・{textOf(r.startsAt, r.startsAt + durationMinutes * 60)}</p>)}
                </div>
              )}
            </div>

            {preview && (
              <div className="rounded-2xl p-3 space-y-1.5 text-xs" style={{ background: "rgba(212,160,59,0.10)", border: "1px solid rgba(212,160,59,0.3)", color: "var(--color-ink-700)" }}>
                <p className="font-semibold">📧 お知らせのメール（1人に1通）</p>
                {(preview.cancelCount > 0 || preview.rescheduleCount > 0) && (preview.declaredNames.length > 0 ? (
                  <p>
                    ・中止・日時変更：その日に参加表明していた{preview.declaredNames.length}人に、参加できる日を選び直してもらうお願いを送ります
                    （{preview.declaredNames.slice(0, 8).join("さん、")}さん{preview.declaredNames.length > 8 ? `ほか${preview.declaredNames.length - 8}人` : ""}）
                  </p>
                ) : (
                  <p>・中止・日時変更：その日に参加表明していた人はいないため、この件のメールは送りません</p>
                ))}
                {preview.addCount > 0 && <p>・追加：もともとの案内の対象者{preview.addRecipientCount}人に、日程が増えたことを送ります</p>}
                <p>・両方に当てはまる人には、1通にまとめて送ります。送るメールは<strong>全部で{preview.mailCount}通</strong>です</p>
                {(preview.cancelCount > 0 || preview.rescheduleCount > 0) && <p>・中止・日時変更になった日の、みなさんの回答は取り消されます</p>}
              </div>
            )}
            {error && <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>{error}</p>}

            <div className="flex gap-2">
              <button type="button" onClick={() => { setStep("edit"); setError(null); }} disabled={busy} className="flex-1 py-2.5 rounded-2xl text-sm" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>戻る</button>
              <button type="button" onClick={() => { setError(null); applyMutation.mutate(); }} disabled={busy}
                className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-1.5" style={{ background: "var(--color-success)" }}>
                {applyMutation.isPending && <Loader2 size={14} className="animate-spin" />}この内容で変更する
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
