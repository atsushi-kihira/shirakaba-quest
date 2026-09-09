// =============================================================
// 定例会（繰り返しミーティング）詳細画面
// voting中: 候補パターンへの投票（通常ミーティングと同じ回答グリッドUI）・主催者による確定
// confirmed以降: 開催回の一覧（各回は既存のミーティング詳細画面にリンク）
// =============================================================
import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, CheckCircle, XCircle, Trash2, Check } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useTimezone } from "@/hooks/use-timezone";
import { fmtDateJP, fmtTime } from "@/lib/date";

type Availability = "yes" | "maybe" | "no";
type Respondent = { memberId: string; name: string; emoji: string; availability: Availability };
type Candidate = {
  id: string; recurrenceType: string; dayOfWeek: number; weekOfMonth: number | null;
  startTimeLocal: string; endTimeLocal: string; note: string | null;
  label: string; isConfirmed: boolean; respondents: Respondent[];
};
type TargetMember = { id: string; name: string; emoji: string; bgColor: string };
type Occurrence = { id: string; startsAt: number; endsAt: number | null; status: string; seriesOccurrenceIndex: number | null };
type SeriesDetail = {
  id: string; title: string; description: string | null;
  hostMemberId: string; isHost: boolean;
  scope: "collab_team" | "selected"; collabTeamId: string | null;
  status: "voting" | "confirmed" | "ended" | "cancelled";
  deadline: number | null;
  endCondition: "date" | "count" | null; endDate: number | null; occurrenceCount: number | null;
  conferenceType: "google_meet" | "zoom" | null;
  candidates: Candidate[];
  myResponses: Record<string, Availability>;
  targetMembers: TargetMember[];
  occurrences: Occurrence[];
};

const AVAIL_OPTIONS: Array<{ value: Availability; label: string; color: string; bg: string }> = [
  { value: "yes",   label: "○", color: "var(--color-success)", bg: "rgba(90,140,92,0.12)" },
  { value: "maybe", label: "△", color: "#D4A03B",              bg: "rgba(212,160,59,0.12)" },
  { value: "no",    label: "×", color: "var(--color-ink-400)", bg: "var(--color-paper-200)" },
];
function availStyle(av: Availability | undefined) {
  return AVAIL_OPTIONS.find((o) => o.value === av) ?? AVAIL_OPTIONS[2];
}
function AvailCell({ value }: { value: Availability | undefined }) {
  const s = availStyle(value);
  return (
    <div className="flex items-center justify-center w-10 h-10 rounded-xl text-base font-bold mx-auto"
      style={{ background: value ? s.bg : "var(--color-paper-200)", color: value ? s.color : "var(--color-ink-300)" }}>
      {value ? s.label : "—"}
    </div>
  );
}
function countYes(cand: Candidate): number {
  return cand.respondents.filter((r) => r.availability === "yes").length;
}

const STATUS_LABEL: Record<string, string> = {
  voting: "投票中", confirmed: "確定済み", ended: "終了", cancelled: "キャンセル",
};
const CONFERENCE_LABEL: Record<string, string> = { google_meet: "Google Meet", zoom: "Zoom" };

function formatEndCondition(series: SeriesDetail, tz: string): string {
  if (series.endCondition === "count" && series.occurrenceCount) return `全${series.occurrenceCount}回`;
  if (series.endCondition === "date" && series.endDate) return `${fmtDateJP(series.endDate, tz)}まで`;
  return "未設定";
}

export function MeetingSeriesDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tz = useTimezone();
  const user = useAuthStore((s) => s.user);
  const [myAnswers, setMyAnswers] = useState<Record<string, Availability>>({});
  const [hasEdited, setHasEdited] = useState(false);
  const [confirmCandidateId, setConfirmCandidateId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["meeting-series", id],
    queryFn: () => api.get<{ data: SeriesDetail }>(`/meeting-series/${id}`),
    enabled: !!id,
  });

  const respondMutation = useMutation({
    mutationFn: (responses: Record<string, Availability>) => api.post(`/meeting-series/${id}/respond`, { responses }),
    onSuccess: () => {
      setHasEdited(false);
      qc.invalidateQueries({ queryKey: ["meeting-series", id] });
      qc.invalidateQueries({ queryKey: ["meeting-series"] });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (body: { candidateId: string }) => api.patch(`/meeting-series/${id}/confirm`, body),
    onSuccess: () => {
      setConfirmCandidateId(null);
      qc.invalidateQueries({ queryKey: ["meeting-series", id] });
      qc.invalidateQueries({ queryKey: ["meetings"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.delete(`/meeting-series/${id}`),
    onSuccess: () => {
      setShowCancelConfirm(false);
      qc.invalidateQueries({ queryKey: ["meeting-series", id] });
      qc.invalidateQueries({ queryKey: ["meetings"] });
    },
  });

  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
      </div>
    );
  }

  const series = data.data;
  const nowSec = Math.floor(Date.now() / 1000);
  const maxYesCount = Math.max(0, ...series.candidates.map((c) => countYes(c)));

  function toggleMyAnswer(candidateId: string) {
    setHasEdited(true);
    setMyAnswers((prev) => {
      const cur = prev[candidateId] ?? series.myResponses[candidateId];
      const next: Availability = cur === "yes" ? "maybe" : cur === "maybe" ? "no" : "yes";
      return { ...prev, [candidateId]: next };
    });
  }

  function handleConfirm() {
    setError("");
    if (!confirmCandidateId) { setError("確定する候補パターンを選んでください"); return; }
    confirmMutation.mutate({ candidateId: confirmCandidateId });
  }

  const upcoming = series.occurrences.filter((o) => o.status !== "cancelled" && (o.endsAt ?? o.startsAt) >= nowSec);
  const past = series.occurrences.filter((o) => o.status === "cancelled" || (o.endsAt ?? o.startsAt) < nowSec);

  return (
    <div className="px-4 py-6 pb-24 max-w-xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => navigate(-1)} className="p-2 rounded-2xl hover:opacity-70"
          style={{ background: "var(--color-paper-200)" }}>
          <ChevronLeft size={18} style={{ color: "var(--color-ink-600)" }} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold truncate" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            🔁 {series.title}
          </h1>
        </div>
      </div>

      <div className="card-paper rounded-2xl px-4 py-3 mb-5">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              background: series.status === "confirmed" ? "rgba(90,140,92,0.12)" : series.status === "cancelled" ? "var(--color-paper-300)" : "rgba(212,160,59,0.15)",
              color: series.status === "confirmed" ? "var(--color-success)" : series.status === "cancelled" ? "var(--color-ink-500)" : "var(--color-accent)",
            }}>
            {STATUS_LABEL[series.status]}
          </span>
          {series.isHost && (
            <span className="text-xs px-1.5 py-0.5 rounded-md font-medium" style={{ background: "var(--color-accent)", color: "white" }}>主催</span>
          )}
          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
            終了条件: {formatEndCondition(series, tz)}
          </span>
          {series.conferenceType && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(107,125,179,0.12)", color: "#6B7DB3" }}>
              🎥 {CONFERENCE_LABEL[series.conferenceType]} 自動発行
            </span>
          )}
        </div>
        {series.description && <p className="text-sm mb-1" style={{ color: "var(--color-ink-700)" }}>{series.description}</p>}
        <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
          対象: {series.targetMembers.map((m) => `${m.emoji} ${m.name}`).join("、") || "（対象者なし）"}
        </p>
      </div>

      {series.status === "voting" && (
        <>
          {/* ---- 回答グリッド（通常ミーティングと同じ表示） ---- */}
          <div className="mb-5">
            <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--color-ink-700)" }}>
              📊 回答状況
            </h2>
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="border-separate border-spacing-1 min-w-max">
                <thead>
                  <tr>
                    <th className="w-28 text-left" />
                    {series.candidates.map((cand) => {
                      const yesCount = countYes(cand);
                      const isTop = yesCount > 0 && yesCount === maxYesCount;
                      return (
                        <th key={cand.id} className="text-center pb-1">
                          <div className="relative px-2 py-1.5 rounded-xl text-xs font-medium leading-tight"
                            style={{
                              background: isTop ? "rgba(212,160,59,0.18)" : "var(--color-paper-200)",
                              color: "var(--color-ink-700)",
                              minWidth: "90px",
                              border: isTop ? "1.5px solid rgba(212,160,59,0.6)" : undefined,
                            }}>
                            {isTop && <div className="text-xs mb-0.5" style={{ color: "var(--color-accent)" }}>★最多</div>}
                            <div className="whitespace-nowrap">{cand.label}</div>
                            {cand.note && <div className="text-xs opacity-75 mt-0.5">{cand.note}</div>}
                            <div className="mt-1 font-bold text-sm" style={{ color: "var(--color-success)" }}>
                              ○{yesCount}
                            </div>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {series.targetMembers.map((m) => {
                    const isMe = m.id === user?.id;
                    return (
                      <tr key={m.id}>
                        <td className="pr-2">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-sm ${m.bgColor}`}>
                              {m.emoji}
                            </span>
                            <span className="text-xs font-medium truncate max-w-[72px]"
                              style={{ color: isMe ? "var(--color-brand)" : "var(--color-ink-700)" }}>
                              {isMe ? "あなた" : m.name}
                            </span>
                          </div>
                        </td>
                        {series.candidates.map((cand) => (
                          <td key={cand.id} className="text-center">
                            <AvailCell value={cand.respondents.find((r) => r.memberId === m.id)?.availability} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---- 自分の回答入力 ---- */}
          <div className="card-paper rounded-3xl p-4 mb-5">
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink-700)" }}>
              ✏️ あなたの回答（タップで切り替え）
            </h2>
            <div className="flex gap-2 flex-wrap mb-3">
              {series.candidates.map((cand) => {
                const av = myAnswers[cand.id] ?? series.myResponses[cand.id];
                const s = availStyle(av);
                return (
                  <button key={cand.id} onClick={() => toggleMyAnswer(cand.id)}
                    className="flex flex-col items-center gap-1 px-3 py-2 rounded-2xl transition active:opacity-75"
                    style={{ background: av ? s.bg : "var(--color-paper-200)", border: `1.5px solid ${av ? s.color : "transparent"}` }}>
                    <span className="text-xs" style={{ color: "var(--color-ink-600)" }}>{cand.label}</span>
                    <span className="text-xl font-bold" style={{ color: av ? s.color : "var(--color-ink-300)" }}>
                      {av ? s.label : "?"}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex gap-1.5 text-xs mb-3" style={{ color: "var(--color-ink-400)" }}>
              {AVAIL_OPTIONS.map((o) => (
                <span key={o.value} style={{ color: o.color }}>{o.label}={o.value === "yes" ? "参加可" : o.value === "maybe" ? "未定" : "不参加"}</span>
              ))}
            </div>
            <button onClick={() => respondMutation.mutate(myAnswers)}
              disabled={!hasEdited || respondMutation.isPending}
              className="w-full py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50 transition"
              style={{ background: "var(--color-brand)" }}>
              {respondMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              回答を送信する
            </button>
          </div>

          {series.isHost && (
            <div className="card-paper rounded-2xl px-4 py-4 mb-6" style={{ border: "1.5px solid rgba(212,160,59,0.3)" }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink-800)" }}>🔒 主催者: パターンを確定する</h3>
              <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
                終了条件（{formatEndCondition(series, tz)}）まで、確定したパターンで開催回がまとめて作成されます。
              </p>
              <div className="space-y-1.5 mb-3">
                {series.candidates.map((cand) => (
                  <label key={cand.id} className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer"
                    style={{ background: confirmCandidateId === cand.id ? "rgba(181,56,75,0.08)" : "var(--color-paper-200)" }}>
                    <input type="radio" name="confirmCandidate" checked={confirmCandidateId === cand.id}
                      onChange={() => setConfirmCandidateId(cand.id)} />
                    <span className="text-sm" style={{ color: "var(--color-ink-800)" }}>{cand.label}</span>
                  </label>
                ))}
              </div>

              {error && (
                <p className="text-xs text-center px-3 py-2 rounded-xl mb-3" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>{error}</p>
              )}

              <button onClick={handleConfirm} disabled={confirmMutation.isPending}
                className="w-full py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: "var(--color-success)" }}>
                {confirmMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <><CheckCircle size={15} />このパターンで確定する</>}
              </button>
            </div>
          )}
        </>
      )}

      {(series.status === "confirmed" || series.status === "ended" || series.status === "cancelled") && (
        <>
          {upcoming.length > 0 && (
            <section className="mb-5">
              <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--color-ink-700)" }}>今後の開催回（{upcoming.length}件）</h2>
              <div className="space-y-2">
                {upcoming.map((o) => (
                  <Link key={o.id} to={`/meetings/${o.id}`}
                    className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>
                        第{o.seriesOccurrenceIndex}回・{fmtDateJP(o.startsAt, tz)} {fmtTime(o.startsAt, tz)}
                        {o.endsAt ? `〜${fmtTime(o.endsAt, tz)}` : ""}
                      </p>
                    </div>
                    <ChevronRight size={16} style={{ color: "var(--color-ink-400)" }} />
                  </Link>
                ))}
              </div>
            </section>
          )}

          {past.length > 0 && (
            <section className="mb-5">
              <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--color-ink-500)" }}>過去の開催回（{past.length}件）</h2>
              <div className="space-y-2">
                {past.map((o) => (
                  <Link key={o.id} to={`/meetings/${o.id}`}
                    className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80 opacity-70">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: "var(--color-ink-700)" }}>
                        第{o.seriesOccurrenceIndex}回・{fmtDateJP(o.startsAt, tz)} {fmtTime(o.startsAt, tz)}
                      </p>
                    </div>
                    {o.status === "cancelled" && <XCircle size={14} style={{ color: "var(--color-ink-400)" }} />}
                    <ChevronRight size={16} style={{ color: "var(--color-ink-400)" }} />
                  </Link>
                ))}
              </div>
            </section>
          )}

          {series.isHost && series.status === "confirmed" && (
            <div className="mt-6">
              {!showCancelConfirm ? (
                <button onClick={() => setShowCancelConfirm(true)}
                  className="w-full py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-2"
                  style={{ background: "var(--color-paper-200)", color: "var(--color-brand)" }}>
                  <Trash2 size={15} />定例会をキャンセルする
                </button>
              ) : (
                <div className="card-paper rounded-2xl px-4 py-4" style={{ border: "1.5px solid rgba(181,56,75,0.3)" }}>
                  <p className="text-sm mb-3" style={{ color: "var(--color-ink-800)" }}>
                    定例会をキャンセルすると、まだ開催されていない今後の回がすべてキャンセルされます。過去の開催回は履歴として残ります。よろしいですか？
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setShowCancelConfirm(false)}
                      className="py-2.5 rounded-xl text-sm font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                      やめる
                    </button>
                    <button onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}
                      className="py-2.5 rounded-xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
                      style={{ background: "var(--color-brand)" }}>
                      {cancelMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : "キャンセルする"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
