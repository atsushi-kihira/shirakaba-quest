// =============================================================
// レイアウト — タブバー（モバイル）+ サイドバー（PC）
// 1to1 通知バッジ付き
// =============================================================
import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Home, Users, ScrollText, Trophy, User, Calendar, Handshake, Sparkles, Lock } from "lucide-react";
import { useSettings } from "@/hooks/use-settings";
import { InfoTooltip } from "@/components/info-tooltip";
import { useOneOnOneSessions, filterActionableOneOnOne, filterInFlightOneOnOneForBadge } from "@/hooks/use-oneonone-status";
import { useMeetingAlerts } from "@/hooks/use-meeting-alerts";
import { useCollabAlerts, useCollabReactionNotificationCount } from "@/hooks/use-collab-alerts";
import { useGuestFollowups, usePendingExternalOneOnOneCount } from "@/hooks/use-guest-followups";
import { useAuthStore, isApprovedMember } from "@/stores/auth-store";

// 承認待ち（ゲスト）状態のメンバーには使わせない画面（ナビ自体を非活性表示にする）
const GUEST_RESTRICTED_PATHS = new Set(["/members", "/collab", "/enishi", "/quests", "/ranking"]);

/** アプリ設定からタイトルを取得して <title> に反映するフック（公開エンドポイント使用） */
function useAppTitle() {
  const settings = useSettings();
  useEffect(() => {
    document.title = settings.appTitle;
  }, [settings.appTitle]);
}

/** ホームタブの通知バッジ数（対応が必要な1to1＋協働のリアクションメッセージ通知＋外部ゲスト1to1の人脈登録待ち。ホーム画面の表示内容と一致させる） */
function usePendingCount() {
  const { data } = useOneOnOneSessions();
  const reactionCount = useCollabReactionNotificationCount();
  const { data: guestFollowups } = useGuestFollowups();
  return filterActionableOneOnOne(data?.data ?? []).length + reactionCount + (guestFollowups?.data.length ?? 0);
}

/**
 * ミーティングタブの通知バッジ数
 * = 通常ミーティング（日程回答待ち + 未読お知らせ + 出席確認待ち）+ 進行中の1to1申込 + 未決着の外部ゲスト1to1
 * （実施前の「進行中（完了待ち）」も含む。メンバー同士の1to1と同じく実施日時を問わず件数計上する）
 * ミーティング画面側の「通常ミーティング」「1to1ミーティング」タブの件数と一致させる
 */
function useMeetingPendingCount() {
  const meetingAlerts = useMeetingAlerts();
  const { data } = useOneOnOneSessions();
  const inFlightOneOnOne = filterInFlightOneOnOneForBadge(data?.data ?? []).length;
  const pendingExternal = usePendingExternalOneOnOneCount();
  return meetingAlerts.count + inFlightOneOnOne + pendingExternal;
}

export function AppLayout() {
  useAppTitle();
  const pendingCount = usePendingCount();
  const meetingPendingCount = useMeetingPendingCount();
  const collabAlerts = useCollabAlerts();
  const settings = useSettings();
  const approved = isApprovedMember(useAuthStore((s) => s.user));

  const BADGE_COUNTS: Record<string, number> = {
    "/home": pendingCount,
    "/meetings": meetingPendingCount,
    "/collab": collabAlerts.total,
  };

  // 一般公開したばかりの機能・新機能に一時的に表示するお知らせバッジ（数値バッジがある場合はそちらを優先）
  const TEXT_BADGES: Record<string, string> = {};

  const NAV_ITEMS = [
    { to: "/home",     icon: Home,       label: "ホーム",         mobileVisible: true,
      description: "やること・直近の1to1・現在のポイントなどをまとめて確認できます" },
    { to: "/members",  icon: Users,      label: "なかま",         mobileVisible: true,
      description: "チャプターメンバーの一覧・カード情報を見て1to1を申し込めます" },
    { to: "/collab",   icon: Handshake,  label: "協働",           mobileVisible: true,
      description: "メンバーとの協働関係やパワーチームの状況をマップで確認できます" },
    { to: "/enishi",   icon: Sparkles,   label: settings.termEnishi, mobileVisible: false,
      description: `集めたカードの人脈から、AIが新しい${settings.termEnishi}の候補を提案します` },
    { to: "/quests",   icon: ScrollText, label: settings.termQuest, mobileVisible: true,
      description: `${settings.termUsp}を組み合わせて${settings.termQuest}に挑戦し、ポイントを獲得できます` },
    { to: "/meetings", icon: Calendar,   label: "ミーティング",   mobileVisible: true,
      description: "1to1や複数人でのミーティングの申し込み・日程調整・記録を管理します" },
    { to: "/ranking",  icon: Trophy,     label: "順位",           mobileVisible: false,
      description: "チャプター内でのポイントランキングを確認できます" },
    { to: "/me",       icon: User,       label: "マイページ",     mobileVisible: true,
      description: "プロフィール編集・QRコード表示・各種設定はこちらから" },
  ] as const;

  return (
    <div className="flex min-h-dvh" style={{ background: "var(--color-paper-100)" }}>
      {/* PC: 左サイドバー */}
      <nav className="hidden lg:flex flex-col w-60 shrink-0 border-r pt-6 px-4 gap-1"
        style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}>
        <div className="flex items-center gap-2 px-3 mb-6">
          <span className="text-4xl leading-none">{settings.appLogo || "🃏"}</span>
          <span className="font-semibold text-lg" style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
            {settings.appTitle}
          </span>
        </div>
        {NAV_ITEMS.map(({ to, icon: Icon, label, description }) => {
          const restricted = !approved && GUEST_RESTRICTED_PATHS.has(to);
          if (restricted) {
            return (
              <div key={to}
                className="flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-medium relative cursor-not-allowed"
                style={{ color: "var(--color-ink-300)" }}
                title="承認されると利用できます">
                <Icon size={18} />
                {label}
                <Lock size={13} className="ml-auto" />
              </div>
            );
          }
          return (
          <NavLink key={to} to={to} end={to === "/home"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-medium transition relative ${isActive ? "text-white" : "hover:opacity-80"}`
            }
            style={({ isActive }) => ({
              background: isActive ? "var(--color-brand)" : "transparent",
              color: isActive ? "white" : "var(--color-ink-600)",
            })}>
            <Icon size={18} />
            {label}
            <InfoTooltip text={description} placement="below" />
            {(BADGE_COUNTS[to] ?? 0) > 0 ? (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 min-w-[18px] h-[18px] rounded-full text-white text-xs flex items-center justify-center px-1 font-bold"
                style={{ background: "var(--color-brand)" }}>
                {BADGE_COUNTS[to] > 9 ? "9+" : BADGE_COUNTS[to]}
              </span>
            ) : TEXT_BADGES[to] ? (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 h-[18px] rounded-full text-white text-[10px] flex items-center justify-center px-2 font-bold whitespace-nowrap"
                style={{ background: "var(--color-accent)" }}>
                {TEXT_BADGES[to]}
              </span>
            ) : null}
          </NavLink>
          );
        })}
      </nav>

      {/* メインコンテンツ */}
      <main className="flex-1 main-with-tabbar max-w-4xl w-full px-0 lg:px-6 lg:py-6">
        <Outlet />
      </main>

      {/* モバイル: 下部タブバー */}
      <div className="tab-bar lg:hidden">
        {NAV_ITEMS.filter((item) => item.mobileVisible).map(({ to, icon: Icon, label, description }) => {
          const restricted = !approved && GUEST_RESTRICTED_PATHS.has(to);
          if (restricted) {
            return (
              <div key={to}
                className="flex flex-col items-center gap-0.5 flex-1 px-1 py-1.5 rounded-xl text-xs cursor-not-allowed"
                style={{ color: "var(--color-ink-300)" }}
                title="承認されると利用できます">
                <div className="relative">
                  <Icon size={20} />
                  <Lock size={10} className="absolute -top-1 -right-1.5" />
                </div>
                <span>{label}</span>
              </div>
            );
          }
          return (
          <NavLink key={to} to={to} end={to === "/home"}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 flex-1 px-1 py-1.5 rounded-xl transition text-xs relative ${isActive ? "font-medium" : ""}`
            }
            style={({ isActive }) => ({ color: isActive ? "var(--color-brand)" : "var(--color-ink-400)" })}>
            <div className="relative">
              <Icon size={20} />
              {/* 通知バッジ（ホーム／ミーティング等） */}
              {(BADGE_COUNTS[to] ?? 0) > 0 ? (
                <span className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] rounded-full text-white flex items-center justify-center px-0.5 font-bold"
                  style={{ background: "var(--color-brand)", fontSize: "9px" }}>
                  {BADGE_COUNTS[to] > 9 ? "9+" : BADGE_COUNTS[to]}
                </span>
              ) : TEXT_BADGES[to] ? (
                /* お知らせバッジ（New!／Update!） */
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 h-[13px] rounded-full text-white flex items-center justify-center px-1.5 font-bold whitespace-nowrap"
                  style={{ background: "var(--color-accent)", fontSize: "8px" }}>
                  {TEXT_BADGES[to]}
                </span>
              ) : null}
            </div>
            <span className="inline-flex items-center gap-0.5">
              {label}
              <InfoTooltip text={description} placement="above" />
            </span>
          </NavLink>
          );
        })}
      </div>
    </div>
  );
}
