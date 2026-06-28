// =============================================================
// ミーティング詳細画面（レスポンスグリッド）
// =============================================================
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ChevronLeft, Check, Link as LinkIcon, Copy, CheckCircle, Edit2, UserPlus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

type Availability = "yes" | "maybe" | "no";

type Candidate = { id: string; startsAt: number; endsAt: number | null; note: string | null; sortOrder: number; isConfirmed: number };
type Respondent = {
  type: "member" | "external";
  id: string;
  name: string;
  emoji: string;
  bgColor: string;
  answers: Record<string, Availability>;
  hasResponded: boolean;
};
type ExternalInvitee = { id: string; name: string; email: string | null; token: string; createdAt: number };
type Meeting = {
  id: string; title: string; description: string | null;
  host: { id: string; name: string; emoji: string } | null;
  hostMemberId: string; scope: string; teamId: string | null;
  status: "open" | "confirmed" | "cancelled";
  confirmedCandidateId: string | null;
  confirmedStartsAt: number | null;
  eventCampaignId: string | null;
  registrationDeadline: number | null;
  deadline: number | null; createdAt: number;
};
type LinkedEvent = { id: string; title: string; multiplier: number | null };
type AttendanceRecord = { memberId: string; status: "attended" | "absent"; pointsAwarded: number | null };
type DetailResponse = {
  data: {
    meeting: Meeting;
    candidates: Candidate[];
    respondents: Respondent[];
    externalInvitees: ExternalInvitee[];
    myAnswers: Record<string, Availability>;
    isHost: boolean;
    linkedEvent: LinkedEvent | null;
    myAttendance: { status: "attended" | "absent"; pointsAwarded: number | null } | null;
    attendances: AttendanceRecord[];
  };
};

const AVAIL_OPTIONS: Array<{ value: Availability; label: string; color: string; bg: string }> = [
  { value: "yes",   label: "○",  color: "var(--color-success)", bg: "rgba(90,140,92,0.12)" },
  { value: "maybe", label: "△",  color: "#D4A03B",              bg: "rgba(212,160,59,0.12)" },
  { value: "no",    label: "×",  color: "var(--color-ink-400)", bg: "var(--color-paper-200)" },
];

function availStyle(av: Availability | undefined) {
  const opt = AVAIL_OPTIONS.find((o) => o.value === av);
  return opt ?? AVAIL_OPTIONS[2];
}

function formatCandidateDate(ts: number, endsAt: number | null): { date: string; time: string } {
  const d = new Date(ts * 1000);
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const date = `${d.getMonth() + 1}/${d.getDate()}(${weekdays[d.getDay()]})`;
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const startT = `${h}:${m}`;

  if (endsAt) {
    const e = new Date(endsAt * 1000);
    const eh = e.getHours().toString().padStart(2, "0");
    const em = e.getMinutes().toString().padStart(2, "0");
    return { date, time: `${startT}〜${eh}:${em}` };
  }
  return { date, time: startT === "00:00" ? "" : startT };
}

function AvailCell({ value }: { value: Availability | undefined }) {
  const s = availStyle(value);
  return (
    <div className="flex items-center justify-center w-10 h-10 rounded-xl text-base font-bold"
      style={{ background: value ? s.bg : "var(--color-paper-200)", color: value ? s.color : "var(--color-ink-300)" }}>
      {value ? s.label : "—"}
    </div>
  );
}

function countYes(respondents: Respondent[], candidateId: string): number {
  return respondents.filter((r) => r.answers[candidateId] === "yes").length;
}

export function MeetingDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [myAnswers, setMyAnswers] = useState<Record<string, Availability>>({});
  const [hasEdited, setHasEdited] = useState(false);
  const [copiedToken, setCopiedToken] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descText, setDescText] = useState("");
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [showEventPicker, setShowEventPicker] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["meetings", id],
    queryFn: () => api.get<DetailResponse>(`/meetings/${id}`),
  });

  type MemberSummary = { id: string; name: string; emoji: string; bgColor: string };
  const { data: allMembersData } = useQuery({
    queryKey: ["members", "summary"],
    queryFn: () => api.get<{ data: MemberSummary[] }>("/members"),
    enabled: showMemberPicker,
  });

  type EventItem = { id: string; title: string; multiplier: number | null };
  const { data: eventsData } = useQuery({
    queryKey: ["events", "active"],
    queryFn: () => api.get<{ data: EventItem[] }>("/events/active"),
    enabled: showEventPicker,
  });

  // サーバーからデータが届いたら myAnswers を初期化（まだ手動編集していない場合のみ）
  useEffect(() => {
    if (data && !hasEdited) {
      setMyAnswers(data.data.myAnswers ?? {});
    }
  }, [data, hasEdited]);

  const respondMutation = useMutation({
    mutationFn: (answers: Record<string, Availability>) =>
      api.post(`/meetings/${id}/respond`, { answers }),
    onSuccess: () => {
      setHasEdited(false);
      qc.invalidateQueries({ queryKey: ["meetings", id] });
      qc.invalidateQueries({ queryKey: ["meetings"] });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (candidateId: string) =>
      api.patch(`/meetings/${id}/confirm`, { candidateId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", id] }),
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.delete(`/meetings/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
      navigate("/meetings");
    },
  });

  const externalMutation = useMutation({
    mutationFn: () => api.post<{ data: { id: string; token: string } }>(`/meetings/${id}/external`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", id] }),
  });

  const descMutation = useMutation({
    mutationFn: (description: string) =>
      api.patch(`/meetings/${id}/description`, { description }),
    onSuccess: () => {
      setEditingDesc(false);
      qc.invalidateQueries({ queryKey: ["meetings", id] });
    },
  });

  const inviteMemberMutation = useMutation({
    mutationFn: (memberId: string) =>
      api.post(`/meetings/${id}/invite-member`, { memberId }),
    onSuccess: () => {
      setShowMemberPicker(false);
      setMemberSearch("");
      qc.invalidateQueries({ queryKey: ["meetings", id] });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) =>
      api.delete(`/meetings/${id}/invitees/${memberId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", id] }),
  });

  const removeExternalMutation = useMutation({
    mutationFn: (externalId: string) =>
      api.delete(`/meetings/${id}/external/${externalId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", id] }),
  });

  const linkEventMutation = useMutation({
    mutationFn: (eventCampaignId: string | null) =>
      api.patch(`/meetings/${id}/event`, { eventCampaignId }),
    onSuccess: () => {
      setShowEventPicker(false);
      qc.invalidateQueries({ queryKey: ["meetings", id] });
    },
  });

  const attendanceMutation = useMutation({
    mutationFn: (status: "attended" | "absent") =>
      api.post<{ ok: boolean; pointsAwarded: number }>(`/meetings/${id}/attendance`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings", id] });
      qc.invalidateQueries({ queryKey: ["meetings", "pending-attendance"] });
      qc.invalidateQueries({ queryKey: ["ranking", "me"] });
    },
  });

  if (isLoading || !data) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
      </div>
    );
  }

  const { meeting, candidates, respondents, externalInvitees, isHost, linkedEvent, myAttendance, attendances } = data.data;
  const confirmedCandidates = candidates.filter((c) => c.isConfirmed === 1).sort((a, b) => a.startsAt - b.startsAt);

  const nowSec = Math.floor(Date.now() / 1000);
  const maxYesCount = Math.max(0, ...candidates.map((c) => countYes(respondents, c.id)));

  function formatDeadline(ts: number): string {
    const d = new Date(ts * 1000);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function toggleMyAnswer(candidateId: string) {
    if (meeting.status !== "open") return;
    setHasEdited(true);
    setMyAnswers((prev) => {
      const cur = prev[candidateId];
      const next: Availability = cur === "yes" ? "maybe" : cur === "maybe" ? "no" : "yes";
      return { ...prev, [candidateId]: next };
    });
  }

  async function copyExternalUrl(token: string) {
    const url = `${window.location.origin}/schedule/${token}`;
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(""), 2000);
  }

  function startEditDesc() {
    setDescText(meeting.description ?? "");
    setEditingDesc(true);
  }

  const scopeLabel: Record<string, string> = { all: "全メンバー", team: "チーム", selected: "指定メンバー" };

  return (
    <div className="px-4 py-6 pb-24 max-w-2xl mx-auto">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => navigate("/meetings")} className="p-2 rounded-2xl hover:opacity-70"
          style={{ background: "var(--color-paper-200)" }}>
          <ChevronLeft size={18} style={{ color: "var(--color-ink-600)" }} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold truncate" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            {meeting.title}
          </h1>
          <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
            {meeting.host?.emoji} {meeting.host?.name}さん主催 · {scopeLabel[meeting.scope]}
          </p>
        </div>
        {/* ステータスバッジ */}
        {meeting.status === "confirmed" && (
          <span className="shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium"
            style={{ background: "rgba(90,140,92,0.12)", color: "var(--color-success)" }}>
            <CheckCircle size={11} />確定済み
          </span>
        )}
        {meeting.status === "cancelled" && (
          <span className="shrink-0 text-xs px-2 py-1 rounded-full font-medium"
            style={{ background: "var(--color-paper-300)", color: "var(--color-ink-400)" }}>
            キャンセル
          </span>
        )}
      </div>

      {/* 確定日バナー（複数対応） */}
      {meeting.status === "confirmed" && confirmedCandidates.length > 0 && (
        <div className="mb-4 p-4 rounded-2xl"
          style={{ background: "rgba(90,140,92,0.1)", border: "1px solid rgba(90,140,92,0.25)" }}>
          <p className="text-xs font-medium mb-2 text-center" style={{ color: "var(--color-success)" }}>📅 日程確定</p>
          <div className="space-y-1">
            {confirmedCandidates.map((cand) => {
              const { date, time } = formatCandidateDate(cand.startsAt, cand.endsAt);
              return (
                <p key={cand.id} className="text-lg font-bold text-center"
                  style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
                  {date} {time}
                </p>
              );
            })}
          </div>
        </div>
      )}

      {/* 募集締め切り表示 */}
      {meeting.status === "open" && meeting.registrationDeadline != null && (
        <div className="mb-4 px-4 py-2.5 rounded-2xl flex items-center gap-2"
          style={{
            background: meeting.registrationDeadline < nowSec ? "var(--color-paper-200)" : "rgba(181,56,75,0.06)",
            border: `1px solid ${meeting.registrationDeadline < nowSec ? "var(--color-paper-300)" : "rgba(181,56,75,0.2)"}`,
          }}>
          <span className="text-sm">📅</span>
          <p className="text-xs" style={{ color: meeting.registrationDeadline < nowSec ? "var(--color-ink-400)" : "var(--color-ink-600)" }}>
            {meeting.registrationDeadline < nowSec
              ? `募集期間終了（${formatDeadline(meeting.registrationDeadline)}まで）`
              : `募集締め切り: ${formatDeadline(meeting.registrationDeadline)}`}
          </p>
        </div>
      )}

      {/* 紐付きイベントバッジ */}
      {linkedEvent && (
        <div className="mb-4 px-4 py-2.5 rounded-2xl flex items-center gap-2"
          style={{ background: "rgba(212,160,59,0.12)", border: "1px solid rgba(212,160,59,0.3)" }}>
          <span className="text-base">🎯</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold" style={{ color: "var(--color-accent)" }}>
              {linkedEvent.title}
            </p>
            {linkedEvent.multiplier != null && (
              <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
                出席すると +{linkedEvent.multiplier}pt が付与されます
              </p>
            )}
          </div>
        </div>
      )}

      {/* 詳細（主催者は編集可） */}
      {isHost ? (
        <div className="mb-4">
          {editingDesc ? (
            <div className="card-paper rounded-2xl p-3 space-y-2">
              <textarea
                value={descText}
                onChange={(e) => setDescText(e.target.value)}
                rows={4}
                placeholder="詳細・場所・連絡事項など"
                className="w-full px-3 py-2 rounded-xl text-sm outline-none border resize-none"
                style={{
                  background: "var(--color-paper-50)",
                  borderColor: "var(--color-paper-300)",
                  color: "var(--color-ink-900)",
                }}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => descMutation.mutate(descText)}
                  disabled={descMutation.isPending}
                  className="flex-1 py-2 rounded-xl text-sm font-medium text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                  style={{ background: "var(--color-brand)" }}
                >
                  {descMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  送信して通知する
                </button>
                <button
                  onClick={() => setEditingDesc(false)}
                  className="px-4 py-2 rounded-xl text-sm"
                  style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}
                >
                  キャンセル
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              {meeting.description ? (
                <p className="flex-1 text-sm" style={{ color: "var(--color-ink-600)" }}>{meeting.description}</p>
              ) : (
                <p className="flex-1 text-sm italic" style={{ color: "var(--color-ink-300)" }}>詳細未設定</p>
              )}
              <button
                onClick={startEditDesc}
                className="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}
              >
                <Edit2 size={12} />
                {meeting.description ? "詳細を更新" : "詳細を追加"}
              </button>
            </div>
          )}
        </div>
      ) : (
        meeting.description && (
          <p className="mb-4 text-sm" style={{ color: "var(--color-ink-600)" }}>{meeting.description}</p>
        )
      )}

      {/* ---- 回答グリッド ---- */}
      <div className="mb-5">
        <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--color-ink-700)" }}>
          📊 回答状況
        </h2>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="border-separate border-spacing-1 min-w-max">
            <thead>
              <tr>
                <th className="w-28 text-left" />
                {candidates.map((cand) => {
                  const { date, time } = formatCandidateDate(cand.startsAt, cand.endsAt);
                  const isConfirmed = cand.isConfirmed === 1;
                  const yesCount = countYes(respondents, cand.id);
                  const isTopCandidate = meeting.status === "open" && yesCount > 0 && yesCount === maxYesCount;
                  return (
                    <th key={cand.id} className="text-center pb-1">
                      <div className={`px-2 py-1.5 rounded-xl text-xs font-medium leading-tight ${isConfirmed ? "ring-2" : ""}`}
                        style={{
                          background: isConfirmed
                            ? "rgba(90,140,92,0.15)"
                            : isTopCandidate
                              ? "rgba(212,160,59,0.18)"
                              : "var(--color-paper-200)",
                          color: isConfirmed ? "var(--color-success)" : "var(--color-ink-700)",
                          minWidth: "52px",
                          border: isTopCandidate && !isConfirmed ? "1.5px solid rgba(212,160,59,0.6)" : undefined,
                          ...(isConfirmed ? { "--tw-ring-color": "var(--color-success)" } as React.CSSProperties : {}),
                        }}>
                        {isTopCandidate && !isConfirmed && (
                          <div className="text-xs mb-0.5" style={{ color: "var(--color-accent)" }}>★最多</div>
                        )}
                        <div>{date}</div>
                        {time && <div className="text-xs opacity-75">{time}</div>}
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
              {respondents.map((r) => {
                const isMe = r.type === "member" && r.id === user?.id;
                return (
                  <tr key={`${r.type}-${r.id}`}>
                    <td className="pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-sm ${r.bgColor}`}>
                          {r.emoji}
                        </span>
                        <span className="text-xs font-medium truncate max-w-[72px]"
                          style={{ color: isMe ? "var(--color-brand)" : "var(--color-ink-700)" }}>
                          {isMe ? "あなた" : r.name}
                        </span>
                      </div>
                    </td>
                    {candidates.map((cand) => (
                      <td key={cand.id} className="text-center">
                        <AvailCell value={r.answers[cand.id]} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- 自分の回答入力（open ミーティングのみ） ---- */}
      {meeting.status === "open" && (
        <div className="card-paper rounded-3xl p-4 mb-5">
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink-700)" }}>
            ✏️ あなたの回答（タップで切り替え）
          </h2>
          <div className="flex gap-2 flex-wrap mb-3">
            {candidates.map((cand) => {
              const { date, time } = formatCandidateDate(cand.startsAt, cand.endsAt);
              const av = myAnswers[cand.id];
              const s = availStyle(av);
              return (
                <button
                  key={cand.id}
                  onClick={() => toggleMyAnswer(cand.id)}
                  className="flex flex-col items-center gap-1 px-3 py-2 rounded-2xl transition active:opacity-75"
                  style={{ background: av ? s.bg : "var(--color-paper-200)", border: `1.5px solid ${av ? s.color : "transparent"}` }}
                >
                  <span className="text-xs" style={{ color: "var(--color-ink-600)" }}>{date}</span>
                  {time && <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>{time}</span>}
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
          <button
            onClick={() => respondMutation.mutate(myAnswers)}
            disabled={!hasEdited || respondMutation.isPending}
            className="w-full py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50 transition"
            style={{ background: "var(--color-brand)" }}
          >
            {respondMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            回答を送信する
          </button>
        </div>
      )}

      {/* ---- 出席確認（確定後かつ開催時刻経過後） ---- */}
      {meeting.status === "confirmed" && meeting.confirmedStartsAt != null && meeting.confirmedStartsAt < Math.floor(Date.now() / 1000) && (
        <div className="card-paper rounded-3xl p-4 mb-5">
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink-700)" }}>
            📋 出席確認
          </h2>

          {/* 自分の出席記録 */}
          <div className="mb-4">
            <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>
              {myAttendance ? "あなたの出席状況" : "このミーティングに出席しましたか？"}
            </p>
            {myAttendance ? (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl"
                style={{ background: myAttendance.status === "attended" ? "rgba(90,140,92,0.12)" : "var(--color-paper-200)" }}>
                <span className="text-lg">{myAttendance.status === "attended" ? "✅" : "❌"}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium" style={{ color: myAttendance.status === "attended" ? "var(--color-success)" : "var(--color-ink-500)" }}>
                    {myAttendance.status === "attended" ? "出席済み" : "欠席"}
                  </p>
                  {myAttendance.pointsAwarded != null && myAttendance.pointsAwarded > 0 && (
                    <p className="text-xs" style={{ color: "var(--color-accent)" }}>+{myAttendance.pointsAwarded}pt 獲得！</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => attendanceMutation.mutate("attended")}
                  disabled={attendanceMutation.isPending}
                  className="flex-1 py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                  style={{ background: "rgba(90,140,92,0.12)", color: "var(--color-success)", border: "1.5px solid rgba(90,140,92,0.3)" }}
                >
                  {attendanceMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  出席した
                </button>
                <button
                  onClick={() => attendanceMutation.mutate("absent")}
                  disabled={attendanceMutation.isPending}
                  className="flex-1 py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                  style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}
                >
                  欠席
                </button>
              </div>
            )}
            {linkedEvent?.multiplier != null && !myAttendance && (
              <p className="text-xs mt-2 text-center" style={{ color: "var(--color-accent)" }}>
                出席すると +{linkedEvent.multiplier}pt が付与されます 🎯
              </p>
            )}
          </div>

          {/* ホスト向け：全員の出席状況 */}
          {isHost && attendances.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: "var(--color-ink-500)" }}>参加者の出席状況</p>
              <div className="space-y-1">
                {respondents.filter((r) => r.type === "member").map((r) => {
                  const att = attendances.find((a) => a.memberId === r.id);
                  return (
                    <div key={r.id} className="flex items-center gap-2 px-3 py-2 rounded-xl"
                      style={{ background: "var(--color-paper-200)" }}>
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs shrink-0 ${r.bgColor}`}>
                        {r.emoji}
                      </div>
                      <span className="text-xs flex-1" style={{ color: "var(--color-ink-700)" }}>{r.name}</span>
                      <span className="text-xs font-medium" style={{
                        color: att?.status === "attended" ? "var(--color-success)" : att?.status === "absent" ? "var(--color-ink-400)" : "var(--color-ink-300)"
                      }}>
                        {att?.status === "attended" ? "✅ 出席" : att?.status === "absent" ? "❌ 欠席" : "未記入"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- 主催者向け操作（日程確定・イベント設定・キャンセル） ---- */}
      {isHost && meeting.status !== "cancelled" && (
        <div className="card-paper rounded-3xl p-4 mb-5 space-y-4">
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-ink-700)" }}>⚙️ 主催者メニュー</h2>

          {/* イベント紐付け（確定前のみ） */}
          {meeting.status === "open" && (
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: "var(--color-ink-500)" }}>🎯 イベントを設定する（任意）</p>
              {linkedEvent ? (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl"
                  style={{ background: "rgba(212,160,59,0.12)", border: "1px solid rgba(212,160,59,0.3)" }}>
                  <span className="text-sm flex-1" style={{ color: "var(--color-ink-800)" }}>
                    🎯 {linkedEvent.title}
                    {linkedEvent.multiplier != null && <span style={{ color: "var(--color-accent)" }}> (+{linkedEvent.multiplier}pt)</span>}
                  </span>
                  <button
                    onClick={() => linkEventMutation.mutate(null)}
                    disabled={linkEventMutation.isPending}
                    className="text-xs px-2 py-1 rounded-lg transition hover:opacity-70 disabled:opacity-40"
                    style={{ color: "var(--color-ink-400)", background: "var(--color-paper-50)" }}
                  >
                    解除
                  </button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => setShowEventPicker((v) => !v)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium transition hover:opacity-80"
                    style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
                  >
                    イベントを選択する
                  </button>
                  {showEventPicker && (
                    <div className="mt-1.5 rounded-2xl overflow-hidden border" style={{ borderColor: "var(--color-paper-300)" }}>
                      {!eventsData ? (
                        <div className="flex justify-center py-4">
                          <Loader2 size={16} className="animate-spin" style={{ color: "var(--color-brand)" }} />
                        </div>
                      ) : (() => {
                        const pointEvents = (eventsData.data ?? []).filter((e) => e.multiplier != null);
                        return pointEvents.length === 0 ? (
                          <p className="text-xs text-center py-4 px-3" style={{ color: "var(--color-ink-400)" }}>
                            ポイント設定のあるアクティブなイベントがありません
                          </p>
                        ) : (
                          <div className="divide-y" style={{ borderColor: "var(--color-paper-200)" }}>
                            {pointEvents.map((ev) => (
                              <button
                                key={ev.id}
                                onClick={() => linkEventMutation.mutate(ev.id)}
                                disabled={linkEventMutation.isPending}
                                className="w-full flex items-center gap-3 px-3 py-3 text-left hover:opacity-70 transition disabled:opacity-50"
                                style={{ background: "var(--color-paper-50)" }}
                              >
                                <span className="text-base">🎯</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{ev.title}</p>
                                  <p className="text-xs" style={{ color: "var(--color-accent)" }}>出席で +{ev.multiplier}pt</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                      <button
                        onClick={() => setShowEventPicker(false)}
                        className="w-full py-2 text-xs text-center transition hover:opacity-70"
                        style={{ background: "var(--color-paper-200)", color: "var(--color-ink-400)" }}
                      >
                        閉じる
                      </button>
                    </div>
                  )}
                  <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
                    ポイントが付与されるイベントを設定すると、出席者にポイントが加算されます
                  </p>
                </>
              )}
            </div>
          )}

          {/* 日程確定（複数選択可・確定済みもトグル解除可） */}
          <div>
            <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>
              日程の確定（複数選択可・タップで確定／解除）
            </p>
            <div className="space-y-1.5">
              {candidates.map((cand) => {
                const { date, time } = formatCandidateDate(cand.startsAt, cand.endsAt);
                const yesCount = countYes(respondents, cand.id);
                const isConf = cand.isConfirmed === 1;
                return (
                  <button
                    key={cand.id}
                    onClick={() => {
                      if (!isConf) {
                        if (window.confirm(`「${date} ${time}」を確定に追加しますか？\nメンバーに通知されます。`)) {
                          confirmMutation.mutate(cand.id);
                        }
                      } else {
                        confirmMutation.mutate(cand.id);
                      }
                    }}
                    disabled={confirmMutation.isPending}
                    className="w-full flex items-center justify-between px-4 py-2.5 rounded-2xl text-sm font-medium transition hover:opacity-80 disabled:opacity-50"
                    style={{
                      background: isConf ? "rgba(90,140,92,0.12)" : "var(--color-paper-200)",
                      color: isConf ? "var(--color-success)" : "var(--color-ink-700)",
                      border: isConf ? "1.5px solid rgba(90,140,92,0.3)" : "1.5px solid transparent",
                    }}
                  >
                    <span>{isConf ? "✅ " : ""}{date}{time ? ` ${time}` : ""}</span>
                    <span className="text-sm font-bold" style={{ color: "var(--color-success)" }}>○{yesCount}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-400)" }}>
              複数の日程を確定できます（セミナーなど複数回開催に対応）
            </p>
          </div>

          {/* キャンセル（募集中のみ） */}
          {meeting.status === "open" && (
            <button
              onClick={() => { if (window.confirm("このミーティングをキャンセルしますか？")) cancelMutation.mutate(); }}
              disabled={cancelMutation.isPending}
              className="w-full py-2.5 rounded-2xl text-sm font-medium transition disabled:opacity-50"
              style={{ background: "transparent", color: "var(--color-ink-400)", border: "1px solid var(--color-paper-300)" }}
            >
              ミーティングをキャンセル
            </button>
          )}
        </div>
      )}

      {/* ---- 招待の管理（全参加者向け・キャンセル済みを除く） ---- */}
      {meeting.status !== "cancelled" && (
        <div className="card-paper rounded-3xl p-4 mb-5 space-y-2">
          <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--color-ink-700)" }}>👥 招待の管理</h2>

          {/* メンバー追加ボタン（指定メンバー対象ミーティングのみ） */}
          {meeting.scope === "selected" && (
            <>
              <button
                onClick={() => { setShowMemberPicker((v) => !v); setMemberSearch(""); }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium transition hover:opacity-80"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}
              >
                <UserPlus size={14} />
                メンバーを追加する
              </button>

              {/* メンバーピッカー */}
              {showMemberPicker && (
                <div className="rounded-2xl overflow-hidden border" style={{ borderColor: "var(--color-paper-300)" }}>
                  <div className="px-3 py-2" style={{ background: "var(--color-paper-50)" }}>
                    <input
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="名前で絞り込む"
                      autoFocus
                      className="w-full text-sm outline-none bg-transparent"
                      style={{ color: "var(--color-ink-800)" }}
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-paper-200">
                    {!allMembersData ? (
                      <div className="flex justify-center py-4">
                        <Loader2 size={16} className="animate-spin" style={{ color: "var(--color-brand)" }} />
                      </div>
                    ) : (() => {
                      const alreadyIds = new Set(respondents.filter((r) => r.type === "member").map((r) => r.id));
                      const filtered = (allMembersData.data ?? []).filter(
                        (m) => !alreadyIds.has(m.id) && m.name.includes(memberSearch)
                      );
                      return filtered.length === 0 ? (
                        <p className="text-xs text-center py-4" style={{ color: "var(--color-ink-400)" }}>
                          {memberSearch ? "該当するメンバーがいません" : "追加できるメンバーがいません"}
                        </p>
                      ) : filtered.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => inviteMemberMutation.mutate(m.id)}
                          disabled={inviteMemberMutation.isPending}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:opacity-70 transition disabled:opacity-50"
                          style={{ background: "var(--color-paper-50)" }}
                        >
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0 ${m.bgColor}`}>
                            {m.emoji}
                          </div>
                          <span className="text-sm" style={{ color: "var(--color-ink-800)" }}>{m.name}</span>
                          {inviteMemberMutation.isPending && (
                            <Loader2 size={12} className="animate-spin ml-auto" style={{ color: "var(--color-brand)" }} />
                          )}
                        </button>
                      ));
                    })()}
                  </div>
                  <button
                    onClick={() => setShowMemberPicker(false)}
                    className="w-full py-2 text-xs text-center transition hover:opacity-70"
                    style={{ background: "var(--color-paper-200)", color: "var(--color-ink-400)" }}
                  >
                    閉じる
                  </button>
                </div>
              )}

              {/* 招待済みメンバー一覧（削除ボタン付き） */}
              {respondents.filter((r) => r.type === "member" && r.id !== meeting.hostMemberId).length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>招待済みメンバー</p>
                  {respondents.filter((r) => r.type === "member" && r.id !== meeting.hostMemberId).map((r) => (
                    <div key={r.id} className="flex items-center gap-2 px-3 py-2 rounded-xl"
                      style={{ background: "var(--color-paper-200)" }}>
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs shrink-0 ${r.bgColor}`}>
                        {r.emoji}
                      </div>
                      <span className="text-xs flex-1 truncate" style={{ color: "var(--color-ink-700)" }}>{r.name}</span>
                      <button
                        onClick={() => {
                          if (window.confirm(`「${r.name}」さんをこのミーティングから削除しますか？`)) {
                            removeMemberMutation.mutate(r.id);
                          }
                        }}
                        disabled={removeMemberMutation.isPending}
                        className="shrink-0 p-1 rounded-lg transition hover:opacity-70 disabled:opacity-40"
                        style={{ color: "var(--color-ink-400)" }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* 外部ゲスト招待URL発行ボタン */}
          <button
            onClick={() => externalMutation.mutate()}
            disabled={externalMutation.isPending}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium transition hover:opacity-80 disabled:opacity-50"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}
          >
            {externalMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <LinkIcon size={14} />}
            外部ゲストの招待URLを生成する
          </button>

          {/* 外部招待者一覧（URLコピー＋削除ボタン付き） */}
          {externalInvitees.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>外部ゲスト</p>
              {externalInvitees.map((ext) => (
                <div key={ext.id} className="flex items-center gap-2 px-3 py-2 rounded-xl"
                  style={{ background: "var(--color-paper-200)" }}>
                  <span className="text-sm shrink-0">👤</span>
                  <span className="text-xs flex-1 truncate" style={{ color: "var(--color-ink-600)" }}>
                    {ext.name || "（名前未入力）"}
                    {ext.email && <span style={{ color: "var(--color-ink-400)" }}> · {ext.email}</span>}
                  </span>
                  <button
                    onClick={() => copyExternalUrl(ext.token)}
                    className="shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition"
                    style={{
                      background: copiedToken === ext.token ? "rgba(90,140,92,0.15)" : "var(--color-paper-50)",
                      color: copiedToken === ext.token ? "var(--color-success)" : "var(--color-ink-500)",
                    }}
                  >
                    {copiedToken === ext.token ? <Check size={12} /> : <Copy size={12} />}
                    {copiedToken === ext.token ? "済" : "URL"}
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`「${ext.name || "このゲスト"}」をミーティングから削除しますか？`)) {
                        removeExternalMutation.mutate(ext.id);
                      }
                    }}
                    disabled={removeExternalMutation.isPending}
                    className="shrink-0 p-1 rounded-lg transition hover:opacity-70 disabled:opacity-40"
                    style={{ color: "var(--color-ink-400)" }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
