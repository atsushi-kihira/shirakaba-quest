// =============================================================
// 管理画面レイアウト
// =============================================================
import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users, ScrollText, Settings, LayoutDashboard, RotateCcw, Star, CalendarDays, Megaphone, UsersRound, Calendar, CreditCard, Mail, Handshake, History, BarChart3 } from "lucide-react";
import { api } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";

// 未読・要対応の件数を表示するメニューは「メンバー管理（未承認ユーザー）」と
// 「カード作成（注文リクエスト）」のみに限定する。ミーティング等は日々変動が多く、
// バッジを付けると溜まり続けて確認疲れになるため、あえて表示しない。
function useAdminBadgeCounts() {
  const { data: membersData } = useQuery({
    queryKey: ["admin", "members"],
    queryFn: () => api.get<{ data: { status: string }[] }>("/admin/members"),
    staleTime: 30_000,
  });
  const { data: cardOrdersData } = useQuery({
    queryKey: ["admin", "card-print", "orders"],
    queryFn: () => api.get<{ data: { status: string }[] }>("/admin/card-print/orders"),
    staleTime: 30_000,
  });
  const pendingMembers = (membersData?.data ?? []).filter((m) => m.status === "pending").length;
  const pendingCardOrders = (cardOrdersData?.data ?? []).filter((o) => o.status === "pending").length;
  return { "/admin/members": pendingMembers, "/admin/card": pendingCardOrders } as Record<string, number>;
}

export function AdminLayout() {
  const { termQuest, appTitle } = useSettings();
  const badgeCounts = useAdminBadgeCounts();

  const ADMIN_NAV = [
    { to: "/admin",          icon: LayoutDashboard, label: "ダッシュボード",          end: true },
    { to: "/admin/members",  icon: Users,           label: "メンバー管理",            end: false },
    { to: "/admin/usps",     icon: Star,            label: "USP管理",                 end: false },
    { to: "/admin/quests",   icon: ScrollText,      label: `${termQuest}管理`,        end: false },
    { to: "/admin/seasons",  icon: CalendarDays,    label: "シーズン",                end: false },
    { to: "/admin/event-types", icon: Megaphone,     label: "イベント",                end: false },
    { to: "/admin/teams",    icon: UsersRound,      label: "ギルド",                  end: false },
    { to: "/admin/meetings", icon: Calendar,        label: "ミーティング",            end: false },
    { to: "/admin/collab",  icon: Handshake,       label: "協働",                    end: false },
    { to: "/admin/card",      icon: CreditCard,      label: "カード作成",              end: false },
    { to: "/admin/points",   icon: RotateCcw,       label: "ポイント管理",        end: false },
    { to: "/admin/oneonone-history", icon: History, label: "1to1履歴管理",        end: false },
    { to: "/admin/usage-report", icon: BarChart3, label: "利用状況",             end: false },
    { to: "/admin/email-templates", icon: Mail,      label: "メール配信",              end: false },
    { to: "/admin/settings", icon: Settings,        label: "アプリ設定",              end: false },
  ] as const;

  useEffect(() => {
    document.title = `${appTitle}-管理者ダッシュボード`;
    return () => {
      // 管理画面から離れたら戻す（AppLayout 側で上書きされるので念のため）
      document.title = appTitle;
    };
  }, [appTitle]);

  return (
    <div className="admin-theme flex h-dvh overflow-hidden" style={{ background: "var(--color-paper-100)" }}>
      {/* PC: 左サイドバー — ダークスレート */}
      <nav className="hidden lg:flex flex-col w-64 shrink-0 pt-6 px-4 gap-1 overflow-y-auto"
        style={{ background: "#0f172a" }}>
        {/* ヘッダー */}
        <div className="flex items-center gap-2 px-3 mb-6">
          <span className="text-2xl">⚙️</span>
          <div>
            <div className="font-semibold text-sm leading-tight" style={{ fontFamily: "var(--font-klee)", color: "white" }}>
              管理ダッシュボード
            </div>
            <div className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
              {appTitle}
            </div>
          </div>
        </div>

        {/* ナビゲーション */}
        {ADMIN_NAV.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition relative"
            style={({ isActive }) => ({
              background: isActive ? "rgba(99,102,241,0.85)" : "transparent",
              color: isActive ? "white" : "rgba(255,255,255,0.6)",
            })}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              if (!el.dataset.active) el.style.color = "rgba(255,255,255,0.9)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget;
              if (!el.dataset.active) el.style.color = "rgba(255,255,255,0.6)";
            }}
          >
            <Icon size={18} />
            {label}
            {(badgeCounts[to] ?? 0) > 0 && (
              <span className="ml-auto min-w-[18px] h-[18px] rounded-full text-white text-xs flex items-center justify-center px-1 font-bold"
                style={{ background: "var(--color-brand)" }}>
                {badgeCounts[to] > 9 ? "9+" : badgeCounts[to]}
              </span>
            )}
          </NavLink>
        ))}

        {/* フッター */}
        <div className="mt-auto pb-6 pt-4 px-3 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <NavLink
            to="/"
            className="flex items-center gap-1.5 text-xs transition"
            style={{ color: "rgba(255,255,255,0.35)" }}
          >
            ← メンバー画面へ戻る
          </NavLink>
        </div>
      </nav>

      {/* メインコンテンツ */}
      <main className="flex-1 main-with-tabbar max-w-4xl w-full px-0 lg:px-8 lg:py-6 overflow-y-auto"
        style={{ "--sidebar-w": "256px" } as React.CSSProperties}>
        <Outlet />
      </main>

      {/* モバイル: 下部タブバー — ダークスレート */}
      <div className="tab-bar lg:hidden overflow-x-auto" style={{ background: "#0f172a", borderTopColor: "#1e293b" }}>
        {ADMIN_NAV.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition min-w-[52px] text-xs relative ${
                isActive ? "font-medium" : ""
              }`
            }
            style={({ isActive }) => ({
              color: isActive ? "#818cf8" : "rgba(255,255,255,0.45)",
            })}
          >
            <div className="relative">
              <Icon size={20} />
              {(badgeCounts[to] ?? 0) > 0 && (
                <span className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] rounded-full text-white flex items-center justify-center px-0.5 font-bold"
                  style={{ background: "var(--color-brand)", fontSize: "9px" }}>
                  {badgeCounts[to] > 9 ? "9+" : badgeCounts[to]}
                </span>
              )}
            </div>
            <span className="whitespace-nowrap" style={{ fontSize: "10px" }}>{label.replace("管理", "")}</span>
          </NavLink>
        ))}
      </div>
    </div>
  );
}
