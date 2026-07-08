// =============================================================
// ホーム画面
// =============================================================
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Users, ScrollText, Trophy, QrCode, ChevronRight, ChevronDown, Calendar } from "lucide-react";
import { api } from "@/lib/api";
import { MemberAvatar } from "@/components/member-avatar";
import { useAuthStore } from "@/stores/auth-store";
import { useSettings } from "@/hooks/use-settings";
import { useTimezone } from "@/hooks/use-timezone";
import { fmtDateShort, fmtTime, isToday } from "@/lib/date";

import type { Season, EventCampaign } from "@shared/types";

type MyRankResponse  = { data: { points: number; rank: number } };
type ActiveSeasonResponse = { data: Season | null };
type ActiveEvent = EventCampaign & {
  relatedMemberName?: string | null;
  relatedMemberEmoji?: string | null;
  relatedMembers?: { id: string; name: string; emoji: string }[];
  createdByMemberId?: string | null;
  typeEmoji?: string | null;
  typeName?: string | null;
  linksToMeeting?: number;
  triggerType?: string | null;
  pointAwardTiming?: string | null;
};
type ActiveEventsResponse = { data: ActiveEvent[] };
type OnoSession = {
  id: string;
  status: string;
  myRole: string;
  requesterCompletedAt: number | null;
  responderCompletedAt: number | null;
  partner: { id: string; name: string; emoji: string; bgColor: string; category: string } | null;
};
type OnoListResponse  = { data: OnoSession[] };
type QuestsResponse   = { data: Array<{ id: string; title: string; emoji: string; reward: number; skillCount: number; isSolved: boolean }> };
type UpcomingMeeting  = { id: string; title: string; host: { name: string; emoji: string } | null; isHost: boolean; confirmedDate: { startsAt: number; endsAt: number | null } | null };
type UpcomingMeetingsResponse = { data: UpcomingMeeting[] };
type MeetingListItem  = { id: string; title: string; host: { id: string; name: string; emoji: string } | null; isHost: boolean; status: string; hasResponded: boolean; registrationDeadline?: number | null };
type MeetingsResponse = { data: MeetingListItem[] };
type MeetingNotification = { id: string; meetingId: string; type: string; message: string | null; createdAt: number };
type MeetingNotificationsResponse = { data: MeetingNotification[] };
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
};
type UpcomingBookingsResponse = { data: UpcomingBooking[] };

export function HomeScreen() {
  const user = useAuthStore((s) => s.user);
  const { termQuest, termUsp, appTitle } = useSettings();
  const tz = useTimezone();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [seasonExpanded, setSeasonExpanded] = useState(false);
  const [pointsExpanded, setPointsExpanded] = useState(false);

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

  const { data: eventsData } = useQuery({
    queryKey: ["events", "active"],
    queryFn: () => api.get<ActiveEventsResponse>("/events/active"),
    enabled: !!user,
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

  const { data: upcomingBookingsData } = useQuery({
    queryKey: ["scheduler", "bookings", "upcoming"],
    queryFn: () => api.get<UpcomingBookingsResponse>("/scheduler/bookings/upcoming"),
    enabled: !!user,
    staleTime: 60_000,
  });

  type HistoryItem = { id: string; delta: number; reason: string; label: string; detail?: string; createdAt: number };
  const { data: historyData } = useQuery({
    queryKey: ["ranking", "history"],
    queryFn: () => api.get<{ data: HistoryItem[]; totalPoints: number }>("/ranking/history"),
    enabled: !!user && pointsExpanded,
  });

  const rank                = rankData?.data;
  const sessions            = onoData?.data ?? [];
  const quests              = (questData?.data ?? []).filter((q) => !q.isSolved).slice(0, 2);
  const activeSeason        = seasonData?.data ?? null;
  const upcomingMeetings    = upcomingMeetingsData?.data ?? [];
  const meetingNotifications = meetingNotifsData?.data ?? [];
  const pendingAttendances = pendingAttendanceData?.data ?? [];
  const upcomingBookings = upcomingBookingsData?.data ?? [];
  const nowSec = Math.floor(Date.now() / 1000);
  // 招待済みだが未回答のオープンミーティング（自分が主催者ではないもの）
  // registration_deadline が過ぎている場合は表示しない
  const pendingMeetings  = (meetingsData?.data ?? []).filter(
    (m) => m.status === "open" && !m.isHost && !m.hasResponded &&
      (!m.registrationDeadline || m.registrationDeadline > nowSec)
  );
  // ミーティング連携イベントはホーム画面に表示しない
  const activeEvents = (eventsData?.data ?? []).filter((ev) => ev.linksToMeeting !== 1);

  // 承諾待ちの申込（自分が受け手）
  const pendingApproval = sessions.filter((s) => s.status === "pending" && s.myRole === "responder");

  // 相手が完了済みなのに自分がまだ押していないセッション（緊急度あり）
  const waitingComplete = sessions.filter((s) => {
    if (s.status !== "accepted") return false;
    const myDone      = s.myRole === "requester" ? s.requesterCompletedAt : s.responderCompletedAt;
    const partnerDone = s.myRole === "requester" ? s.responderCompletedAt : s.requesterCompletedAt;
    return !myDone && !!partnerDone;
  });

  return (
    <div className="px-4 py-6 space-y-5 max-w-xl mx-auto lg:max-w-none pb-24">

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

      {/* 開催中のイベント */}
      {activeEvents.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
              📣 開催中のイベント
            </h2>
            <Link to="/events" className="text-xs" style={{ color: "var(--color-brand)" }}>
              すべて見る →
            </Link>
          </div>
          <div className="px-4 py-3 rounded-2xl space-y-3"
            style={{ background: "rgba(181,56,75,0.07)", border: "1px solid rgba(181,56,75,0.2)" }}>
            {activeEvents.map((ev) => {
              if (ev.type === "welcome_quest") {
                const evMembers = ev.relatedMembers && ev.relatedMembers.length > 0
                  ? ev.relatedMembers
                  : ev.relatedMemberId
                    ? [{ id: ev.relatedMemberId, name: ev.relatedMemberName ?? ev.title, emoji: ev.relatedMemberEmoji ?? "" }]
                    : [];
                return (
                  <div key={ev.id}>
                    <Link to={`/events/${ev.id}`} className="text-xs font-semibold mb-0.5 inline-block underline underline-offset-2" style={{ color: "var(--color-brand)" }}>
                      🎉 新メンバー歓迎クエスト
                    </Link>
                    <div className="flex items-center gap-1 flex-wrap">
                      {evMembers.length > 0 ? (
                        <>
                          {evMembers.map((m, idx) => (
                            <span key={m.id}>
                              <Link to={`/members/${m.id}`} className="text-sm font-semibold underline underline-offset-2" style={{ color: "var(--color-brand)" }}>
                                {m.emoji} {m.name}
                              </Link>
                              {idx < evMembers.length - 1 && <span className="text-sm" style={{ color: "var(--color-ink-500)" }}>、</span>}
                            </span>
                          ))}
                          <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>さんが仲間入り！</span>
                        </>
                      ) : (
                        <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>{ev.title}</span>
                      )}
                    </div>
                  </div>
                );
              }
              const evMembers = ev.relatedMembers && ev.relatedMembers.length > 0
                ? ev.relatedMembers
                : ev.relatedMemberId
                  ? [{ id: ev.relatedMemberId, name: ev.relatedMemberName ?? "", emoji: ev.relatedMemberEmoji ?? "" }]
                  : [];
              return (
                <div key={ev.id} className="flex items-start gap-2">
                  <span className="text-lg shrink-0 mt-0.5">{ev.typeEmoji ?? "📣"}</span>
                  <div className="flex-1 min-w-0">
                    <Link
                      to={`/events/${ev.id}`}
                      className="text-sm font-medium underline underline-offset-2"
                      style={{ color: "var(--color-ink-800)" }}
                    >
                      {ev.title}
                    </Link>
                    {ev.description && (
                      <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "var(--color-ink-500)" }}>{ev.description}</p>
                    )}
                    {evMembers.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {evMembers.map((m) => (
                          <Link key={m.id} to={`/members/${m.id}`}
                            className="text-xs px-1.5 py-0.5 rounded-full underline-offset-1"
                            style={{ background: "rgba(181,56,75,0.1)", color: "var(--color-brand)" }}>
                            {m.emoji} {m.name}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
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
                  {n.type === "conference_url_set" ? "📹" : n.type === "confirmed" ? "✅" : n.type === "invited" ? "📨" : "📝"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>
                    {n.message ?? (n.type === "conference_url_set" ? "会議URLが届きました" : n.type === "confirmed" ? "ミーティングの日程が確定しました" : n.type === "invited" ? "ミーティングに招待されました" : "ミーティングに詳細が追加されました")}
                  </p>
                </div>
                <ChevronRight size={16} style={{ color: "#6B7DB3" }} />
              </button>
            ))}
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
              return (
                <a
                  key={b.id}
                  href={`/book/confirmation/${b.cancellationToken}`}
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
                </a>
              );
            })}
          </div>
        </section>
      )}

      {/* ポイント */}
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

      {/* 公開中のお題 */}
      {quests.length > 0 && (
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
          <QuickLink to="/members"  icon={<Users size={18} />}      label="なかまを探して1to1しよう" sub="+1pt"  color="var(--color-brand)" />
          <QuickLink to="/quests"   icon={<ScrollText size={18} />} label={`${termQuest}に挑戦しよう`} sub="+5pt〜" color="var(--color-success)" />
          <QuickLink to="/team"     icon={<span className="text-base">🦊</span>} label="チームの活動を確認しよう" sub="" color="var(--color-accent)" />
          <QuickLink to="/ranking"  icon={<Trophy size={18} />}     label="ランキングをチェック"      sub=""       color="var(--color-accent)" />
          <QuickLink to="/meetings" icon={<Calendar size={18} />}   label="ミーティングの日程調整"    sub=""       color="#6B7DB3" />
          <QuickLink to="/me"       icon={<QrCode size={18} />}     label="自分のQRを表示してカードを渡す" sub="🃏"  color="var(--color-ink-500)" />
        </div>
      </section>
    </div>
  );
}

function QuickLink({ to, icon, label, sub, color }: { to: string; icon: React.ReactNode; label: string; sub: string; color: string }) {
  return (
    <Link to={to}
      className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80 active:scale-[0.98]">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: color + "20", color }}>
        {icon}
      </div>
      <span className="flex-1 text-sm font-medium" style={{ color: "var(--color-ink-700)" }}>{label}</span>
      {sub && <span className="text-xs font-bold" style={{ color: "var(--color-accent)" }}>{sub}</span>}
    </Link>
  );
}
