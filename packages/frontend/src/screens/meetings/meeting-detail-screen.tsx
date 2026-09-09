// =============================================================
// ミーティング詳細画面（レスポンスグリッド）
// =============================================================
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ChevronLeft, Check, Link as LinkIcon, Copy, CheckCircle, Edit2, UserPlus, Trash2, Video, ExternalLink, X, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useSettings } from "@/hooks/use-settings";
import { ActivityPostPrompt } from "@/components/activity-post-prompt";

type Availability = "yes" | "maybe" | "no";

type Candidate = { id: string; startsAt: number; endsAt: number | null; note: string | null; sortOrder: number; isConfirmed: number; conferenceUrl: string | null; addedByMemberId: string | null; addedByName: string | null };
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
  conferenceType: "manual" | "google_meet" | "zoom";
  conferenceUrl: string | null;
  seriesId: string | null;
  seriesOccurrenceIndex: number | null;
  inviteToken: string | null;
};
type LinkedEvent = { id: string; title: string; multiplier: number | null };
type AttendanceRecord = { memberId: string; status: "attended" | "absent"; candidateId: string | null; pointsAwarded: number | null };
type DetailResponse = {
  data: {
    meeting: Meeting;
    candidates: Candidate[];
    respondents: Respondent[];
    externalInvitees: ExternalInvitee[];
    myAnswers: Record<string, Availability>;
    isHost: boolean;
    declinedMemberIds: string[];
    myDeclined: boolean;
    maxCandidates: number;
    lastReminderSentAt: number | null;
    linkedEvent: LinkedEvent | null;
    myAttendances: { status: "attended" | "absent"; candidateId: string | null; pointsAwarded: number | null }[];
    attendances: AttendanceRecord[];
    availableConferenceTypes: ("google_meet" | "zoom")[];
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

// 候補日追加フォーム用の行データ（meeting-new-screen.tsx と同じ入力パターン）
type NewCandidateRow = { date: string; time: string; endTime: string };
function emptyCandidateRow(): NewCandidateRow {
  return { date: "", time: "09:00", endTime: "10:00" };
}
function rowToUnixTimestamp(date: string, time: string): number {
  const dt = time ? new Date(`${date}T${time}:00`) : new Date(`${date}T00:00:00`);
  return Math.floor(dt.getTime() / 1000);
}
function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function toDateTimeStr(ts: number): { date: string; time: string } {
  const d = new Date(ts * 1000);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { date, time };
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

// 確定済み候補日のセルにRSVP出欠を表示するためのステータス解決
// 1人が複数の確定日にそれぞれ個別の出席記録を持てるため、まずcandidateIdが完全一致する記録を探す。
// 旧データ（candidateIdがnullで1件のみ）は後方互換のフォールバックで拾う。
function getAttendanceForCell(
  memberId: string,
  candidateId: string,
  isConfirmed: boolean,
  attendances: AttendanceRecord[],
  totalConfirmedCount: number,
): "attended" | "absent" | null {
  if (!isConfirmed) return null;
  const myAtts = attendances.filter((a) => a.memberId === memberId);
  if (myAtts.length === 0) return null;
  const exact = myAtts.find((a) => a.candidateId === candidateId);
  if (exact) return exact.status;
  const legacy = myAtts.find((a) => a.candidateId === null);
  if (legacy) {
    if (legacy.status === "absent") return "absent"; // 全日程を欠席
    if (legacy.status === "attended" && totalConfirmedCount === 1) return "attended"; // 確定日が1つのみなら自明
  }
  return null;
}

function RSVPCell({ attendanceStatus, availability }: {
  attendanceStatus: "attended" | "absent" | null;
  availability: Availability | undefined;
}) {
  // RSVP参加表明はスケジューリングの○と同等に扱う
  if (attendanceStatus === "attended") return <AvailCell value="yes" />;
  if (attendanceStatus === "absent") {
    return (
      <div className="flex items-center justify-center w-10 h-10 rounded-xl text-base"
        style={{ background: "rgba(0,0,0,0.06)", color: "var(--color-ink-400)" }}>
        ❌
      </div>
    );
  }
  return <AvailCell value={availability} />;
}

export function MeetingDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const { termExternalGuest } = useSettings();

  const [myAnswers, setMyAnswers] = useState<Record<string, Availability>>({});
  const [hasEdited, setHasEdited] = useState(false);
  const [copiedToken, setCopiedToken] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descText, setDescText] = useState("");
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [showEventPicker, setShowEventPicker] = useState(false);
  const [manualConfUrl, setManualConfUrl] = useState("");
  const [settingUrlForCandidate, setSettingUrlForCandidate] = useState<string | null>(null);
  const [copiedConfUrl, setCopiedConfUrl] = useState<string>("");
  const [reschedulingCandidateId, setReschedulingCandidateId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [rescheduleEndTime, setRescheduleEndTime] = useState("");
  // 確定モーダル
  type ConfirmModal = { candidateId: string; dateText: string };
  const [confirmModal, setConfirmModal] = useState<ConfirmModal | null>(null);
  const [confirmUrlType, setConfirmUrlType] = useState<"google_meet" | "zoom" | "manual" | null>(null);
  const [confirmManualUrl, setConfirmManualUrl] = useState("");
  const [sharedInviteUrl, setSharedInviteUrl] = useState<string | null>(null);
  const [copiedSharedUrl, setCopiedSharedUrl] = useState(false);
  // 出席確認後、活動タイムラインへの投稿を促すプロンプト（パイロット限定・相手が1名の時のみ）
  const [postPromptPartner, setPostPromptPartner] = useState<{ id: string; name: string } | null>(null);
  // 都合が悪い場合の連絡・候補日提案（参加者向け）
  const [showUnavailableForm, setShowUnavailableForm] = useState(false);
  const [unavailableMessage, setUnavailableMessage] = useState("");
  const [proposedCandidates, setProposedCandidates] = useState<NewCandidateRow[]>([]);
  // 候補日の追加（主催者向け）
  const [showHostAddForm, setShowHostAddForm] = useState(false);
  const [hostNewCandidates, setHostNewCandidates] = useState<NewCandidateRow[]>([emptyCandidateRow()]);
  // 候補日の編集
  const [editCandidateModal, setEditCandidateModal] = useState<{ id: string } & NewCandidateRow | null>(null);

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

  // inviteToken が既に発行済みの場合は共有URLを初期化
  useEffect(() => {
    const token = data?.data?.meeting?.inviteToken;
    if (token && !sharedInviteUrl) {
      setSharedInviteUrl(`${window.location.origin}/schedule/invite/${token}`);
    }
  }, [data]);

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
    mutationFn: ({ candidateId, deferNotification }: { candidateId: string; deferNotification?: boolean }) =>
      api.patch(`/meetings/${id}/confirm`, { candidateId, deferNotification }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", id] }),
  });

  const addCandidatesMutation = useMutation({
    mutationFn: (payload: { candidates?: Array<{ startsAt: number; endsAt?: number }>; message?: string }) =>
      api.post(`/meetings/${id}/candidates`, payload),
    onSuccess: () => {
      setShowUnavailableForm(false);
      setUnavailableMessage("");
      setProposedCandidates([]);
      setShowHostAddForm(false);
      setHostNewCandidates([emptyCandidateRow()]);
      qc.invalidateQueries({ queryKey: ["meetings", id] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "候補日の追加に失敗しました";
      window.alert(msg);
    },
  });

  const removeCandidateMutation = useMutation({
    mutationFn: (candidateId: string) => api.delete(`/meetings/${id}/candidates/${candidateId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", id] }),
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "候補日の削除に失敗しました";
      window.alert(msg);
    },
  });

  const editCandidateMutation = useMutation({
    mutationFn: ({ candidateId, startsAt, endsAt }: { candidateId: string; startsAt: number; endsAt?: number }) =>
      api.patch(`/meetings/${id}/candidates/${candidateId}`, { startsAt, endsAt }),
    onSuccess: () => {
      setEditCandidateModal(null);
      qc.invalidateQueries({ queryKey: ["meetings", id] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "候補日の編集に失敗しました";
      window.alert(msg);
    },
  });

  const declineMutation = useMutation({
    mutationFn: () => api.post(`/meetings/${id}/decline`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", id] }),
  });

  const undeclineMutation = useMutation({
    mutationFn: () => api.delete(`/meetings/${id}/decline`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", id] }),
  });

  const remindMutation = useMutation({
    mutationFn: () => api.post<{ data: { remindedCount: number }; message?: string }>(`/meetings/${id}/remind`, {}),
    onSuccess: (res) => {
      window.alert(res.message ?? `${res.data.remindedCount}人にリマインダーを送信しました`);
      qc.invalidateQueries({ queryKey: ["meetings", id] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "リマインダーの送信に失敗しました";
      window.alert(msg);
    },
  });

  // 日程確定 + 会議URL設定を同時に行う複合ミューテーション
  const confirmWithUrlMutation = useMutation({
    mutationFn: async ({ candidateId, urlType, url }: { candidateId: string; urlType: "google_meet" | "zoom" | "manual"; url?: string }) => {
      await api.patch(`/meetings/${id}/confirm`, { candidateId, deferNotification: true });
      await api.patch(`/meetings/${id}/conference`, { type: urlType, url, justConfirmed: true });
    },
    onSuccess: () => {
      setConfirmModal(null);
      setConfirmUrlType(null);
      setConfirmManualUrl("");
      qc.invalidateQueries({ queryKey: ["meetings", id] });
      qc.invalidateQueries({ queryKey: ["meetings", "notifications"] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.delete(`/meetings/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
      navigate("/meetings");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/meetings/${id}/delete`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
      navigate("/meetings");
    },
  });

  const sharedInviteMutation = useMutation({
    mutationFn: () => api.post<{ data: { inviteToken: string } }>(`/meetings/${id}/invite`, {}),
    onSuccess: (res) => {
      const token = res.data.inviteToken;
      setSharedInviteUrl(`${window.location.origin}/schedule/invite/${token}`);
      qc.invalidateQueries({ queryKey: ["meetings", id] });
    },
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

  const conferenceMutation = useMutation({
    mutationFn: (body: { type: "manual" | "google_meet" | "zoom"; url?: string; justConfirmed?: boolean }) =>
      api.patch(`/meetings/${id}/conference`, body),
    onSuccess: () => {
      setManualConfUrl("");
      setSettingUrlForCandidate(null);
      qc.invalidateQueries({ queryKey: ["meetings", id] });
      qc.invalidateQueries({ queryKey: ["meetings", "notifications"] });
    },
  });

  const rescheduleMutation = useMutation({
    mutationFn: (body: { startsAt: number; endsAt?: number }) => api.patch(`/meetings/${id}/reschedule`, body),
    onSuccess: () => {
      setReschedulingCandidateId(null);
      qc.invalidateQueries({ queryKey: ["meetings", id] });
    },
  });

  const attendanceMutation = useMutation({
    mutationFn: ({ status, candidateId }: { status: "attended" | "absent"; candidateId?: string | null }) =>
      api.post<{ ok: boolean; pointsAwarded: number }>(`/meetings/${id}/attendance`, { status, candidateId }),
    onSuccess: (_res, variables) => {
      qc.invalidateQueries({ queryKey: ["meetings", id] });
      qc.invalidateQueries({ queryKey: ["meetings", "pending-attendance"] });
      qc.invalidateQueries({ queryKey: ["ranking", "me"] });
      // 出席（参加した）を記録した時、相手が1名だけの1to1的なミーティングなら、
      // 活動タイムラインへの投稿を促す
      if (variables.status === "attended") {
        const others = (data?.data.respondents ?? []).filter((r) => r.type === "member" && r.id !== user?.id);
        if (others.length === 1) {
          setPostPromptPartner({ id: others[0].id, name: others[0].name });
        }
      }
    },
  });

  if (isLoading || !data) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
      </div>
    );
  }

  const { meeting, candidates, respondents, externalInvitees, isHost, linkedEvent, myAttendances, attendances, availableConferenceTypes, myDeclined, maxCandidates } = data.data;
  const confirmedCandidates = candidates.filter((c) => c.isConfirmed === 1).sort((a, b) => a.startsAt - b.startsAt);
  const candidateSlotsLeft = maxCandidates - candidates.length;

  // 指定した候補日に対する自分の出席予定を探す（旧データはcandidateIdがnullで1件のみ保持しているため後方互換で拾う）
  const findMyAttendance = (candidateId: string) =>
    myAttendances.find((a) => a.candidateId === candidateId)
    ?? (myAttendances.length === 1 && myAttendances[0].candidateId === null ? myAttendances[0] : undefined);
  // 「出席確認」（開催後）セクションは最も早い確定日を対象に表示する
  const myAttendanceForEarliestDate = confirmedCandidates[0] ? findMyAttendance(confirmedCandidates[0].id) : undefined;

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

  async function copySharedUrl() {
    if (!sharedInviteUrl) return;
    await navigator.clipboard.writeText(sharedInviteUrl).catch(() => {});
    setCopiedSharedUrl(true);
    setTimeout(() => setCopiedSharedUrl(false), 2000);
  }

  function startEditDesc() {
    setDescText(meeting.description ?? "");
    setEditingDesc(true);
  }

  const scopeLabel: Record<string, string> = { all: "全メンバー", team: "ギルド", selected: "指定メンバー" };

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
          {meeting.seriesId && (
            <button onClick={() => navigate(`/meetings/series/${meeting.seriesId}`)}
              className="text-xs mt-0.5" style={{ color: "var(--color-brand)" }}>
              🔁 定例会の第{meeting.seriesOccurrenceIndex}回です（シリーズ全体を見る）
            </button>
          )}
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

      {/* 確定日バナー（複数対応・会議URL管理を含む） */}
      {meeting.status === "confirmed" && confirmedCandidates.length > 0 && (
        <div className="mb-4 p-4 rounded-2xl space-y-4"
          style={{ background: "rgba(90,140,92,0.08)", border: "1px solid rgba(90,140,92,0.25)" }}>
          <p className="text-xs font-medium text-center" style={{ color: "var(--color-success)" }}>📅 日程確定</p>
          {confirmedCandidates.map((cand) => {
            const { date, time } = formatCandidateDate(cand.startsAt, cand.endsAt);
            const isSettingUrl = settingUrlForCandidate === cand.id;
            const confTypeLabel = cand.conferenceUrl
              ? (meeting.conferenceType === "zoom" ? "Zoom で参加" : meeting.conferenceType === "google_meet" ? "Meet で参加" : "参加する")
              : "";
            return (
              <div key={cand.id} className="space-y-2">
                <p className="text-center text-lg font-bold"
                  style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
                  {date} {time}
                </p>
                {isHost && confirmedCandidates.length === 1 && meeting.status === "confirmed" && (
                  <div className="text-center">
                    {reschedulingCandidateId === cand.id ? (
                      <div className="rounded-2xl p-3 space-y-2 inline-block text-left"
                        style={{ background: "white", border: "1px solid rgba(90,140,92,0.3)" }}>
                        <div className="flex items-center gap-2">
                          <input type="date" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)}
                            className="px-2 py-1.5 rounded-lg text-xs border" style={{ borderColor: "var(--color-paper-300)" }} />
                          <input type="time" value={rescheduleTime} onChange={(e) => setRescheduleTime(e.target.value)}
                            className="px-2 py-1.5 rounded-lg text-xs border" style={{ borderColor: "var(--color-paper-300)" }} />
                          <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>〜</span>
                          <input type="time" value={rescheduleEndTime} onChange={(e) => setRescheduleEndTime(e.target.value)}
                            className="px-2 py-1.5 rounded-lg text-xs border" style={{ borderColor: "var(--color-paper-300)" }} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => setReschedulingCandidateId(null)}
                            className="flex-1 py-1.5 rounded-lg text-xs font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                            キャンセル
                          </button>
                          <button
                            onClick={() => {
                              if (!rescheduleDate || !rescheduleTime) return;
                              const startsAt = Math.floor(new Date(`${rescheduleDate}T${rescheduleTime}:00`).getTime() / 1000);
                              const endsAt = rescheduleEndTime ? Math.floor(new Date(`${rescheduleDate}T${rescheduleEndTime}:00`).getTime() / 1000) : undefined;
                              rescheduleMutation.mutate({ startsAt, endsAt });
                            }}
                            disabled={rescheduleMutation.isPending || !rescheduleDate || !rescheduleTime}
                            className="flex-1 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
                            style={{ background: "var(--color-success)" }}>
                            {rescheduleMutation.isPending ? <Loader2 size={11} className="animate-spin inline" /> : "保存"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          const d = new Date(cand.startsAt * 1000);
                          setRescheduleDate(d.toISOString().slice(0, 10));
                          setRescheduleTime(d.toTimeString().slice(0, 5));
                          setRescheduleEndTime(cand.endsAt ? new Date(cand.endsAt * 1000).toTimeString().slice(0, 5) : "");
                          setReschedulingCandidateId(cand.id);
                        }}
                        className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-2xl border transition"
                        style={{ borderColor: "var(--color-paper-300)", color: "var(--color-ink-400)", background: "white" }}>
                        <Edit2 size={11} />今回だけ日時を変更する
                      </button>
                    )}
                  </div>
                )}
                {cand.conferenceUrl ? (
                  /* URL設定済み: 参加ボタン + コピーボタン */
                  <div className="flex items-center gap-2 justify-center flex-wrap">
                    <a href={cand.conferenceUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-2xl font-medium text-white"
                      style={{ background: "var(--color-success)" }}>
                      <Video size={13} />{confTypeLabel}
                    </a>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(cand.conferenceUrl!);
                        setCopiedConfUrl(cand.id);
                        setTimeout(() => setCopiedConfUrl(""), 2000);
                      }}
                      className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-2xl border transition"
                      style={{
                        borderColor: copiedConfUrl === cand.id ? "var(--color-success)" : "rgba(90,140,92,0.3)",
                        color: copiedConfUrl === cand.id ? "var(--color-success)" : "var(--color-ink-600)",
                        background: "white",
                      }}>
                      {copiedConfUrl === cand.id ? <Check size={12} /> : <Copy size={12} />}
                      {copiedConfUrl === cand.id ? "コピー済" : "URLコピー"}
                    </button>
                    {isHost && (
                      <button
                        onClick={() => { setSettingUrlForCandidate(isSettingUrl ? null : cand.id); setManualConfUrl(cand.conferenceUrl ?? ""); }}
                        className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-2xl border transition"
                        style={{ borderColor: "var(--color-paper-300)", color: "var(--color-ink-400)", background: "white" }}>
                        <Edit2 size={11} />変更
                      </button>
                    )}
                  </div>
                ) : null}
                {cand.conferenceUrl && (
                  <p className="text-xs text-center break-all px-2" style={{ color: "var(--color-ink-400)" }}>
                    {cand.conferenceUrl}
                  </p>
                )}
                {!cand.conferenceUrl && (
                  isHost ? (
                    /* URL未設定・ホスト: 設定ボタン or インライン設定パネル */
                    !isSettingUrl ? (
                      <div className="text-center">
                        <button
                          onClick={() => { setSettingUrlForCandidate(cand.id); setManualConfUrl(""); }}
                          className="inline-flex items-center gap-1.5 text-xs px-4 py-2 rounded-2xl font-medium border"
                          style={{ borderColor: "rgba(90,140,92,0.4)", color: "var(--color-success)", background: "white" }}>
                          <Video size={12} />会議URLを設定
                        </button>
                      </div>
                    ) : null
                  ) : (
                    /* URL未設定・非ホスト */
                    <p className="text-center text-xs" style={{ color: "var(--color-ink-400)" }}>
                      会議URLは後日お知らせします
                    </p>
                  )
                )}
                {/* インライン会議URL設定パネル（ホスト用） */}
                {isHost && isSettingUrl && (
                  <div className="rounded-2xl p-3 space-y-2"
                    style={{ background: "white", border: "1px solid rgba(90,140,92,0.3)" }}>
                    {availableConferenceTypes.length > 0 && (
                      <div className="flex gap-2">
                        {availableConferenceTypes.map((t) => (
                          <button key={t}
                            onClick={() => conferenceMutation.mutate({ type: t })}
                            disabled={conferenceMutation.isPending}
                            className="flex-1 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-50"
                            style={{ background: "var(--color-success)" }}>
                            {conferenceMutation.isPending ? <Loader2 size={12} className="animate-spin inline" /> : t === "google_meet" ? "📹 Google Meet" : "📹 Zoom"}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <input type="url" value={manualConfUrl}
                        onChange={(e) => setManualConfUrl(e.target.value)}
                        placeholder="URLを直接入力"
                        className="flex-1 px-3 py-2 rounded-xl border text-xs"
                        style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }} />
                      <button
                        onClick={() => conferenceMutation.mutate({ type: "manual", url: manualConfUrl })}
                        disabled={conferenceMutation.isPending || !manualConfUrl.trim()}
                        className="px-3 py-2 rounded-xl text-xs font-bold flex-shrink-0 disabled:opacity-50"
                        style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
                        保存
                      </button>
                      <button onClick={() => setSettingUrlForCandidate(null)}
                        className="px-2 py-2 rounded-xl text-xs flex-shrink-0"
                        style={{ color: "var(--color-ink-400)" }}>
                        取消
                      </button>
                    </div>
                    {conferenceMutation.isError && (
                      <p className="text-xs" style={{ color: "var(--color-brand)" }}>会議URLの設定に失敗しました</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
                  // 確定日程は日程調整の○とRSVP参加者を合算（重複なし）
                  const displayCount = isConfirmed
                    ? respondents.filter((r) => {
                        const hasYes = r.answers[cand.id] === "yes";
                        if (r.type !== "member") return hasYes;
                        const att = attendances.find((a) => a.memberId === r.id);
                        const hasRsvp = !!att && att.status === "attended" && (
                          att.candidateId === cand.id ||
                          (att.candidateId === null && confirmedCandidates.length === 1)
                        );
                        return hasYes || hasRsvp;
                      }).length
                    : yesCount;
                  const canModify = meeting.status !== "cancelled" && !isConfirmed
                    && (isHost || cand.addedByMemberId === user?.id);
                  const canRemove = canModify && candidates.length > 1;
                  return (
                    <th key={cand.id} className="text-center pb-1">
                      <div className={`relative px-2 py-1.5 rounded-xl text-xs font-medium leading-tight ${isConfirmed ? "ring-2" : ""}`}
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
                        {canModify && (
                          <button
                            onClick={() => {
                              const parts = toDateTimeStr(cand.startsAt);
                              const endParts = cand.endsAt ? toDateTimeStr(cand.endsAt).time : "";
                              setEditCandidateModal({ id: cand.id, date: parts.date, time: parts.time, endTime: endParts });
                            }}
                            className="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full flex items-center justify-center"
                            style={{ background: "var(--color-paper-50)", color: "var(--color-ink-400)", border: "1px solid var(--color-paper-300)" }}
                            title="この候補日を編集する"
                          >
                            <Edit2 size={9} />
                          </button>
                        )}
                        {canRemove && (
                          <button
                            onClick={() => {
                              if (window.confirm(`${date}${time ? " " + time : ""} の候補日を削除しますか？\n参加者に通知されます。`)) {
                                removeCandidateMutation.mutate(cand.id);
                              }
                            }}
                            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center"
                            style={{ background: "var(--color-paper-50)", color: "var(--color-ink-400)", border: "1px solid var(--color-paper-300)" }}
                            title="この候補日を削除する"
                          >
                            <X size={10} />
                          </button>
                        )}
                        {isTopCandidate && !isConfirmed && (
                          <div className="text-xs mb-0.5" style={{ color: "var(--color-accent)" }}>★最多</div>
                        )}
                        <div>{date}</div>
                        {time && <div className="text-xs opacity-75">{time}</div>}
                        <div className="mt-1 font-bold text-sm" style={{ color: "var(--color-success)" }}>
                          ○{displayCount}
                        </div>
                        {cand.addedByName && (
                          <div className="mt-0.5 text-xs whitespace-nowrap" style={{ color: "var(--color-ink-500)", opacity: 0.85 }}>
                            {cand.addedByName}さんが追加
                          </div>
                        )}
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
                    {candidates.map((cand) => {
                      const isConfirmed = cand.isConfirmed === 1;
                      const attendanceStatus = r.type === "member"
                        ? getAttendanceForCell(r.id, cand.id, isConfirmed, attendances, confirmedCandidates.length)
                        : null;
                      return (
                        <td key={cand.id} className="text-center">
                          <RSVPCell attendanceStatus={attendanceStatus} availability={r.answers[cand.id]} />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- 回答受付終了（回答期限超過） ---- */}
      {meeting.status === "open" && meeting.deadline != null && meeting.deadline < nowSec && (
        <div className="card-paper rounded-3xl p-4 mb-5 text-center">
          <p className="text-sm font-medium" style={{ color: "var(--color-ink-500)" }}>
            🔒 回答受付は終了しました（期限: {formatDeadline(meeting.deadline)}）
          </p>
        </div>
      )}

      {/* ---- 辞退済みバナー（主催者以外） ---- */}
      {!isHost && myDeclined && (
        <div className="card-paper rounded-3xl p-4 mb-5 flex items-center gap-3">
          <span className="text-lg">🙇</span>
          <p className="flex-1 text-sm" style={{ color: "var(--color-ink-600)" }}>
            このミーティングを辞退しています
          </p>
          <button
            onClick={() => undeclineMutation.mutate()}
            disabled={undeclineMutation.isPending}
            className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-full disabled:opacity-50"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
          >
            やっぱり参加する
          </button>
        </div>
      )}

      {/* ---- 自分の回答入力（open ミーティングのみ） ---- */}
      {meeting.status === "open" && !myDeclined && (meeting.deadline == null || meeting.deadline >= nowSec) && (
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

      {/* ---- 都合が悪い場合の連絡・候補日提案（open ミーティング・主催者以外） ---- */}
      {meeting.status === "open" && !isHost && !myDeclined && (
        <div className="card-paper rounded-3xl p-4 mb-5">
          {!showUnavailableForm ? (
            <button
              onClick={() => setShowUnavailableForm(true)}
              className="w-full text-sm font-medium text-left flex items-center gap-2"
              style={{ color: "var(--color-ink-500)" }}
            >
              😥 都合の良い日程がない場合はこちら
            </button>
          ) : (
            <>
              <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink-700)" }}>
                😥 都合の良い日程がありません
              </h2>
              <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
                主催者へメッセージを送ったり、あなたの都合の良い候補日を提案できます（どちらも任意です）。
              </p>
              <textarea
                value={unavailableMessage}
                onChange={(e) => setUnavailableMessage(e.target.value)}
                placeholder="主催者へのメッセージ（任意）"
                rows={3}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none border mb-3"
                style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
              />
              <div className="space-y-2 mb-2">
                {proposedCandidates.map((cand, i) => (
                  <div key={i} className="rounded-2xl px-3 py-2" style={{ background: "var(--color-paper-100)" }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-medium" style={{ color: "var(--color-ink-500)" }}>提案する候補日 {i + 1}</span>
                      <button
                        onClick={() => setProposedCandidates(proposedCandidates.filter((_, idx) => idx !== i))}
                        className="ml-auto p-1 rounded-xl hover:opacity-70"
                        style={{ color: "var(--color-ink-400)" }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <input type="date" value={cand.date} min={todayDateStr()}
                        onChange={(e) => setProposedCandidates(proposedCandidates.map((c, idx) => idx === i ? { ...c, date: e.target.value } : c))}
                        className="col-span-3 sm:col-span-1 px-2 py-1.5 rounded-xl text-xs outline-none border"
                        style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
                      <input type="time" value={cand.time}
                        onChange={(e) => setProposedCandidates(proposedCandidates.map((c, idx) => idx === i ? { ...c, time: e.target.value } : c))}
                        className="col-span-3 sm:col-span-1 px-2 py-1.5 rounded-xl text-xs outline-none border"
                        style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
                      <input type="time" value={cand.endTime}
                        onChange={(e) => setProposedCandidates(proposedCandidates.map((c, idx) => idx === i ? { ...c, endTime: e.target.value } : c))}
                        className="col-span-3 sm:col-span-1 px-2 py-1.5 rounded-xl text-xs outline-none border"
                        style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setProposedCandidates([...proposedCandidates, emptyCandidateRow()])}
                disabled={proposedCandidates.length >= candidateSlotsLeft}
                className="w-full py-2 rounded-2xl text-xs font-medium flex items-center justify-center gap-1.5 mb-1 disabled:opacity-50"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
              >
                <Plus size={13} /> 候補日を提案する
              </button>
              <p className="text-xs mb-3" style={{ color: "var(--color-ink-400)" }}>
                候補日は最大{maxCandidates}個まで（現在{candidates.length}個）
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowUnavailableForm(false); setUnavailableMessage(""); setProposedCandidates([]); }}
                  className="flex-1 py-2.5 rounded-2xl text-sm"
                  style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
                >
                  キャンセル
                </button>
                <button
                  onClick={() => {
                    const validCandidates = proposedCandidates
                      .filter((c) => c.date)
                      .map((c) => ({
                        startsAt: rowToUnixTimestamp(c.date, c.time),
                        endsAt: c.endTime ? rowToUnixTimestamp(c.date, c.endTime) : undefined,
                      }));
                    addCandidatesMutation.mutate({
                      candidates: validCandidates.length > 0 ? validCandidates : undefined,
                      message: unavailableMessage.trim() || undefined,
                    });
                  }}
                  disabled={addCandidatesMutation.isPending || (!unavailableMessage.trim() && proposedCandidates.every((c) => !c.date))}
                  className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: "var(--color-brand)" }}
                >
                  {addCandidatesMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  送信する
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---- ミーティングの辞退（open ミーティング・主催者以外） ---- */}
      {meeting.status === "open" && !isHost && !myDeclined && (
        <div className="mb-5 text-center">
          <button
            onClick={() => {
              if (window.confirm("このミーティングを辞退しますか？\n主催者に通知されます。あとから「やっぱり参加する」で取り消せます。")) {
                declineMutation.mutate();
              }
            }}
            className="text-xs underline"
            style={{ color: "var(--color-ink-400)" }}
          >
            このミーティングを辞退する
          </button>
        </div>
      )}

      {/* ---- 候補日の追加（open ミーティング・主催者のみ） ---- */}
      {meeting.status === "open" && isHost && (
        <div className="card-paper rounded-3xl p-4 mb-5">
          {!showHostAddForm ? (
            <button
              onClick={() => setShowHostAddForm(true)}
              className="w-full text-sm font-medium text-left flex items-center gap-2"
              style={{ color: "var(--color-ink-500)" }}
            >
              ➕ 候補日を追加する
            </button>
          ) : (
            <>
              <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink-700)" }}>
                ➕ 候補日を追加する
              </h2>
              <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
                追加すると、参加者全員にもう一度ご都合の確認をお願いする通知が届きます。
              </p>
              <div className="space-y-2 mb-2">
                {hostNewCandidates.map((cand, i) => (
                  <div key={i} className="rounded-2xl px-3 py-2" style={{ background: "var(--color-paper-100)" }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-medium" style={{ color: "var(--color-ink-500)" }}>候補 {i + 1}</span>
                      {hostNewCandidates.length > 1 && (
                        <button
                          onClick={() => setHostNewCandidates(hostNewCandidates.filter((_, idx) => idx !== i))}
                          className="ml-auto p-1 rounded-xl hover:opacity-70"
                          style={{ color: "var(--color-ink-400)" }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <input type="date" value={cand.date} min={todayDateStr()}
                        onChange={(e) => setHostNewCandidates(hostNewCandidates.map((c, idx) => idx === i ? { ...c, date: e.target.value } : c))}
                        className="col-span-3 sm:col-span-1 px-2 py-1.5 rounded-xl text-xs outline-none border"
                        style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
                      <input type="time" value={cand.time}
                        onChange={(e) => setHostNewCandidates(hostNewCandidates.map((c, idx) => idx === i ? { ...c, time: e.target.value } : c))}
                        className="col-span-3 sm:col-span-1 px-2 py-1.5 rounded-xl text-xs outline-none border"
                        style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
                      <input type="time" value={cand.endTime}
                        onChange={(e) => setHostNewCandidates(hostNewCandidates.map((c, idx) => idx === i ? { ...c, endTime: e.target.value } : c))}
                        className="col-span-3 sm:col-span-1 px-2 py-1.5 rounded-xl text-xs outline-none border"
                        style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setHostNewCandidates([...hostNewCandidates, emptyCandidateRow()])}
                disabled={hostNewCandidates.length >= candidateSlotsLeft}
                className="w-full py-2 rounded-2xl text-xs font-medium flex items-center justify-center gap-1.5 mb-1 disabled:opacity-50"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
              >
                <Plus size={13} /> 候補日を追加
              </button>
              <p className="text-xs mb-3" style={{ color: "var(--color-ink-400)" }}>
                候補日は最大{maxCandidates}個まで（現在{candidates.length}個）
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowHostAddForm(false); setHostNewCandidates([emptyCandidateRow()]); }}
                  className="flex-1 py-2.5 rounded-2xl text-sm"
                  style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
                >
                  キャンセル
                </button>
                <button
                  onClick={() => {
                    const validCandidates = hostNewCandidates
                      .filter((c) => c.date)
                      .map((c) => ({
                        startsAt: rowToUnixTimestamp(c.date, c.time),
                        endsAt: c.endTime ? rowToUnixTimestamp(c.date, c.endTime) : undefined,
                      }));
                    if (validCandidates.length === 0) return;
                    addCandidatesMutation.mutate({ candidates: validCandidates });
                  }}
                  disabled={addCandidatesMutation.isPending || hostNewCandidates.every((c) => !c.date)}
                  className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: "var(--color-brand)" }}
                >
                  {addCandidatesMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  追加する
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---- 参加予定の確認（確定後かつ未開催の日程がある場合）。定例会の開催回では主催者にも表示し、招待された人と同じUIで参加登録できるようにする ---- */}
      {meeting.status === "confirmed" && confirmedCandidates.some((c) => c.startsAt > nowSec) && (!isHost || meeting.seriesId) && (
        <div className="card-paper rounded-3xl p-4 mb-5">
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink-700)" }}>
            📋 参加予定の確認
          </h2>

          {confirmedCandidates.filter((c) => c.startsAt > nowSec).length === 1 ? (
            /* ── 確定日程が1つ ── */
            <>
              <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
                このミーティングに参加予定ですか？
              </p>
              {(() => {
                const onlyCandidate = confirmedCandidates.find((c) => c.startsAt > nowSec)!;
                const myAtt = findMyAttendance(onlyCandidate.id);
                return myAtt ? (
                  <div>
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl mb-2"
                      style={{ background: myAtt.status === "attended" ? "rgba(90,140,92,0.12)" : "var(--color-paper-200)" }}>
                      <span className="text-lg">{myAtt.status === "attended" ? "✅" : "❌"}</span>
                      <p className="text-sm font-medium" style={{ color: myAtt.status === "attended" ? "var(--color-success)" : "var(--color-ink-500)" }}>
                        {myAtt.status === "attended" ? "参加予定" : "欠席予定"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => attendanceMutation.mutate({ status: "attended", candidateId: onlyCandidate.id })}
                        disabled={attendanceMutation.isPending}
                        className="flex-1 py-2 rounded-xl text-xs font-medium transition"
                        style={{ background: myAtt.status === "attended" ? "var(--color-success)" : "var(--color-paper-200)", color: myAtt.status === "attended" ? "white" : "var(--color-ink-600)" }}
                      >
                        ✅ 参加する
                      </button>
                      <button
                        onClick={() => attendanceMutation.mutate({ status: "absent", candidateId: onlyCandidate.id })}
                        disabled={attendanceMutation.isPending}
                        className="flex-1 py-2 rounded-xl text-xs font-medium transition"
                        style={{ background: myAtt.status === "absent" ? "var(--color-ink-500)" : "var(--color-paper-200)", color: myAtt.status === "absent" ? "white" : "var(--color-ink-600)" }}
                      >
                        ❌ 欠席する
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => attendanceMutation.mutate({ status: "attended", candidateId: onlyCandidate.id })}
                      disabled={attendanceMutation.isPending}
                      className="flex-1 py-3 rounded-2xl text-sm font-medium text-white transition"
                      style={{ background: "var(--color-success)" }}
                    >
                      {attendanceMutation.isPending ? <Loader2 size={14} className="animate-spin mx-auto" /> : "✅ 参加する"}
                    </button>
                    <button
                      onClick={() => attendanceMutation.mutate({ status: "absent", candidateId: onlyCandidate.id })}
                      disabled={attendanceMutation.isPending}
                      className="flex-1 py-3 rounded-2xl text-sm font-medium transition"
                      style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
                    >
                      ❌ 欠席する
                    </button>
                  </div>
                );
              })()}
            </>
          ) : (
            /* ── 確定日程が複数：日程ごとに独立して参加・欠席を選べる（両方参加も可） ── */
            <>
              <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
                日程ごとに参加予定を選んでください（両方に参加する場合はそれぞれ「参加する」を選んでください）
              </p>
              <div className="space-y-2 mb-3">
                {confirmedCandidates
                  .filter((c) => c.startsAt > nowSec)
                  .map((cand) => {
                    const { date, time } = formatCandidateDate(cand.startsAt, cand.endsAt);
                    const myAtt = findMyAttendance(cand.id);
                    const isAttending = myAtt?.status === "attended";
                    const isAbsent = myAtt?.status === "absent";
                    return (
                      <div key={cand.id} className="px-4 py-3 rounded-2xl"
                        style={{
                          background: isAttending ? "rgba(90,140,92,0.12)" : "var(--color-paper-200)",
                          border: isAttending ? "1.5px solid rgba(90,140,92,0.35)" : "1.5px solid transparent",
                        }}
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-xl">{isAttending ? "✅" : isAbsent ? "❌" : "📅"}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold" style={{ color: isAttending ? "var(--color-success)" : "var(--color-ink-800)" }}>
                              {date}　{time}
                            </p>
                            <p className="text-xs mt-0.5" style={{ color: isAttending ? "var(--color-success)" : isAbsent ? "var(--color-ink-500)" : "var(--color-ink-400)" }}>
                              {isAttending ? "参加予定" : isAbsent ? "欠席予定" : "未回答"}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => attendanceMutation.mutate({ status: "attended", candidateId: cand.id })}
                            disabled={attendanceMutation.isPending}
                            className="flex-1 py-2 rounded-xl text-xs font-medium transition disabled:opacity-50"
                            style={{ background: isAttending ? "var(--color-success)" : "white", color: isAttending ? "white" : "var(--color-ink-600)" }}
                          >
                            ✅ この日に参加する
                          </button>
                          <button
                            onClick={() => attendanceMutation.mutate({ status: "absent", candidateId: cand.id })}
                            disabled={attendanceMutation.isPending}
                            className="flex-1 py-2 rounded-xl text-xs font-medium transition disabled:opacity-50"
                            style={{ background: isAbsent ? "var(--color-ink-500)" : "white", color: isAbsent ? "white" : "var(--color-ink-600)" }}
                          >
                            ❌ この日は欠席する
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
              <button
                onClick={() => attendanceMutation.mutate({ status: "absent" })}
                disabled={attendanceMutation.isPending}
                className="w-full py-2 rounded-xl text-xs font-medium transition disabled:opacity-50"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-400)" }}
              >
                ❌ 全日程を欠席する
              </button>
            </>
          )}
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
              {myAttendanceForEarliestDate ? "あなたの出席状況" : "このミーティングに出席しましたか？"}
            </p>
            {myAttendanceForEarliestDate ? (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl"
                style={{ background: myAttendanceForEarliestDate.status === "attended" ? "rgba(90,140,92,0.12)" : "var(--color-paper-200)" }}>
                <span className="text-lg">{myAttendanceForEarliestDate.status === "attended" ? "✅" : "❌"}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium" style={{ color: myAttendanceForEarliestDate.status === "attended" ? "var(--color-success)" : "var(--color-ink-500)" }}>
                    {myAttendanceForEarliestDate.status === "attended" ? "出席済み" : "欠席"}
                  </p>
                  {myAttendanceForEarliestDate.pointsAwarded != null && myAttendanceForEarliestDate.pointsAwarded > 0 && (
                    <p className="text-xs" style={{ color: "var(--color-accent)" }}>+{myAttendanceForEarliestDate.pointsAwarded}pt 獲得！</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => attendanceMutation.mutate({ status: "attended", candidateId: confirmedCandidates[0]?.id })}
                  disabled={attendanceMutation.isPending}
                  className="flex-1 py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                  style={{ background: "rgba(90,140,92,0.12)", color: "var(--color-success)", border: "1.5px solid rgba(90,140,92,0.3)" }}
                >
                  {attendanceMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  出席した
                </button>
                <button
                  onClick={() => attendanceMutation.mutate({ status: "absent", candidateId: confirmedCandidates[0]?.id })}
                  disabled={attendanceMutation.isPending}
                  className="flex-1 py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                  style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}
                >
                  欠席
                </button>
              </div>
            )}
            {linkedEvent?.multiplier != null && !myAttendanceForEarliestDate && (
              <p className="text-xs mt-2 text-center" style={{ color: "var(--color-accent)" }}>
                出席すると +{linkedEvent.multiplier}pt が付与されます 🎯
              </p>
            )}
          </div>

          {/* ホスト向け：全員の出席状況（確定日が複数ある場合は日程ごとに表示） */}
          {isHost && attendances.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: "var(--color-ink-500)" }}>参加者の出席状況</p>
              <div className="space-y-1">
                {respondents.filter((r) => r.type === "member").map((r) => {
                  const myAtts = attendances.filter((a) => a.memberId === r.id);
                  return (
                    <div key={r.id} className="flex items-center gap-2 px-3 py-2 rounded-xl"
                      style={{ background: "var(--color-paper-200)" }}>
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs shrink-0 ${r.bgColor}`}>
                        {r.emoji}
                      </div>
                      <span className="text-xs flex-1" style={{ color: "var(--color-ink-700)" }}>{r.name}</span>
                      <div className="text-xs font-medium text-right">
                        {myAtts.length === 0 ? (
                          <span style={{ color: "var(--color-ink-300)" }}>未回答</span>
                        ) : confirmedCandidates.length === 1 ? (
                          (() => {
                            const att = myAtts.find((a) => a.candidateId === confirmedCandidates[0].id)
                              ?? myAtts.find((a) => a.candidateId === null)
                              ?? myAtts[0];
                            return (
                              <span style={{ color: att.status === "attended" ? "var(--color-success)" : "var(--color-ink-400)" }}>
                                {att.status === "attended" ? "✅ 参加予定" : "❌ 欠席"}
                              </span>
                            );
                          })()
                        ) : (
                          <div className="space-y-0.5">
                            {confirmedCandidates.map((cand) => {
                              const att = myAtts.find((a) => a.candidateId === cand.id);
                              if (!att) return null;
                              const { date, time } = formatCandidateDate(cand.startsAt, cand.endsAt);
                              return (
                                <div key={cand.id} style={{ color: att.status === "attended" ? "var(--color-success)" : "var(--color-ink-400)" }}>
                                  {att.status === "attended" ? "✅" : "❌"} {date}{time ? ` ${time}` : ""}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
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

          {/* 未回答者へのリマインダー（確定前のみ） */}
          {meeting.status === "open" && (
            <div>
              <button
                onClick={() => remindMutation.mutate()}
                disabled={remindMutation.isPending}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium transition hover:opacity-80 disabled:opacity-50"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
              >
                {remindMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <span>⏰</span>}
                未回答者にリマインダーを送る
              </button>
            </div>
          )}

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
            <p className="text-xs mb-2 px-3 py-2 rounded-xl" style={{ background: "rgba(212,160,59,0.12)", color: "var(--color-ink-600)" }}>
              💡 参加者の回答を待たなくても、主催者は候補日をいつでも確定できます。確定すると、その場でZoom等の会議URLを発行できるようになります。
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
                        // 確定モーダルを開く
                        setConfirmModal({ candidateId: cand.id, dateText: `${date}${time ? ` ${time}` : ""}` });
                        setConfirmUrlType(null);
                        setConfirmManualUrl("");
                      } else {
                        confirmMutation.mutate({ candidateId: cand.id });
                      }
                    }}
                    disabled={confirmMutation.isPending || confirmWithUrlMutation.isPending}
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

          {/* キャンセル（主催者のみ・募集中または確定済み） */}
          {(meeting.status === "open" || meeting.status === "confirmed") && isHost && (
            <button
              onClick={() => { if (window.confirm("このミーティングをキャンセルしますか？関係者に通知されます。")) cancelMutation.mutate(); }}
              disabled={cancelMutation.isPending}
              className="w-full py-2.5 rounded-2xl text-sm font-medium transition disabled:opacity-50"
              style={{ background: "transparent", color: "var(--color-ink-400)", border: "1px solid var(--color-paper-300)" }}
            >
              ミーティングをキャンセル
            </button>
          )}

          {/* 削除（主催者のみ） */}
          {isHost && (
            <button
              onClick={() => { if (window.confirm("このミーティングを削除しますか？\n削除すると元に戻せません。")) deleteMutation.mutate(); }}
              disabled={deleteMutation.isPending}
              className="w-full py-2.5 rounded-2xl text-sm font-medium flex items-center justify-center gap-1.5 transition disabled:opacity-50"
              style={{ background: "transparent", color: "var(--color-brand)", border: "1px solid rgba(181,56,75,0.3)" }}
            >
              <Trash2 size={14} />
              ミーティングを削除する
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
                  <div className="relative px-3 py-2" style={{ background: "var(--color-paper-50)" }}>
                    <input
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="名前で絞り込む"
                      autoFocus
                      className="w-full pr-7 text-sm outline-none bg-transparent"
                      style={{ color: "var(--color-ink-800)" }}
                    />
                    {memberSearch && (
                      <button type="button" onClick={() => setMemberSearch("")}
                        aria-label="検索条件をクリア"
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full"
                        style={{ color: "var(--color-ink-400)" }}>
                        <X size={14} />
                      </button>
                    )}
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

          {/* 外部ゲスト共有招待URL */}
          {sharedInviteUrl ? (
            <div className="space-y-2">
              <p className="text-xs font-medium" style={{ color: "var(--color-ink-600)" }}>
                🔗 {termExternalGuest}共有招待URL
              </p>
              <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
                このURLを複数人に共有できます。回答時に各自のゲストページが作成されます。
              </p>
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "var(--color-paper-200)" }}>
                <span className="flex-1 text-xs break-all" style={{ color: "var(--color-ink-600)" }}>{sharedInviteUrl}</span>
                <button
                  onClick={copySharedUrl}
                  className="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl font-medium transition"
                  style={{
                    background: copiedSharedUrl ? "rgba(90,140,92,0.15)" : "var(--color-brand)",
                    color: copiedSharedUrl ? "var(--color-success)" : "white",
                  }}
                >
                  {copiedSharedUrl ? <Check size={12} /> : <Copy size={12} />}
                  {copiedSharedUrl ? "コピー済" : "コピー"}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => sharedInviteMutation.mutate()}
              disabled={sharedInviteMutation.isPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium transition hover:opacity-80 disabled:opacity-50"
              style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}
            >
              {sharedInviteMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <LinkIcon size={14} />}
              {termExternalGuest}招待URLを取得する
            </button>
          )}

          {/* 外部招待者一覧（URLコピー＋削除ボタン付き） */}
          {externalInvitees.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>{termExternalGuest}</p>
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

      {/* 日程確定モーダル */}
      {editCandidateModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: "rgba(26,20,16,0.5)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditCandidateModal(null); }}
        >
          <div className="card-paper rounded-3xl w-full max-w-sm p-6 space-y-4">
            <p className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
              🗓️ 候補日を編集
            </p>
            <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
              日時を変更すると、この候補日への回答はリセットされ、参加者に再回答をお願いする通知が届きます。
            </p>
            <div className="grid grid-cols-3 gap-2">
              <input type="date" value={editCandidateModal.date} min={todayDateStr()}
                onChange={(e) => setEditCandidateModal({ ...editCandidateModal, date: e.target.value })}
                className="col-span-3 sm:col-span-1 px-3 py-2 rounded-xl text-sm outline-none border"
                style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
              <input type="time" value={editCandidateModal.time}
                onChange={(e) => setEditCandidateModal({ ...editCandidateModal, time: e.target.value })}
                className="col-span-3 sm:col-span-1 px-3 py-2 rounded-xl text-sm outline-none border"
                style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
              <input type="time" value={editCandidateModal.endTime}
                onChange={(e) => setEditCandidateModal({ ...editCandidateModal, endTime: e.target.value })}
                className="col-span-3 sm:col-span-1 px-3 py-2 rounded-xl text-sm outline-none border"
                style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }} />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setEditCandidateModal(null)}
                className="flex-1 py-2.5 rounded-2xl text-sm"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  if (!editCandidateModal.date) return;
                  editCandidateMutation.mutate({
                    candidateId: editCandidateModal.id,
                    startsAt: rowToUnixTimestamp(editCandidateModal.date, editCandidateModal.time),
                    endsAt: editCandidateModal.endTime ? rowToUnixTimestamp(editCandidateModal.date, editCandidateModal.endTime) : undefined,
                  });
                }}
                disabled={!editCandidateModal.date || editCandidateMutation.isPending}
                className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: "var(--color-brand)" }}
              >
                {editCandidateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                保存する
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: "rgba(26,20,16,0.5)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmModal(null); }}
        >
          <div className="card-paper rounded-3xl w-full max-w-sm p-6 space-y-4">
            <div>
              <p className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
                📅 日程を確定しますか？
              </p>
              <p className="text-sm mt-1 font-medium" style={{ color: "var(--color-success)" }}>
                {confirmModal.dateText}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
                関係者にメールとホーム画面で通知されます
              </p>
            </div>

            <div>
              <p className="text-xs font-medium mb-2" style={{ color: "var(--color-ink-600)" }}>
                📹 会議URLを同時に設定する（任意）
              </p>
              <div className="space-y-2">
                {availableConferenceTypes.includes("google_meet") && (
                  <button
                    onClick={() => setConfirmUrlType(confirmUrlType === "google_meet" ? null : "google_meet")}
                    className="w-full px-4 py-2.5 rounded-2xl text-sm font-medium transition flex items-center gap-2"
                    style={{
                      background: confirmUrlType === "google_meet" ? "rgba(90,140,92,0.15)" : "var(--color-paper-200)",
                      color: confirmUrlType === "google_meet" ? "var(--color-success)" : "var(--color-ink-700)",
                      border: confirmUrlType === "google_meet" ? "1.5px solid rgba(90,140,92,0.4)" : "1.5px solid transparent",
                    }}
                  >
                    <Video size={14} />
                    Google Meetを発行して確定
                    {confirmUrlType === "google_meet" && <Check size={14} className="ml-auto" />}
                  </button>
                )}
                {availableConferenceTypes.includes("zoom") && (
                  <button
                    onClick={() => setConfirmUrlType(confirmUrlType === "zoom" ? null : "zoom")}
                    className="w-full px-4 py-2.5 rounded-2xl text-sm font-medium transition flex items-center gap-2"
                    style={{
                      background: confirmUrlType === "zoom" ? "rgba(90,140,92,0.15)" : "var(--color-paper-200)",
                      color: confirmUrlType === "zoom" ? "var(--color-success)" : "var(--color-ink-700)",
                      border: confirmUrlType === "zoom" ? "1.5px solid rgba(90,140,92,0.4)" : "1.5px solid transparent",
                    }}
                  >
                    <Video size={14} />
                    Zoomを発行して確定
                    {confirmUrlType === "zoom" && <Check size={14} className="ml-auto" />}
                  </button>
                )}
                <button
                  onClick={() => setConfirmUrlType(confirmUrlType === "manual" ? null : "manual")}
                  className="w-full px-4 py-2.5 rounded-2xl text-sm font-medium transition flex items-center gap-2"
                  style={{
                    background: confirmUrlType === "manual" ? "rgba(90,140,92,0.15)" : "var(--color-paper-200)",
                    color: confirmUrlType === "manual" ? "var(--color-success)" : "var(--color-ink-700)",
                    border: confirmUrlType === "manual" ? "1.5px solid rgba(90,140,92,0.4)" : "1.5px solid transparent",
                  }}
                >
                  <ExternalLink size={14} />
                  URLを手動入力して確定
                  {confirmUrlType === "manual" && <Check size={14} className="ml-auto" />}
                </button>
                {confirmUrlType === "manual" && (
                  <input
                    type="url"
                    placeholder="https://..."
                    value={confirmManualUrl}
                    onChange={(e) => setConfirmManualUrl(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm border"
                    style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
                    autoFocus
                  />
                )}
              </div>
            </div>

            {confirmWithUrlMutation.isError && (
              <p className="text-xs" style={{ color: "var(--color-brand)" }}>
                エラーが発生しました。もう一度お試しください。
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setConfirmModal(null)}
                className="flex-1 py-2.5 rounded-2xl text-sm border"
                style={{ borderColor: "var(--color-paper-300)", color: "var(--color-ink-600)" }}
                disabled={confirmWithUrlMutation.isPending || confirmMutation.isPending}
              >
                キャンセル
              </button>
              {confirmUrlType ? (
                <button
                  onClick={() => {
                    if (confirmUrlType === "manual" && !confirmManualUrl.trim()) return;
                    confirmWithUrlMutation.mutate({
                      candidateId: confirmModal.candidateId,
                      urlType: confirmUrlType,
                      url: confirmUrlType === "manual" ? confirmManualUrl.trim() : undefined,
                    });
                  }}
                  disabled={confirmWithUrlMutation.isPending || (confirmUrlType === "manual" && !confirmManualUrl.trim())}
                  className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                  style={{ background: "var(--color-success)" }}
                >
                  {confirmWithUrlMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : "URLを設定して確定"}
                </button>
              ) : (
                <button
                  onClick={() => {
                    confirmMutation.mutate({ candidateId: confirmModal.candidateId, deferNotification: false });
                    setConfirmModal(null);
                  }}
                  disabled={confirmMutation.isPending}
                  className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50"
                  style={{ background: "var(--color-ink-600)" }}
                >
                  URLなしで確定
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 出席確認後：活動タイムラインへの投稿を促すプロンプト（パイロット限定） */}
      {postPromptPartner && (
        <ActivityPostPrompt
          title={`🎉 ${postPromptPartner.name}さんとのミーティング、お疲れさまでした！`}
          description="協働マップの活動タイムラインに、今日のミーティングについて残しませんか？"
          contextType="link"
          partnerId={postPromptPartner.id}
          suggestedBody={`${postPromptPartner.name}さんとミーティングをしました！`}
          onClose={() => setPostPromptPartner(null)}
        />
      )}
    </div>
  );
}
