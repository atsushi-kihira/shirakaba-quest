// =============================================================
// ミーティング詳細画面（レスポンスグリッド）
// =============================================================
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ChevronLeft, Check, Link as LinkIcon, Copy, CheckCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

type Availability = "yes" | "maybe" | "no";

type Candidate = { id: string; startsAt: number; endsAt: number | null; note: string | null; sortOrder: number };
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
  deadline: number | null; createdAt: number;
};
type DetailResponse = {
  data: {
    meeting: Meeting;
    candidates: Candidate[];
    respondents: Respondent[];
    externalInvitees: ExternalInvitee[];
    myAnswers: Record<string, Availability>;
    isHost: boolean;
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

  const { data, isLoading } = useQuery({
    queryKey: ["meetings", id],
    queryFn: () => api.get<DetailResponse>(`/meetings/${id}`),
    onSuccess: (res) => {
      if (!hasEdited) setMyAnswers(res.data.myAnswers ?? {});
    },
  });

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

  if (isLoading || !data) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
      </div>
    );
  }

  const { meeting, candidates, respondents, externalInvitees, isHost } = data.data;
  const confirmedCandidate = candidates.find((c) => c.id === meeting.confirmedCandidateId);

  function toggleMyAnswer(candidateId: string) {
    if (meeting.status !== "open") return;
    setMyAnswers((prev) => {
      const cur = prev[candidateId];
      const next: Availability = cur === "yes" ? "maybe" : cur === "maybe" ? "no" : "yes";
      setHasEdited(true);
      return { ...prev, [candidateId]: next };
    });
  }

  async function copyExternalUrl(token: string) {
    const url = `${window.location.origin}/schedule/${token}`;
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(""), 2000);
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

      {/* 確定日バナー */}
      {meeting.status === "confirmed" && confirmedCandidate && (
        <div className="mb-4 p-4 rounded-2xl text-center"
          style={{ background: "rgba(90,140,92,0.1)", border: "1px solid rgba(90,140,92,0.25)" }}>
          <p className="text-xs font-medium mb-0.5" style={{ color: "var(--color-success)" }}>📅 日程確定</p>
          {(() => {
            const { date, time } = formatCandidateDate(confirmedCandidate.startsAt, confirmedCandidate.endsAt);
            return (
              <p className="text-lg font-bold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
                {date} {time}
              </p>
            );
          })()}
        </div>
      )}

      {meeting.description && (
        <p className="mb-4 text-sm" style={{ color: "var(--color-ink-600)" }}>{meeting.description}</p>
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
                  const isConfirmed = cand.id === meeting.confirmedCandidateId;
                  return (
                    <th key={cand.id} className="text-center pb-1">
                      <div className={`px-2 py-1.5 rounded-xl text-xs font-medium leading-tight ${isConfirmed ? "ring-2" : ""}`}
                        style={{
                          background: isConfirmed ? "rgba(90,140,92,0.15)" : "var(--color-paper-200)",
                          color: isConfirmed ? "var(--color-success)" : "var(--color-ink-700)",
                          minWidth: "52px",
                          ...(isConfirmed ? { "--tw-ring-color": "var(--color-success)" } as React.CSSProperties : {}),
                        }}>
                        <div>{date}</div>
                        {time && <div className="text-xs opacity-75">{time}</div>}
                        <div className="mt-1 font-bold text-sm" style={{ color: "var(--color-success)" }}>
                          ○{countYes(respondents, cand.id)}
                        </div>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {/* 既存回答者 */}
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

      {/* ---- 主催者向け操作 ---- */}
      {isHost && meeting.status === "open" && (
        <div className="card-paper rounded-3xl p-4 mb-5 space-y-3">
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-ink-700)" }}>⚙️ 主催者メニュー</h2>

          {/* 日程確定 */}
          <div>
            <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>日程を確定する</p>
            <div className="space-y-1.5">
              {candidates.map((cand) => {
                const { date, time } = formatCandidateDate(cand.startsAt, cand.endsAt);
                const yesCount = countYes(respondents, cand.id);
                return (
                  <button
                    key={cand.id}
                    onClick={() => {
                      if (window.confirm(`「${date} ${time}」で確定しますか？`)) {
                        confirmMutation.mutate(cand.id);
                      }
                    }}
                    disabled={confirmMutation.isPending}
                    className="w-full flex items-center justify-between px-4 py-2.5 rounded-2xl text-sm font-medium transition hover:opacity-80 disabled:opacity-50"
                    style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}
                  >
                    <span>{date} {time}</span>
                    <span className="text-sm font-bold" style={{ color: "var(--color-success)" }}>○{yesCount}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 外部招待URL発行 */}
          <div>
            <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>外部ゲストを招待</p>
            <button
              onClick={() => externalMutation.mutate()}
              disabled={externalMutation.isPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium transition hover:opacity-80 disabled:opacity-50"
              style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}
            >
              {externalMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <LinkIcon size={14} />}
              招待URLを生成する
            </button>
          </div>

          {/* 既存の外部招待URL一覧 */}
          {externalInvitees.length > 0 && (
            <div className="space-y-1.5">
              {externalInvitees.map((ext) => (
                <div key={ext.id} className="flex items-center gap-2 px-3 py-2 rounded-xl"
                  style={{ background: "var(--color-paper-200)" }}>
                  <span className="text-xs flex-1 truncate" style={{ color: "var(--color-ink-600)" }}>
                    👤 {ext.name || "（名前未入力）"}
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
                    {copiedToken === ext.token ? "コピー済み" : "URLをコピー"}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* キャンセル */}
          <button
            onClick={() => { if (window.confirm("このミーティングをキャンセルしますか？")) cancelMutation.mutate(); }}
            disabled={cancelMutation.isPending}
            className="w-full py-2.5 rounded-2xl text-sm font-medium transition disabled:opacity-50"
            style={{ background: "transparent", color: "var(--color-ink-400)", border: "1px solid var(--color-paper-300)" }}
          >
            ミーティングをキャンセル
          </button>
        </div>
      )}

      {/* 確定済み主催者: 外部URLコピー */}
      {isHost && meeting.status === "confirmed" && externalInvitees.length > 0 && (
        <div className="card-paper rounded-3xl p-4 mb-5 space-y-1.5">
          <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--color-ink-700)" }}>外部招待リンク</h2>
          {externalInvitees.map((ext) => (
            <div key={ext.id} className="flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{ background: "var(--color-paper-200)" }}>
              <span className="text-xs flex-1 truncate" style={{ color: "var(--color-ink-600)" }}>
                👤 {ext.name || "（名前未入力）"}
              </span>
              <button onClick={() => copyExternalUrl(ext.token)}
                className="shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-lg"
                style={{ background: "var(--color-paper-50)", color: "var(--color-ink-500)" }}>
                <Copy size={12} />URLをコピー
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
