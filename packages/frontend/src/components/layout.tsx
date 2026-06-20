// =============================================================
// レイアウト — タブバー（モバイル）+ サイドバー（PC）
// 1to1 通知バッジ付き
// =============================================================
import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Home, Users, ScrollText, Trophy, User, Shield } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useSettings } from "@/hooks/use-settings";

type OnoSession = { status: string; myRole: string; requesterCompletedAt: number | null; responderCompletedAt: number | null };

/** アプリ設定からタイトルを取得して <title> に反映するフック（公開エンドポイント使用） */
function useAppTitle() {
  const settings = useSettings();
  useEffect(() => {
    document.title = settings.appTitle;
  }, [settings.appTitle]);
}

function usePendingCount() {
  const user = useAuthStore((s) => s.user);
  const { data } = useQuery({
    queryKey: ["oneonone"],
    queryFn: () => api.get<{ data: OnoSession[] }>("/oneonone"),
    enabled: !!user,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const sessions = data?.data ?? [];
  return sessions.filter((s) => {
    if (s.status === "pending" && s.myRole === "responder") return true;
    if (s.status === "accepted") {
      const myDone = s.myRole === "requester" ? s.requesterCompletedAt : s.responderCompletedAt;
      return !myDone;
    }
    return false;
  }).length;
}

export function AppLayout() {
  useAppTitle();
  const pendingCount = usePendingCount();
  const settings = useSettings();

  const NAV_ITEMS = [
    { to: "/",        icon: Home,       label: "ホーム" },
    { to: "/members", icon: Users,      label: "なかま" },
    { to: "/team",    icon: Shield,     label: "チーム" },
    { to: "/quests",  icon: ScrollText, label: settings.termQuest },
    { to: "/ranking", icon: Trophy,     label: "順位" },
    { to: "/me",      icon: User,       label: "マイ" },
  ] as const;

  return (
    <div className="flex min-h-dvh" style={{ background: "var(--color-paper-100)" }}>
      {/* PC: 左サイドバー */}
      <nav className="hidden lg:flex flex-col w-60 shrink-0 border-r pt-6 px-4 gap-1"
        style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}>
        <div className="flex items-center gap-2 px-3 mb-6">
          <span className="text-2xl">🃏</span>
          <span className="font-semibold text-lg" style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
            白樺クエスト
          </span>
        </div>
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-medium transition relative ${isActive ? "text-white" : "hover:opacity-80"}`
            }
            style={({ isActive }) => ({
              background: isActive ? "var(--color-brand)" : "transparent",
              color: isActive ? "white" : "var(--color-ink-600)",
            })}>
            <Icon size={18} />
            {label}
            {to === "/" && pendingCount > 0 && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 min-w-[18px] h-[18px] rounded-full text-white text-xs flex items-center justify-center px-1 font-bold"
                style={{ background: "var(--color-brand)" }}>
                {pendingCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* メインコンテンツ */}
      <main className="flex-1 main-with-tabbar max-w-4xl mx-auto w-full px-0 lg:px-6 lg:py-6">
        <Outlet />
      </main>

      {/* モバイル: 下部タブバー */}
      <div className="tab-bar lg:hidden">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === "/"}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 flex-1 px-1 py-1.5 rounded-xl transition text-xs relative ${isActive ? "font-medium" : ""}`
            }
            style={({ isActive }) => ({ color: isActive ? "var(--color-brand)" : "var(--color-ink-400)" })}>
            <div className="relative">
              <Icon size={20} />
              {/* ホームタブに通知バッジ */}
              {to === "/" && pendingCount > 0 && (
                <span className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] rounded-full text-white flex items-center justify-center px-0.5 font-bold"
                  style={{ background: "var(--color-brand)", fontSize: "9px" }}>
                  {pendingCount > 9 ? "9+" : pendingCount}
                </span>
              )}
            </div>
            {label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
