// =============================================================
// ミーティング一覧画面
// =============================================================
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Calendar, CheckCircle, Clock, XCircle, Handshake, ChevronRight, ChevronDown, Bell, ClipboardList, X, Lock, Flag, FileCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore, isApprovedMember } from "@/stores/auth-store";
import { useTimezone } from "@/hooks/use-timezone";
import { fmtDateJP, fmtTime, fmtDateShort } from "@/lib/date";
import { useMeetingAlerts } from "@/hooks/use-meeting-alerts";
import { useOneOnOneSessions, filterInFlightOneOnOneForBadge } from "@/hooks/use-oneonone-status";
import { usePendingExternalOneOnOneCount } from "@/hooks/use-guest-followups";
import { InProgressOneOnOneSection, OneOnOneHistorySection } from "./_oneonone-sections";
import { ExternalGuestOneOnOneSection } from "./_external-guest-oneonone-section";
import { getMeetingEffectiveStatus, STATUS_META, type EffectiveStatus } from "@/lib/meeting-status";

type MeetingItem = {
  id: string;
  title: string;
  description: string | null;
  host: { id: string; name: string; emoji: string } | null;
  isHost: boolean;
  scope: "all" | "team" | "selected";
  status: "open" | "confirmed" | "cancelled";
  candidateCount: number;
  deadline: number | null;
  confirmedDate: { startsAt: number; endsAt: number | null } | null;
  hasResponded: boolean;
  createdAt: number;
};

type MeetingsResponse = { data: MeetingItem[] };

const SCOPE_LABEL: Record<string, string> = {
  all: "全メンバー",
  team: "ギルド",
  selected: "指定メンバー",
};

function formatConfirmedDate(ts: number, endsAt: number | null, tz: string): string {
  const date = fmtDateJP(ts, tz);
  const startT = fmtTime(ts, tz);
  if (endsAt) return `${date} ${startT}〜${fmtTime(endsAt, tz)}`;
  return startT === "00:00" ? date : `${date} ${startT}`;
}

const STATUS_ICON: Record<EffectiveStatus, typeof Clock> = {
  cancelled: XCircle,
  past: Flag,
  attending: CheckCircle,
  response_closed: Lock,
  responded_pending_confirm: FileCheck,
  new: Bell,
  seen_unresponded: Clock,
};

/** 主催者向けの簡易ステータス表示 */
function HostStatusBadge({ status }: { status: string }) {
  if (status === "confirmed") {
    return (
      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ background: "rgba(90,140,92,0.12)", color: "var(--color-success)" }}>
        <CheckCircle size={11} />確定済み
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ background: "var(--color-paper-300)", color: "var(--color-ink-400)" }}>
        <XCircle size={11} />キャンセル
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
      <Clock size={11} />募集中
    </span>
  );
}

/** 招待された側向けの詳細ステータス表示 */
function StatusBadge({ m, hasUnreadNotification, nowSec }: { m: MeetingItem; hasUnreadNotification: boolean; nowSec: number }) {
  if (m.isHost) return <HostStatusBadge status={m.status} />;
  const eff = getMeetingEffectiveStatus(m, hasUnreadNotification, nowSec);
  const meta = STATUS_META[eff];
  const Icon = STATUS_ICON[eff];
  return (
    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ background: meta.bg, color: meta.color }}>
      <Icon size={11} />{meta.label}
    </span>
  );
}

type Tab = "regular" | "oneonone";

export function MeetingsScreen() {
  const approved = isApprovedMember(useAuthStore((s) => s.user));
  const [tab, setTab] = useState<Tab>(approved ? "regular" : "oneonone");
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const oneOnOneData = useOneOnOneSessions();
  const pendingExternal = usePendingExternalOneOnOneCount();
  const oneOnOneCount = filterInFlightOneOnOneForBadge(oneOnOneData.data?.data ?? []).length + pendingExternal;
  const alerts = useMeetingAlerts();

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "regular",  label: "通常ミーティング", count: alerts.count },
    { key: "oneonone", label: "1to1ミーティング", count: oneOnOneCount },
  ];

  return (
    <div className="px-4 py-6 pb-24 max-w-xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          📅 ミーティング
        </h1>
        <button
          onClick={() => setShowCreateMenu(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-medium text-white"
          style={{ background: "var(--color-brand)" }}
        >
          <Plus size={15} />
          新規作成
        </button>
      </div>

      {/* タブ: 通常ミーティング / 1to1ミーティング */}
      <div className="flex gap-2 mb-5">
        {TABS.map(({ key, label, count }) => {
          const locked = key === "regular" && !approved;
          return (
          <button
            key={key}
            onClick={() => !locked && setTab(key)}
            disabled={locked}
            className="flex-1 py-2.5 rounded-2xl text-sm font-medium transition relative flex items-center justify-center gap-1.5"
            style={{
              background: tab === key && !locked ? "var(--color-brand)" : "var(--color-paper-200)",
              color: tab === key && !locked ? "white" : locked ? "var(--color-ink-300)" : "var(--color-ink-600)",
              cursor: locked ? "not-allowed" : "pointer",
            }}
          >
            {key === "oneonone" && <Handshake size={14} />}
            {label}
            {locked && <Lock size={12} />}
            {!locked && count > 0 && (
              <span className="min-w-[18px] h-[18px] rounded-full text-white text-xs flex items-center justify-center px-1 font-bold"
                style={{ background: tab === key ? "var(--color-accent)" : "var(--color-brand)" }}>
                {count > 9 ? "9+" : count}
              </span>
            )}
          </button>
          );
        })}
      </div>

      {tab === "regular" && approved ? <RegularMeetingsTab /> : <OneOnOneMeetingsTab />}

      {showCreateMenu && <CreateMenuModal onClose={() => setShowCreateMenu(false)} approved={approved} />}
    </div>
  );
}

// ================================================================
// 新規作成メニュー（1to1 / 複数人ミーティングの選択）
// ================================================================
function CreateMenuModal({ onClose, approved }: { onClose: () => void; approved: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="card-paper w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-6 pb-10 sm:pb-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-lg" style={{ fontFamily: "var(--font-klee)" }}>📅 何を立てますか？</h3>
          <button onClick={onClose} className="p-2 rounded-full" style={{ background: "var(--color-paper-200)" }}>
            <X size={18} style={{ color: "var(--color-ink-500)" }} />
          </button>
        </div>
        <div className="space-y-3">
          <Link
            to="/meetings/one-on-one"
            className="flex items-center gap-3 p-4 rounded-2xl transition active:opacity-80"
            style={{ background: "var(--color-paper-200)" }}
          >
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ background: "rgba(181,56,75,0.1)" }}>
              🤝
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm" style={{ color: "var(--color-ink-900)" }}>1to1を申し込む</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>特定の1人と1to1の約束をする</p>
            </div>
            <ChevronRight size={18} style={{ color: "var(--color-ink-400)" }} />
          </Link>
          {approved ? (
            <>
              <Link
                to="/meetings/new"
                className="flex items-center gap-3 p-4 rounded-2xl transition active:opacity-80"
                style={{ background: "var(--color-paper-200)" }}
              >
                <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ background: "rgba(212,160,59,0.15)" }}>
                  📅
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm" style={{ color: "var(--color-ink-900)" }}>複数人のミーティングを作成する</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>候補日を出して複数人で日程調整する</p>
                </div>
                <ChevronRight size={18} style={{ color: "var(--color-ink-400)" }} />
              </Link>
              <Link
                to="/meetings/series/new"
                className="flex items-center gap-3 p-4 rounded-2xl transition active:opacity-80"
                style={{ background: "var(--color-paper-200)" }}
              >
                <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ background: "rgba(90,140,92,0.12)" }}>
                  🔁
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm" style={{ color: "var(--color-ink-900)" }}>定例会を立てる</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>毎週・隔週・毎月の繰り返し予定をまとめて調整する</p>
                </div>
                <ChevronRight size={18} style={{ color: "var(--color-ink-400)" }} />
              </Link>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 p-4 rounded-2xl opacity-50 cursor-not-allowed" style={{ background: "var(--color-paper-200)" }}
                title="承認されると利用できます">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ background: "rgba(212,160,59,0.15)" }}>
                  📅
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm" style={{ color: "var(--color-ink-900)" }}>複数人のミーティングを作成する</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>候補日を出して複数人で日程調整する</p>
                </div>
                <Lock size={16} style={{ color: "var(--color-ink-400)" }} />
              </div>
              <div className="flex items-center gap-3 p-4 rounded-2xl opacity-50 cursor-not-allowed" style={{ background: "var(--color-paper-200)" }}
                title="承認されると利用できます">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ background: "rgba(90,140,92,0.12)" }}>
                  🔁
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm" style={{ color: "var(--color-ink-900)" }}>定例会を立てる</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>毎週・隔週・毎月の繰り返し予定をまとめて調整する</p>
                </div>
                <Lock size={16} style={{ color: "var(--color-ink-400)" }} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ================================================================
// 通常ミーティングタブ
// ================================================================
type SeriesItem = { id: string; title: string; status: "voting" | "confirmed" | "ended" | "cancelled"; isHost: boolean; host: { id: string; name: string; emoji: string } | null };

type Period = "1m" | "6m" | "1y" | "all";
const PERIOD_LABELS: Record<Period, string> = { "1m": "直近1ヶ月", "6m": "直近6ヶ月", "1y": "直近1年", all: "すべて" };
const PERIOD_DAYS: Record<Period, number | null> = { "1m": 30, "6m": 182, "1y": 365, all: null };

// 開催済み・キャンセル済み（＝「過去のミーティング」）かどうか。open のミーティングは
// 候補日を過ぎていても日程が確定していない限り「進行中」として扱う
function isPastMeeting(m: MeetingItem, nowSec: number): boolean {
  if (m.status === "cancelled") return true;
  if (m.status === "confirmed" && m.confirmedDate) return m.confirmedDate.startsAt < nowSec;
  return false;
}

// 期間フィルター・並び替えの基準時刻（確定日時があればそれ、なければ作成日時）
function meetingSortTime(m: MeetingItem): number {
  return m.confirmedDate?.startsAt ?? m.createdAt;
}

const SERIES_STATUS_META: Record<SeriesItem["status"], { label: string; bg: string; color: string }> = {
  voting: { label: "投票中", bg: "rgba(212,160,59,0.15)", color: "var(--color-accent)" },
  confirmed: { label: "確定済み", bg: "rgba(90,140,92,0.12)", color: "var(--color-success)" },
  ended: { label: "終了", bg: "var(--color-paper-300)", color: "var(--color-ink-500)" },
  cancelled: { label: "キャンセル", bg: "var(--color-paper-300)", color: "var(--color-ink-500)" },
};

function RegularMeetingsTab() {
  const user = useAuthStore((s) => s.user);
  const tz = useTimezone();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const alerts = useMeetingAlerts();
  const [showHistory, setShowHistory] = useState(false);
  const [period, setPeriod] = useState<Period>("1m");

  const { data, isLoading } = useQuery({
    queryKey: ["meetings"],
    queryFn: () => api.get<MeetingsResponse>("/meetings"),
    enabled: !!user,
  });

  const { data: seriesData } = useQuery({
    queryKey: ["meeting-series"],
    queryFn: () => api.get<{ data: SeriesItem[] }>("/meeting-series"),
    enabled: !!user,
  });
  const seriesList = seriesData?.data ?? [];
  // 投票中・確定済みの定例会は常時表示、終了・キャンセル済みは「過去のミーティング」に折りたたむ
  const activeSeriesList = seriesList.filter((s) => s.status === "voting" || s.status === "confirmed");
  const pastSeriesList = seriesList.filter((s) => s.status === "ended" || s.status === "cancelled");

  function handleNotifClick(meetingId: string) {
    api.post(`/meetings/${meetingId}/read-notifications`, {})
      .then(() => qc.invalidateQueries({ queryKey: ["meetings", "notifications"] }))
      .catch(() => {});
    navigate(`/meetings/${meetingId}`);
  }

  const meetings = data?.data ?? [];
  const nowSec = Math.floor(Date.now() / 1000);

  const inProgressMeetings = meetings.filter((m) => !isPastMeeting(m, nowSec));
  const pastMeetings = meetings
    .filter((m) => isPastMeeting(m, nowSec))
    .sort((a, b) => meetingSortTime(b) - meetingSortTime(a));
  const days = PERIOD_DAYS[period];
  const cutoff = days ? nowSec - days * 86400 : null;
  const filteredPastMeetings = pastMeetings.filter((m) => cutoff === null || meetingSortTime(m) >= cutoff);

  function renderSeriesCard(s: SeriesItem) {
    const meta = SERIES_STATUS_META[s.status];
    return (
      <Link key={s.id} to={`/meetings/series/${s.id}`}
        className="block card-paper rounded-2xl px-4 py-3 transition active:opacity-75">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="font-semibold text-sm" style={{ color: "var(--color-ink-900)" }}>🔁 {s.title}</span>
          {s.isHost && (
            <span className="text-xs px-1.5 py-0.5 rounded-md font-medium" style={{ background: "var(--color-accent)", color: "white" }}>主催</span>
          )}
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: meta.bg, color: meta.color }}>
          {meta.label}
        </span>
      </Link>
    );
  }

  function renderMeetingCard(m: MeetingItem) {
    return (
      <Link
        key={m.id}
        to={`/meetings/${m.id}`}
        className="block card-paper rounded-3xl px-4 py-4 transition active:opacity-75"
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-sm" style={{ color: "var(--color-ink-900)" }}>
                {m.title}
              </span>
              {m.isHost && (
                <span className="text-xs px-1.5 py-0.5 rounded-md font-medium"
                  style={{ background: "var(--color-accent)", color: "white" }}>
                  主催
                </span>
              )}
            </div>

            {m.status === "confirmed" && m.confirmedDate ? (
              <p className="text-sm font-medium mb-2" style={{ color: "var(--color-success)" }}>
                ✅ 確定: {formatConfirmedDate(m.confirmedDate.startsAt, m.confirmedDate.endsAt, tz)}
              </p>
            ) : (
              <p className="text-xs mb-2" style={{ color: "var(--color-ink-400)" }}>
                候補日 {m.candidateCount}件 · {SCOPE_LABEL[m.scope]}対象
              </p>
            )}

            <div className="flex items-center gap-2">
              <StatusBadge m={m} hasUnreadNotification={alerts.unreadMeetingIds.has(m.id)} nowSec={nowSec} />
              {!m.isHost && m.host && (
                <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>
                  {m.host.emoji} {m.host.name}さん主催
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <div>
      {/* 出席確認が必要なミーティング */}
      {alerts.pendingAttendances.length > 0 && (
        <section className="mb-5">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5" style={{ color: "var(--color-accent)" }}>
            <ClipboardList size={14} />出席確認をしてください
          </h2>
          <div className="space-y-2">
            {alerts.pendingAttendances.map((m) => (
              <Link
                key={m.id}
                to={`/meetings/${m.id}`}
                className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80"
                style={{ borderLeft: "3px solid var(--color-accent)" }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "var(--color-ink-800)" }}>{m.title}</p>
                  <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
                    {fmtDateShort(m.confirmedStartsAt, tz)} 開催 · 出席状況を記録してください
                  </p>
                </div>
                <ChevronRight size={16} style={{ color: "var(--color-accent)" }} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 日程回答が必要なミーティング */}
      {alerts.pendingMeetings.length > 0 && (
        <section className="mb-5">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5" style={{ color: "var(--color-brand)" }}>
            <Clock size={14} />回答をお願いします
          </h2>
          <div className="space-y-2">
            {alerts.pendingMeetings.map((m) => (
              <Link
                key={m.id}
                to={`/meetings/${m.id}`}
                className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80"
                style={{ borderLeft: "3px solid var(--color-brand)" }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "var(--color-ink-800)" }}>{m.title}</p>
                  <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
                    {m.host?.emoji} {m.host?.name}さん主催 · 参加可否の回答をお願いします
                  </p>
                </div>
                <ChevronRight size={16} style={{ color: "var(--color-brand)" }} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 定例会の投票が必要 */}
      {alerts.pendingSeries.length > 0 && (
        <section className="mb-5">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5" style={{ color: "var(--color-brand)" }}>
            <Clock size={14} />定例会の候補に投票してください
          </h2>
          <div className="space-y-2">
            {alerts.pendingSeries.map((s) => (
              <Link
                key={s.id}
                to={`/meetings/series/${s.id}`}
                className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80"
                style={{ borderLeft: "3px solid var(--color-brand)" }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "var(--color-ink-800)" }}>🔁 {s.title}</p>
                  <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
                    {s.host?.emoji} {s.host?.name}さん主催 · 候補パターンへの回答をお願いします
                  </p>
                </div>
                <ChevronRight size={16} style={{ color: "var(--color-brand)" }} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 未読お知らせ */}
      {alerts.notifications.length > 0 && (
        <section className="mb-5">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5" style={{ color: "#6B7DB3" }}>
            <Bell size={14} />未読のお知らせ
          </h2>
          <div className="space-y-2">
            {alerts.notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleNotifClick(n.meetingId)}
                className="w-full card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80 text-left"
                style={{ borderLeft: "3px solid #6B7DB3" }}
              >
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

      {/* 定例会（投票中・確定済みのみ。終了・キャンセル済みは下の過去のミーティングへ） */}
      {activeSeriesList.length > 0 && (
        <section className="mb-5">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5" style={{ color: "var(--color-ink-700)" }}>
            🔁 定例会
          </h2>
          <div className="space-y-2">
            {activeSeriesList.map(renderSeriesCard)}
          </div>
        </section>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
        </div>
      ) : meetings.length === 0 && seriesList.length === 0 ? (
        <div className="text-center py-16">
          <Calendar size={48} className="mx-auto mb-3 opacity-20" />
          <p className="font-medium" style={{ color: "var(--color-ink-600)" }}>ミーティングはありません</p>
          <p className="text-sm mt-1" style={{ color: "var(--color-ink-400)" }}>
            「新規作成」から日程調整を始めましょう
          </p>
        </div>
      ) : (
        <>
          {/* 進行中のミーティング */}
          {meetings.length > 0 && (
            <section className="mb-5">
              <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--color-ink-700)" }}>📅 進行中のミーティング</h2>
              {inProgressMeetings.length === 0 ? (
                <p className="text-center text-sm py-6" style={{ color: "var(--color-ink-400)" }}>進行中のミーティングはありません</p>
              ) : (
                <div className="space-y-3">
                  {inProgressMeetings.map(renderMeetingCard)}
                </div>
              )}
            </section>
          )}

          {/* 過去のミーティング（トグルで表示。終了・キャンセル済みの定例会もここに含める） */}
          {(pastMeetings.length > 0 || pastSeriesList.length > 0) && (
            <section>
              <button onClick={() => setShowHistory((v) => !v)}
                className="flex items-center gap-1 text-sm font-semibold mb-2" style={{ color: "var(--color-ink-700)" }}>
                <ChevronDown size={15} style={{ transform: showHistory ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }} />
                🗂️ 過去のミーティング（{pastMeetings.length + pastSeriesList.length}件）
              </button>
              {showHistory && (
                <>
                  {pastSeriesList.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {pastSeriesList.map(renderSeriesCard)}
                    </div>
                  )}
                  <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
                    {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => setPeriod(p)}
                        className="px-3 py-1.5 rounded-2xl text-xs font-medium whitespace-nowrap transition"
                        style={{
                          background: period === p ? "var(--color-brand)" : "var(--color-paper-200)",
                          color: period === p ? "white" : "var(--color-ink-600)",
                        }}
                      >
                        {PERIOD_LABELS[p]}
                      </button>
                    ))}
                  </div>
                  {filteredPastMeetings.length === 0 ? (
                    <p className="text-center text-sm py-6" style={{ color: "var(--color-ink-400)" }}>この期間のミーティングはありません</p>
                  ) : (
                    <div className="space-y-3">
                      {filteredPastMeetings.map(renderMeetingCard)}
                    </div>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ================================================================
// 1to1ミーティングタブ
// ================================================================
function OneOnOneMeetingsTab() {
  return (
    <div className="space-y-6">
      <InProgressOneOnOneSection />
      <ExternalGuestOneOnOneSection />
      <OneOnOneHistorySection />
    </div>
  );
}
