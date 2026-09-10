// =============================================================
// ホーム画面
// =============================================================
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Loader2, Users, ScrollText, Trophy, QrCode, ChevronRight, ChevronDown, Calendar, X, Handshake, Sparkles, MessageSquarePlus, Lock } from "lucide-react";
import { api } from "@/lib/api";
import { MemberAvatar } from "@/components/member-avatar";
import { ActivityPostPrompt } from "@/components/activity-post-prompt";
import { AddContactFromBookingModal } from "@/components/add-contact-from-booking-modal";
import { InfoTooltip } from "@/components/info-tooltip";
import { useAuthStore, isApprovedMember } from "@/stores/auth-store";
import { useSettings } from "@/hooks/use-settings";
import { useTimezone } from "@/hooks/use-timezone";
import { fmtDateShort, fmtTime, isToday } from "@/lib/date";

import type { Season } from "@shared/types";

type MyRankResponse  = { data: { points: number; rank: number } };
type ActiveSeasonResponse = { data: Season | null };
type OnoSession = {
  id: string;
  status: string;
  myRole: string;
  requesterCompletedAt: number | null;
  responderCompletedAt: number | null;
  partner: { id: string; name: string; emoji: string; bgColor: string; category: string } | null;
};
type OnoListResponse  = { data: OnoSession[] };
type QuestsResponse   = { data: Array<{ id: string; title: string; emoji: string; reward: number; skillCount: number; isSolved: boolean; isThisWeek: boolean }> };
type UpcomingMeeting  = { id: string; title: string; host: { name: string; emoji: string } | null; isHost: boolean; confirmedDate: { startsAt: number; endsAt: number | null } | null };
type UpcomingMeetingsResponse = { data: UpcomingMeeting[] };
type MeetingListItem  = { id: string; title: string; host: { id: string; name: string; emoji: string } | null; isHost: boolean; status: string; hasResponded: boolean; registrationDeadline?: number | null };
type MeetingsResponse = { data: MeetingListItem[] };
type MeetingNotification = { id: string; meetingId: string; type: string; message: string | null; createdAt: number };
type MeetingNotificationsResponse = { data: MeetingNotification[] };
type MeetingSeriesListItem = {
  id: string; title: string; status: "voting" | "confirmed" | "ended" | "cancelled";
  isHost: boolean; hasResponded: boolean;
  host: { id: string; name: string; emoji: string } | null;
};
type PendingAttendance = { id: string; title: string; confirmedStartsAt: number };
type PendingAttendanceResponse = { data: PendingAttendance[] };
type UpcomingBooking = {
  id: string;
  startAtUtc: string;
  endAtUtc: string;
  conferenceType: string;
  conferenceUrl: string | null;
  cancellationToken: string;
  isHost: boolean;
  guestName: string;
  host: { id: string; name: string; emoji: string } | null;
  displayTitle: string | null;
  oneOnOneSessionId: string | null;
};
type UpcomingBookingsResponse = { data: UpcomingBooking[] };
type CollabReactionNotification = {
  id: string;
  reactionType: string;
  message: string;
  createdAt: number;
  reactor: { id: string; name: string; emoji: string; bgColor: string };
  post: { id: string; body: string | null; createdAt: number };
};
type CollabReactionNotificationsResponse = { data: CollabReactionNotification[] };
const REACTION_LABEL: Record<string, string> = { shokai: "🤝 紹介できそう", join: "🙋 私も参加したい" };
type IntroRequestNotif = {
  id: string;
  status: "pending" | "handled";
  message: string | null;
  createdAt: number;
  contactName: string;
  requester: { id: string; name: string; emoji: string; bgColor: string } | null;
};
type IntroRequestsResponse = { data: IntroRequestNotif[] };
type SummaryIssueContact = {
  id: string;
  name: string;
  company: string | null;
  businessSummaryStatus: "error" | "not_found";
};
type SummaryIssuesResponse = { data: SummaryIssueContact[] };
type PendingConfirmation = { partnerId: string; name: string; emoji: string; bgColor: string; completedAt: number | null; sessionIds: string[] };
type PendingConfirmationsResponse = { data: PendingConfirmation[] };
type GuestFollowup = { id: string; guestName: string; guestMessage: string | null; guestCompany: string | null; startAtUtc: string; endAtUtc: string };
type GuestFollowupsResponse = { data: GuestFollowup[] };

export function HomeScreen() {
  const user = useAuthStore((s) => s.user);
  const approved = isApprovedMember(user);
  const { termQuest, termUsp, appTitle, termExternalGuest, termEnishi, termBusinessCommunity } = useSettings();
  const tz = useTimezone();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [seasonExpanded, setSeasonExpanded] = useState(false);
  const [pointsExpanded, setPointsExpanded] = useState(false);
  const [openReactionNotif, setOpenReactionNotif] = useState<CollabReactionNotification | null>(null);
  const [commentTarget, setCommentTarget] = useState<PendingConfirmation | null>(null);
  const [addContactTarget, setAddContactTarget] = useState<GuestFollowup | null>(null);

  const dismissGuestFollowup = useMutation({
    mutationFn: ({ bookingId, outcome }: { bookingId: string; outcome: "not_held" | "no_add" }) =>
      api.patch(`/scheduler/bookings/${bookingId}/dismiss-followup`, { outcome }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduler", "bookings"] }),
  });

  // チェック状態はローカルに保持し、「保存」を押すまでは送信しない
  // （どちらか片方だけチェックした時点で送信してしまうと、確認カード自体が消えてしまい、
  // 「両方チェックしたい」「どちらもチェックしない」を選べなくなるため）
  const [confirmationDrafts, setConfirmationDrafts] = useState<Record<string, { possible: boolean; referral: boolean }>>({});
  function getConfirmationDraft(partnerId: string) {
    return confirmationDrafts[partnerId] ?? { possible: false, referral: false };
  }
  function setConfirmationDraft(partnerId: string, patch: Partial<{ possible: boolean; referral: boolean }>) {
    setConfirmationDrafts((prev) => ({ ...prev, [partnerId]: { ...getConfirmationDraft(partnerId), ...patch } }));
  }

  // 「保存」を押した瞬間に画面上は必ず消す（サーバーの応答・再取得のタイミングに関わらず）。
  // 可能性・リファーラルの保存に失敗しても、振り返り自体の記録（mark-reviewed）だけは
  // 最初に確実に行うことで、チェックの有無に関わらず保存すればメッセージが消えるようにする。
  const [locallyReviewedPartnerIds, setLocallyReviewedPartnerIds] = useState<Set<string>>(new Set());

  const saveConfirmation = useMutation({
    mutationFn: async (partnerId: string) => {
      const draft = getConfirmationDraft(partnerId);
      await api.post(`/collab/pending-confirmations/${partnerId}/mark-reviewed`);
      await Promise.allSettled([
        api.post("/collab/links/possible", { otherMemberId: partnerId, on: draft.possible }),
        api.post("/collab/links/referral", { otherMemberId: partnerId, on: draft.referral }),
      ]);
      return partnerId;
    },
    onMutate: (partnerId) => {
      setLocallyReviewedPartnerIds((prev) => new Set(prev).add(partnerId));
    },
    onSuccess: (partnerId) => {
      qc.invalidateQueries({ queryKey: ["collab", "pending-confirmations"] });
      setConfirmationDrafts((prev) => {
        const next = { ...prev };
        delete next[partnerId];
        return next;
      });
    },
    onError: (_err, partnerId) => {
      // mark-reviewed自体が失敗した場合のみ、消していた表示を元に戻す
      setLocallyReviewedPartnerIds((prev) => {
        const next = new Set(prev);
        next.delete(partnerId);
        return next;
      });
    },
  });

  function handleNotifClick(meetingId: string) {
    api.post(`/meetings/${meetingId}/read-notifications`, {})
      .then(() => qc.invalidateQueries({ queryKey: ["meetings", "notifications"] }))
      .catch(() => {});
    navigate(`/meetings/${meetingId}`);
  }

  const { data: rankData } = useQuery({
    queryKey: ["ranking", "me"],
    queryFn: () => api.get<MyRankResponse>("/ranking/me"),
    enabled: !!user,
  });

  const { data: onoData, isLoading: onoLoading } = useQuery({
    queryKey: ["oneonone"],
    queryFn: () => api.get<OnoListResponse>("/oneonone"),
    enabled: !!user,
    refetchInterval: 30_000, // 30秒ごとに自動更新
  });

  const { data: questData } = useQuery({
    queryKey: ["quests"],
    queryFn: () => api.get<QuestsResponse>("/quests"),
    enabled: !!user,
  });

  const { data: seasonData } = useQuery({
    queryKey: ["season"],
    queryFn: () => api.get<ActiveSeasonResponse>("/season"),
  });

  const { data: upcomingMeetingsData } = useQuery({
    queryKey: ["meetings", "upcoming"],
    queryFn: () => api.get<UpcomingMeetingsResponse>("/meetings/upcoming"),
    enabled: !!user,
  });

  const { data: meetingsData } = useQuery({
    queryKey: ["meetings"],
    queryFn: () => api.get<MeetingsResponse>("/meetings"),
    enabled: !!user,
    staleTime: 30_000,
  });

  const { data: meetingNotifsData } = useQuery({
    queryKey: ["meetings", "notifications"],
    queryFn: () => api.get<MeetingNotificationsResponse>("/meetings/notifications"),
    enabled: !!user,
    staleTime: 30_000,
  });

  const { data: pendingAttendanceData } = useQuery({
    queryKey: ["meetings", "pending-attendance"],
    queryFn: () => api.get<PendingAttendanceResponse>("/meetings/pending-attendance"),
    enabled: !!user,
    staleTime: 60_000,
  });

  const { data: meetingSeriesData } = useQuery({
    queryKey: ["meeting-series"],
    queryFn: () => api.get<{ data: MeetingSeriesListItem[] }>("/meeting-series"),
    enabled: !!user,
    staleTime: 30_000,
  });

  const { data: upcomingBookingsData } = useQuery({
    queryKey: ["scheduler", "bookings", "upcoming"],
    queryFn: () => api.get<UpcomingBookingsResponse>("/scheduler/bookings/upcoming"),
    enabled: !!user,
    staleTime: 60_000,
  });

  const { data: collabReactionNotifsData } = useQuery({
    queryKey: ["collab", "reaction-notifications"],
    queryFn: () => api.get<CollabReactionNotificationsResponse>("/collab/reaction-notifications"),
    enabled: !!user,
    staleTime: 30_000,
  });

  const { data: introRequestsData } = useQuery({
    queryKey: ["collab", "contacts", "intro-requests"],
    queryFn: () => api.get<IntroRequestsResponse>("/collab/contacts/intro-requests"),
    enabled: !!user && user.userType === "member",
    staleTime: 30_000,
  });

  const { data: summaryIssuesData } = useQuery({
    queryKey: ["collab", "contacts", "summary-issues"],
    queryFn: () => api.get<SummaryIssuesResponse>("/collab/contacts/summary-issues"),
    enabled: !!user && user.userType === "member",
    staleTime: 30_000,
  });

  const { data: pendingConfirmationsData } = useQuery({
    queryKey: ["collab", "pending-confirmations"],
    queryFn: () => api.get<PendingConfirmationsResponse>("/collab/pending-confirmations"),
    enabled: !!user && user.userType === "member",
    staleTime: 30_000,
  });

  const { data: guestFollowupsData } = useQuery({
    queryKey: ["scheduler", "bookings", "guest-followups"],
    queryFn: () => api.get<GuestFollowupsResponse>("/scheduler/bookings/guest-followups"),
    enabled: !!user && user.userType === "member",
    staleTime: 30_000,
  });

  // プロフィール補完バナー用：金の卵・金のガチョウ・外部人脈のいずれも未登録かどうかの判定に使う
  const { data: goldenEggsData } = useQuery({
    queryKey: ["enishi", "eggs"],
    queryFn: () => api.get<{ data: unknown[] }>("/enishi/eggs"),
    enabled: !!user && user.userType === "member",
    staleTime: 60_000,
  });
  const { data: goldenGeeseData } = useQuery({
    queryKey: ["enishi", "geese"],
    queryFn: () => api.get<{ data: unknown[] }>("/enishi/geese"),
    enabled: !!user && user.userType === "member",
    staleTime: 60_000,
  });
  const { data: externalContactsData } = useQuery({
    queryKey: ["collab", "contacts"],
    queryFn: () => api.get<{ data: unknown[] }>("/collab/contacts"),
    enabled: !!user && user.userType === "member",
    staleTime: 60_000,
  });

  function handleReactionNotifOpen(n: CollabReactionNotification) {
    setOpenReactionNotif(n);
    api.post(`/collab/reaction-notifications/${n.id}/read`)
      .then(() => qc.invalidateQueries({ queryKey: ["collab", "reaction-notifications"] }))
      .catch(() => {});
  }

  type HistoryItem = { id: string; delta: number; reason: string; label: string; detail?: string; createdAt: number };
  const { data: historyData } = useQuery({
    queryKey: ["ranking", "history"],
    queryFn: () => api.get<{ data: HistoryItem[]; totalPoints: number }>("/ranking/history"),
    enabled: !!user && pointsExpanded,
  });

  const rank                = rankData?.data;
  const sessions            = onoData?.data ?? [];
  const quests              = (questData?.data ?? []).filter((q) => q.isThisWeek && !q.isSolved).slice(0, 2);
  const activeSeason        = seasonData?.data ?? null;
  const upcomingMeetings    = upcomingMeetingsData?.data ?? [];
  const meetingNotifications = meetingNotifsData?.data ?? [];
  const pendingAttendances = pendingAttendanceData?.data ?? [];
  const upcomingBookings = upcomingBookingsData?.data ?? [];
  const collabReactionNotifs = collabReactionNotifsData?.data ?? [];
  const introRequests = (introRequestsData?.data ?? []).filter((r) => r.status === "pending");
  const summaryIssues = summaryIssuesData?.data ?? [];
  const pendingConfirmations = (pendingConfirmationsData?.data ?? [])
    .filter((p) => !locallyReviewedPartnerIds.has(p.partnerId));
  const guestFollowups = guestFollowupsData?.data ?? [];
  const nowSec = Math.floor(Date.now() / 1000);
  // 招待済みだが未回答のオープンミーティング（自分が主催者ではないもの）
  // registration_deadline が過ぎている場合は表示しない
  const pendingMeetings  = (meetingsData?.data ?? []).filter(
    (m) => m.status === "open" && !m.isHost && !m.hasResponded &&
      (!m.registrationDeadline || m.registrationDeadline > nowSec)
  );
  // 投票中で自分がまだ何も回答していない定例会
  const pendingMeetingSeries = (meetingSeriesData?.data ?? []).filter(
    (s) => s.status === "voting" && !s.isHost && !s.hasResponded
  );
  // 承諾待ちの申込（自分が受け手）
  const pendingApproval = sessions.filter((s) => s.status === "pending" && s.myRole === "responder");

  // 相手が完了済みなのに自分がまだ押していないセッション（緊急度あり）
  const waitingComplete = sessions.filter((s) => {
    if (s.status !== "accepted") return false;
    const myDone      = s.myRole === "requester" ? s.requesterCompletedAt : s.responderCompletedAt;
    const partnerDone = s.myRole === "requester" ? s.responderCompletedAt : s.requesterCompletedAt;
    return !myDone && !!partnerDone;
  });

  // プロフィール補完の入力促し（後から必須にした項目・登録が推奨される項目）。
  // 各項目は「未入力・未登録」の場合のみ表示し、ホーム画面の一番先頭に並べる。
  type ProfilePromptItem = { key: string; message: string; linkTo: string; restricted?: boolean };
  const profilePromptItems: ProfilePromptItem[] = [];
  if (user && !user.businessCommunityJoinedDate) {
    profilePromptItems.push({
      key: "join-date",
      message: `📅 ${termBusinessCommunity}入会日を入力してください（日にちは正確でなくてOKです）`,
      linkTo: "/me",
    });
  }
  if (goldenEggsData && goldenGeeseData && goldenEggsData.data.length === 0 && goldenGeeseData.data.length === 0) {
    profilePromptItems.push({
      key: "enishi",
      message: "🥚🪙 金の卵・金のガチョウを登録しましょう",
      linkTo: "/enishi/register",
      restricted: true,
    });
  }
  if (externalContactsData && externalContactsData.data.length === 0) {
    profilePromptItems.push({
      key: "contacts",
      message: "📇 外部人脈を登録しましょう",
      linkTo: "/members?tab=contacts",
      restricted: true,
    });
  }

  return (
    <div className="px-4 py-6 space-y-5 max-w-xl mx-auto lg:max-w-none pb-24">

      {/* 承認待ち（ゲスト）向けのご案内 */}
      {!approved && (
        <div className="px-4 py-3 rounded-2xl" style={{ background: "rgba(212,160,59,0.12)", border: "1px solid rgba(212,160,59,0.35)" }}>
          <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink-800)" }}>
            👋 {appTitle} ゲストユーザー
          </p>
          <p className="text-xs" style={{ color: "var(--color-ink-600)" }}>
            {user?.status === "guest"
              ? `現在はゲストユーザーとして、1to1の日程調整など一部の機能のみご利用いただけます。${appTitle}のメンバーとしての機能が必要な場合は、管理者にお問い合わせください。`
              : `${appTitle}のメンバーとなるには管理者による承認が必要です。承認されれば、すべての機能が利用できるようになります。今しばらくお待ちください。`}
          </p>
        </div>
      )}

      {/* プロフィール補完の入力促し */}
      {profilePromptItems.length > 0 && (
        <div className="space-y-2">
          {profilePromptItems.map((item) => {
            if (item.restricted && !approved) {
              return (
                <div key={item.key}
                  className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl opacity-50 cursor-not-allowed"
                  style={{ background: "rgba(212,160,59,0.12)", border: "1px solid rgba(212,160,59,0.35)" }}
                  title="承認されると利用できます"
                >
                  <p className="text-sm font-medium flex-1" style={{ color: "var(--color-ink-800)" }}>{item.message}</p>
                  <Lock size={14} style={{ color: "var(--color-ink-500)" }} />
                </div>
              );
            }
            return (
              <Link key={item.key} to={item.linkTo}
                className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl transition active:opacity-80"
                style={{ background: "rgba(212,160,59,0.12)", border: "1px solid rgba(212,160,59,0.35)" }}
              >
                <p className="text-sm font-medium flex-1" style={{ color: "var(--color-ink-800)" }}>{item.message}</p>
                <span className="flex items-center gap-0.5 text-xs font-medium shrink-0" style={{ color: "var(--color-brand)" }}>
                  入力する <ChevronRight size={14} />
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>おかえりなさい 👋</p>
          <h1 className="text-2xl font-semibold mt-0.5" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            {user?.name ?? "メンバー"}さん
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>{appTitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {user && (
            <MemberAvatar
              memberId={user.id}
              emoji={user.emoji ?? "🙂"}
              bgColor={user.bgColor ?? "bg-amber-100"}
              avatarImageKey={user.avatarImageKey}
              size="md"
              rounded="rounded-full"
            />
          )}
        </div>
      </div>

      {/* アクティブシーズン */}
      {activeSeason && (
        <button
          onClick={() => activeSeason.theme && setSeasonExpanded((v) => !v)}
          className="w-full text-left px-4 py-3 rounded-2xl transition active:opacity-80"
          style={{ background: "rgba(181,56,75,0.07)", border: "1px solid rgba(181,56,75,0.2)", cursor: activeSeason.theme ? "pointer" : "default" }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold mb-0.5" style={{ color: "var(--color-brand)" }}>🌸 現在のシーズン</p>
              <p className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>{activeSeason.name}</p>
            </div>
            {activeSeason.theme && (
              <ChevronDown
                size={16}
                className="shrink-0 transition-transform"
                style={{ color: "var(--color-brand)", transform: seasonExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
              />
            )}
          </div>
          {seasonExpanded && activeSeason.theme && (
            <p className="text-sm mt-2 leading-relaxed" style={{ color: "var(--color-ink-700)" }}>{activeSeason.theme}</p>
          )}
        </button>
      )}

      {/* 1to1 要対応バナー（承諾待ち：赤バナーのみ・名前全員表示） */}
      {pendingApproval.length > 0 && (
        <Link
          to="/oneonone"
          className="flex items-start gap-3 px-4 py-3 rounded-2xl transition active:opacity-80"
          style={{ background: "var(--color-brand)", color: "white" }}
        >
          <span className="text-xl mt-0.5">🤝</span>
          <div className="flex-1">
            <p className="font-semibold text-sm">
              {pendingApproval.length}件の1to1申込が届いています
            </p>
            <p className="text-xs opacity-90 mt-1 leading-relaxed">
              {pendingApproval.map((s) => `${s.partner?.emoji ?? ""} ${s.partner?.name ?? "？"}さん`).join("、")}からの申込
            </p>
            <p className="text-xs opacity-70 mt-0.5">タップして確認する</p>
          </div>
          <ChevronRight size={18} className="mt-0.5 shrink-0" />
        </Link>
      )}

      {/* 進行中の1to1（ローディング中） */}
      {onoLoading && (
        <div className="flex justify-center py-4">
          <Loader2 size={20} className="animate-spin" style={{ color: "var(--color-brand)" }} />
        </div>
      )}

      {/* 完了待ちセッション */}
      {waitingComplete.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-success)" }}>
            🤝 1to1 完了を記録しよう
          </h2>
          <div className="space-y-2">
            {waitingComplete.map((s) => (
              <Link
                key={s.id}
                to="/oneonone"
                className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80"
                style={{ borderLeft: "3px solid var(--color-success)" }}
              >
                {s.partner && (
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${s.partner.bgColor}`}>
                    {s.partner.emoji}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "var(--color-ink-800)" }}>
                    {s.partner?.name ?? "？"}さん との1to1
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>完了ボタンを押すと +1pt</p>
                </div>
                <ChevronRight size={16} style={{ color: "var(--color-success)" }} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 出席確認が必要なミーティング */}
      {pendingAttendances.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-accent)" }}>
            📋 出席確認をしてください
          </h2>
          <div className="space-y-2">
            {pendingAttendances.map((m) => {
              const dateStr = fmtDateShort(m.confirmedStartsAt, tz);
              return (
                <Link
                  key={m.id}
                  to={`/meetings/${m.id}`}
                  className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80"
                  style={{ borderLeft: "3px solid var(--color-accent)" }}
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                    style={{ background: "rgba(212,160,59,0.15)" }}>
                    📋
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--color-ink-800)" }}>{m.title}</p>
                    <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>{dateStr} 開催 · 出席状況を記録してください</p>
                  </div>
                  <ChevronRight size={16} style={{ color: "var(--color-accent)" }} />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ミーティング確定・詳細更新通知 */}
      {meetingNotifications.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold" style={{ fontFamily: "var(--font-klee)", color: "#6B7DB3" }}>
              🔔 ミーティングのお知らせ
            </h2>
            <Link to="/notifications" className="text-xs" style={{ color: "#6B7DB3" }}>
              過去のお知らせ →
            </Link>
          </div>
          <div className="space-y-2">
            {meetingNotifications.slice(0, 3).map((n) => (
              <button
                key={n.id}
                onClick={() => handleNotifClick(n.meetingId)}
                className="w-full card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80 text-left"
                style={{ borderLeft: "3px solid #6B7DB3" }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                  style={{ background: "rgba(107,125,179,0.12)" }}>
                  {n.type === "conference_url_set" ? "📹" : n.type === "confirmed" ? "✅" : n.type === "invited" ? "📨" : n.type === "candidates_added" ? "🗓️" : n.type === "candidate_removed" ? "🗑️" : n.type === "candidate_updated" ? "🗓️" : n.type === "declined" ? "🙇" : n.type === "reminder" ? "⏰" : n.type === "unavailable_contact" ? "💬" : "📝"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>
                    {n.message ?? (n.type === "conference_url_set" ? "会議URLが届きました" : n.type === "confirmed" ? "ミーティングの日程が確定しました" : n.type === "invited" ? "ミーティングに招待されました" : n.type === "candidates_added" ? "新しい候補日が追加されました" : n.type === "candidate_removed" ? "候補日が削除されました" : n.type === "candidate_updated" ? "候補日が変更されました" : n.type === "declined" ? "辞退の連絡がありました" : n.type === "reminder" ? "まだご回答いただいていません" : n.type === "unavailable_contact" ? "都合が悪い旨のご連絡がありました" : "ミーティングに詳細が追加されました")}
                  </p>
                </div>
                <ChevronRight size={16} style={{ color: "#6B7DB3" }} />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 協働: リアクションメッセージ通知（紹介できそう／私も参加したい） */}
      {collabReactionNotifs.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
            🤝 協働へのリアクションが届いています
          </h2>
          <div className="space-y-2">
            {collabReactionNotifs.map((n) => (
              <button key={n.id} onClick={() => handleReactionNotifOpen(n)}
                className="w-full card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80 text-left"
                style={{ borderLeft: "3px solid var(--color-brand)" }}>
                <span className={`w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0 ${n.reactor.bgColor}`}>
                  {n.reactor.emoji}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>
                    {n.reactor.name}さんから「{REACTION_LABEL[n.reactionType] ?? n.reactionType}」
                  </p>
                  <p className="text-xs truncate" style={{ color: "var(--color-ink-500)" }}>{n.message}</p>
                </div>
                <ChevronRight size={16} style={{ color: "var(--color-brand)" }} />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 協働: 外部人脈への紹介依頼 */}
      {introRequests.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
            🔔 紹介依頼が届いています
          </h2>
          <div className="space-y-2">
            {introRequests.map((r) => (
              <Link key={r.id} to="/members?tab=contacts"
                className="w-full card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80 text-left"
                style={{ borderLeft: "3px solid var(--color-brand)" }}>
                <span className={`w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0 ${r.requester?.bgColor ?? "bg-stone-200"}`}>
                  {r.requester?.emoji ?? "❔"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>
                    {r.requester?.name ?? "メンバー"}さんから「{r.contactName}」さんへの紹介依頼
                  </p>
                  {r.message && <p className="text-xs truncate" style={{ color: "var(--color-ink-500)" }}>{r.message}</p>}
                </div>
                <ChevronRight size={16} style={{ color: "var(--color-brand)" }} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 会社概要の自動生成が「該当なし」「エラー」になった人脈の修正案内 */}
      {summaryIssues.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "#B36B2A" }}>
            ⚠️ 人脈の会社概要を確認してください
          </h2>
          <div className="space-y-2">
            <Link to="/members?tab=contacts&summaryIssues=1"
              className="w-full card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80 text-left"
              style={{ borderLeft: "3px solid #B36B2A" }}>
              <span className="w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0 bg-amber-100">
                🔍
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>
                  {summaryIssues.length}件の人脈で会社概要を生成できませんでした
                </p>
                <p className="text-xs truncate" style={{ color: "var(--color-ink-500)" }}>
                  {summaryIssues.slice(0, 3).map((s) => s.name).join("、")}
                  {summaryIssues.length > 3 ? " など" : ""}
                  ／会社名の表記を見直して再生成してみてください
                </p>
              </div>
              <ChevronRight size={16} style={{ color: "#B36B2A" }} />
            </Link>
          </div>
        </section>
      )}

      {/* 1to1完了後の振り返り（協業の可能性・リファーラル・コメント）未記録の相手 */}
      {pendingConfirmations.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
            🔔 1to1の振り返りをお願いします
          </h2>
          <div className="space-y-2">
            {pendingConfirmations.map((p) => {
              const draft = getConfirmationDraft(p.partnerId);
              const isSaving = saveConfirmation.isPending && saveConfirmation.variables === p.partnerId;
              return (
                <div key={p.partnerId} className="card-paper rounded-2xl px-4 py-3"
                  style={{ borderLeft: "3px solid var(--color-brand)" }}>
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0 ${p.bgColor}`}>
                      {p.emoji}
                    </span>
                    <p className="text-sm font-medium flex-1 min-w-0 truncate" style={{ color: "var(--color-ink-800)" }}>
                      {p.name}さんとの1to1、いかがでしたか？
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "var(--color-ink-600)" }}>
                      <input type="checkbox"
                        checked={draft.possible}
                        onChange={(e) => setConfirmationDraft(p.partnerId, { possible: e.target.checked })}
                        disabled={isSaving} />
                      🌱 協業・協働の可能性がありそう
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "var(--color-ink-600)" }}>
                      <input type="checkbox"
                        checked={draft.referral}
                        onChange={(e) => setConfirmationDraft(p.partnerId, { referral: e.target.checked })}
                        disabled={isSaving} />
                      🤝 リファーラルを提供できそう
                    </label>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={() => setCommentTarget(p)}
                      className="flex items-center gap-1 text-xs font-medium"
                      style={{ color: "var(--color-brand)" }}>
                      <MessageSquarePlus size={14} />
                      コメントを書く
                    </button>
                    <button onClick={() => saveConfirmation.mutate(p.partnerId)}
                      disabled={isSaving}
                      className="text-xs font-medium px-4 py-1.5 rounded-full text-white disabled:opacity-50"
                      style={{ background: "var(--color-brand)" }}>
                      {isSaving ? "保存中…" : "保存"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 外部ゲストとの1to1（公開予約URL経由）が終わったら、人脈への追加を促す */}
      {guestFollowups.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
            🌐 {termExternalGuest}との1to1、人脈に追加しませんか？
          </h2>
          <div className="space-y-2">
            {guestFollowups.map((g) => {
              const dateStr = new Intl.DateTimeFormat("ja-JP", {
                timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "short",
              }).format(new Date(g.startAtUtc));
              return (
                <div key={g.id} className="card-paper rounded-2xl px-4 py-3"
                  style={{ borderLeft: "3px solid var(--color-brand)" }}>
                  <p className="text-sm font-medium mb-0.5" style={{ color: "var(--color-ink-800)" }}>
                    {g.guestName}さん（{dateStr}）
                  </p>
                  <p className="text-xs mb-2" style={{ color: "var(--color-ink-500)" }}>
                    公開予約URLで実施した1to1です。よろしければ外部人脈に追加しましょう
                  </p>
                  <div className="space-y-1.5">
                    <button onClick={() => setAddContactTarget(g)}
                      className="w-full py-2 rounded-2xl text-xs font-medium text-white"
                      style={{ background: "var(--color-brand)" }}>
                      完了・人脈に追加する
                    </button>
                    <div className="flex gap-2">
                      <button onClick={() => dismissGuestFollowup.mutate({ bookingId: g.id, outcome: "not_held" })}
                        disabled={dismissGuestFollowup.isPending}
                        className="flex-1 py-2 rounded-2xl text-xs font-medium disabled:opacity-50"
                        style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                        実施せず
                      </button>
                      <button onClick={() => dismissGuestFollowup.mutate({ bookingId: g.id, outcome: "no_add" })}
                        disabled={dismissGuestFollowup.isPending}
                        className="flex-1 py-2 rounded-2xl text-xs font-medium disabled:opacity-50"
                        style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                        完了・今回は追加しない
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ミーティング招待通知（未回答） */}
      {pendingMeetings.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "#6B7DB3" }}>
            📅 日程回答が届いています
          </h2>
          <div className="space-y-2">
            {pendingMeetings.map((m) => (
              <Link
                key={m.id}
                to={`/meetings/${m.id}`}
                className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80"
                style={{ borderLeft: "3px solid #6B7DB3" }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                  style={{ background: "rgba(107,125,179,0.12)" }}>
                  📅
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "var(--color-ink-800)" }}>
                    {m.title}
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
                    {m.host?.emoji} {m.host?.name}さんから日程調整の招待が届いています
                  </p>
                </div>
                <ChevronRight size={16} style={{ color: "#6B7DB3" }} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 定例会の候補投票（未回答） */}
      {pendingMeetingSeries.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "#6B7DB3" }}>
            🔁 定例会の候補に投票してください
          </h2>
          <div className="space-y-2">
            {pendingMeetingSeries.map((s) => (
              <Link
                key={s.id}
                to={`/meetings/series/${s.id}`}
                className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80"
                style={{ borderLeft: "3px solid #6B7DB3" }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                  style={{ background: "rgba(107,125,179,0.12)" }}>
                  🔁
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "var(--color-ink-800)" }}>
                    {s.title}
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
                    {s.host?.emoji} {s.host?.name}さんから定例会の候補投票が届いています
                  </p>
                </div>
                <ChevronRight size={16} style={{ color: "#6B7DB3" }} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 近日ミーティング */}
      {upcomingMeetings.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
              📅 近日のミーティング
            </h2>
            <Link to="/meetings" className="text-xs" style={{ color: "var(--color-brand)" }}>
              すべて見る →
            </Link>
          </div>
          <div className="space-y-2">
            {upcomingMeetings.slice(0, 3).map((m) => {
              const todayFlag = m.confirmedDate ? isToday(m.confirmedDate.startsAt, tz) : false;
              const dateStr = m.confirmedDate
                ? `${fmtDateShort(m.confirmedDate.startsAt, tz)} ${fmtTime(m.confirmedDate.startsAt, tz)}`
                : "";
              return (
                <Link key={m.id} to={`/meetings/${m.id}`}
                  className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80"
                  style={todayFlag ? { borderLeft: "3px solid var(--color-accent)" } : {}}>
                  <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                    style={{ background: todayFlag ? "rgba(212,160,59,0.15)" : "var(--color-paper-200)" }}>
                    {todayFlag ? "🔔" : "📅"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{m.title}</p>
                    <p className="text-xs" style={{ color: todayFlag ? "var(--color-accent)" : "var(--color-ink-400)" }}>
                      {todayFlag ? "🔔 本日！" : ""}{dateStr}
                    </p>
                  </div>
                  <ChevronRight size={16} style={{ color: "var(--color-ink-300)" }} />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* 直近の1to1スケジュール予約 */}
      {upcomingBookings.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
              🤝 直近の1to1予約
            </h2>
            <Link to="/scheduler/bookings" className="text-xs" style={{ color: "var(--color-brand)" }}>
              すべて見る →
            </Link>
          </div>
          <div className="space-y-2">
            {upcomingBookings.slice(0, 3).map((b) => {
              const startDate = new Date(b.startAtUtc);
              const endDate = new Date(b.endAtUtc);
              const todayFlag = isToday(Math.floor(startDate.getTime() / 1000), tz);
              const dateStr = new Intl.DateTimeFormat("ja-JP", {
                timeZone: "Asia/Tokyo",
                month: "long", day: "numeric", weekday: "short",
                hour: "2-digit", minute: "2-digit",
              }).format(startDate);
              const endTimeStr = new Intl.DateTimeFormat("ja-JP", {
                timeZone: "Asia/Tokyo",
                hour: "2-digit", minute: "2-digit",
              }).format(endDate);
              const partnerName = b.isHost ? b.guestName : (b.host?.name ?? "相手");
              const partnerEmoji = b.isHost ? "👤" : (b.host?.emoji ?? "👤");
              // 1to1に紐づく予約なら、会議URLだけでなく完了記録・キャンセルまでその場で行える詳細画面へ。
              // 自分が主催者（外部ゲストを招いた側）の予約は、ゲスト向け確認ページではなく
              // 完了報告・外部人脈登録までできる自分用の予約詳細画面へ遷移させる。
              const linkTo = b.oneOnOneSessionId
                ? `/oneonone/${b.oneOnOneSessionId}`
                : b.isHost
                  ? `/scheduler/bookings/${b.id}`
                  : `/book/confirmation/${b.cancellationToken}`;
              return (
                <Link
                  key={b.id}
                  to={linkTo}
                  className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80"
                  style={todayFlag ? { borderLeft: "3px solid var(--color-accent)" } : { borderLeft: "3px solid var(--color-success)" }}
                >
                  <div
                    className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                    style={{ background: todayFlag ? "rgba(212,160,59,0.15)" : "rgba(90,140,92,0.12)" }}
                  >
                    {todayFlag ? "🔔" : partnerEmoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--color-ink-800)" }}>
                      {partnerName}さんとの1to1
                    </p>
                    <p className="text-xs" style={{ color: todayFlag ? "var(--color-accent)" : "var(--color-ink-400)" }}>
                      {todayFlag ? "🔔 本日！" : ""}{dateStr}〜{endTimeStr}
                    </p>
                  </div>
                  <ChevronRight size={16} style={{ color: "var(--color-success)" }} />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ポイント */}
      {!approved ? (
        <div className="card-paper rounded-3xl p-5 opacity-50">
          <div className="flex items-center gap-2">
            <span className="text-xl">⭐️</span>
            <span className="text-sm font-medium" style={{ color: "var(--color-ink-600)" }}>現在のポイント</span>
            <Lock size={14} className="ml-auto" style={{ color: "var(--color-ink-400)" }} />
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--color-ink-500)" }}>承認されると表示されます</p>
        </div>
      ) : (
      <button
        onClick={() => setPointsExpanded((v) => !v)}
        className="w-full text-left card-paper rounded-3xl p-5 transition active:opacity-80"
      >
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-xl">⭐️</span>
            <span className="text-sm font-medium" style={{ color: "var(--color-ink-600)" }}>現在のポイント</span>
          </div>
          <ChevronDown
            size={16}
            className="transition-transform"
            style={{ color: "var(--color-ink-400)", transform: pointsExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
          />
        </div>
        {rank ? (
          <div className="flex items-end gap-3">
            <div className="text-5xl font-bold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-accent)" }}>
              {rank.points}<span className="text-xl ml-1">pt</span>
            </div>
            <p className="text-sm mb-1" style={{ color: "var(--color-ink-500)" }}>
              現在 <span className="font-bold" style={{ color: "var(--color-ink-800)" }}>{rank.rank}</span> 位
            </p>
          </div>
        ) : (
          <div className="text-5xl font-bold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-accent)" }}>
            0<span className="text-xl ml-1">pt</span>
          </div>
        )}
        <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
          1to1完了・リアルカード交換・{termQuest}クリアで増やそう！
        </p>
        {pointsExpanded && (
          <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--color-paper-300)" }}>
            <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-ink-600)" }}>獲得履歴（直近）</p>
            {!historyData ? (
              <div className="flex justify-center py-3">
                <Loader2 size={18} className="animate-spin" style={{ color: "var(--color-brand)" }} />
              </div>
            ) : historyData.data.length === 0 ? (
              <p className="text-xs text-center py-2" style={{ color: "var(--color-ink-400)" }}>まだポイント履歴がありません</p>
            ) : (
              <div className="space-y-2">
                {historyData.data.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium leading-snug" style={{ color: "var(--color-ink-700)" }}>{item.label}</p>
                      {item.detail && (
                        <p className="text-xs leading-snug" style={{ color: "var(--color-ink-500)" }}>{item.detail}</p>
                      )}
                      <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>
                        {new Date(item.createdAt * 1000).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
                        {" "}
                        {new Date(item.createdAt * 1000).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <span
                      className="text-sm font-bold shrink-0"
                      style={{ color: item.delta >= 0 ? "var(--color-accent)" : "var(--color-brand)" }}
                    >
                      {item.delta >= 0 ? "+" : ""}{item.delta}pt
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </button>
      )}

      {/* 公開中のお題（承認済みメンバーのみ） */}
      {approved && quests.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
              📜 挑戦できる{termQuest}
            </h2>
            <Link to="/quests" className="text-xs" style={{ color: "var(--color-brand)" }}>
              すべて見る →
            </Link>
          </div>
          <div className="space-y-2">
            {quests.map((q) => (
              <Link key={q.id} to="/quests"
                className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80">
                <span className="text-2xl">{q.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{q.title}</p>
                  <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>{termUsp}{q.skillCount}個 · +{q.reward}pt</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* クイックアクション */}
      <section>
        <h2 className="text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
          🎮 やること
        </h2>
        <div className="grid grid-cols-1 gap-2">
          <QuickLink to="/members"  icon={<Users size={18} />}      label="なかまを探して1to1しよう" sub="+1pt"  color="var(--color-brand)"
            description="気になるメンバーを探して1to1を申し込みましょう" disabled={!approved} />
          <QuickLink to="/collab"   icon={<Handshake size={18} />}  label="協働の様子を確認しよう"    sub=""       color="var(--color-success)"
            description="パワーチームや協働マップの最新状況をチェックできます" disabled={!approved} />
          <QuickLink to="/enishi"   icon={<Sparkles size={18} />}   label={`${termEnishi}をさがそう`}  sub=""       color="var(--color-accent)"
            description={`AIがあなたの人脈から、新しい${termEnishi}の候補を見つけます`} disabled={!approved} />
          <QuickLink to="/quests"   icon={<ScrollText size={18} />} label={`${termQuest}に挑戦しよう`} sub="+5pt〜" color="var(--color-success)"
            description={`${termUsp}を組み合わせて${termQuest}を解き、ポイントを獲得しましょう`} disabled={!approved} />
          <QuickLink to="/team"     icon={<span className="text-base">🦊</span>} label="ギルドの活動を確認しよう" sub="" color="var(--color-accent)"
            description="所属ギルド（チーム）の最近の動きを確認できます" disabled={!approved} />
          <QuickLink to="/ranking"  icon={<Trophy size={18} />}     label="ランキングをチェック"      sub=""       color="var(--color-accent)"
            description="チャプター内でのあなたの順位を確認できます" disabled={!approved} />
          <QuickLink to="/meetings" icon={<Calendar size={18} />}   label="ミーティングの日程調整"    sub=""       color="#6B7DB3"
            description="1to1やミーティングの申し込み・日程調整はこちらから" />
          <QuickLink to="/me"       icon={<QrCode size={18} />}     label="自分のQRを表示してカードを渡す" sub="🃏"  color="var(--color-ink-500)"
            description="マイページでQRコードを表示し、リアルカードを受け渡せます" />
        </div>
      </section>

      {openReactionNotif && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setOpenReactionNotif(null)}>
          <div className="card-paper p-5 w-full max-w-sm rounded-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
                🤝 協働へのリアクション
              </h2>
              <button onClick={() => setOpenReactionNotif(null)}><X size={18} style={{ color: "var(--color-ink-400)" }} /></button>
            </div>

            <div className="flex items-center gap-2 mb-3">
              <span className={`w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0 ${openReactionNotif.reactor.bgColor}`}>
                {openReactionNotif.reactor.emoji}
              </span>
              <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>
                {openReactionNotif.reactor.name}さんが「{REACTION_LABEL[openReactionNotif.reactionType] ?? openReactionNotif.reactionType}」
              </p>
            </div>

            <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-500)" }}>投稿内容</p>
            <p className="text-sm mb-3 whitespace-pre-wrap p-3 rounded-xl" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-800)" }}>
              {openReactionNotif.post.body ?? "（内容は非公開です）"}
            </p>

            <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-500)" }}>
              {openReactionNotif.reactor.name}さんからのメッセージ
            </p>
            <p className="text-sm whitespace-pre-wrap p-3 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-ink-800)" }}>
              {openReactionNotif.message}
            </p>
          </div>
        </div>
      )}

      {commentTarget && (
        <ActivityPostPrompt
          title="1to1のコメントを書く"
          description={`${commentTarget.name}さんとの1to1について、感じたことを記録しておきましょう`}
          contextType="link"
          partnerId={commentTarget.partnerId}
          suggestedBody=""
          onClose={() => setCommentTarget(null)}
        />
      )}

      {addContactTarget && (
        <AddContactFromBookingModal
          bookingId={addContactTarget.id}
          guestName={addContactTarget.guestName}
          guestCompany={addContactTarget.guestCompany}
          onClose={() => setAddContactTarget(null)}
        />
      )}
    </div>
  );
}

function QuickLink({ to, icon, label, sub, color, description, disabled }: { to: string; icon: React.ReactNode; label: string; sub: string; color: string; description: string; disabled?: boolean }) {
  if (disabled) {
    return (
      <div
        className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 cursor-not-allowed"
        style={{ opacity: 0.5 }}
        title="承認されると利用できます">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: color + "20", color }}>
          {icon}
        </div>
        <span className="flex-1 min-w-0 text-sm font-medium truncate" style={{ color: "var(--color-ink-700)" }}>
          {label}
        </span>
        <Lock size={14} style={{ color: "var(--color-ink-400)" }} />
      </div>
    );
  }
  return (
    <Link to={to}
      className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80 active:scale-[0.98]">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: color + "20", color }}>
        {icon}
      </div>
      <span className="flex-1 min-w-0 text-sm font-medium flex items-center gap-1" style={{ color: "var(--color-ink-700)" }}>
        <span className="truncate">{label}</span>
        <InfoTooltip text={description} placement="below" />
      </span>
      {sub && <span className="text-xs font-bold shrink-0" style={{ color: "var(--color-accent)" }}>{sub}</span>}
    </Link>
  );
}
