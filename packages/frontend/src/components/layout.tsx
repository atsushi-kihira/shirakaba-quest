// =============================================================
// レイアウト — タブバー（モバイル）+ サイドバー（PC）
// =============================================================
import { NavLink, Outlet } from "react-router-dom";
import { Home, Users, ScrollText, Trophy, User } from "lucide-react";

const NAV_ITEMS = [
  { to: "/",        icon: Home,       label: "ホーム" },
  { to: "/members", icon: Users,      label: "なかま" },
  { to: "/quests",  icon: ScrollText, label: "お題" },
  { to: "/ranking", icon: Trophy,     label: "順位" },
  { to: "/me",      icon: User,       label: "マイ" },
] as const;

export function AppLayout() {
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
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-medium transition ${
                isActive
                  ? "text-white"
                  : "hover:opacity-80"
              }`
            }
            style={({ isActive }) => ({
              background: isActive ? "var(--color-brand)" : "transparent",
              color: isActive ? "white" : "var(--color-ink-600)",
            })}
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* メインコンテンツ */}
      <main className="flex-1 pb-16 lg:pb-0 max-w-4xl mx-auto w-full px-0 lg:px-6 lg:py-6">
        <Outlet />
      </main>

      {/* モバイル: 下部タブバー */}
      <div className="tab-bar lg:hidden">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition min-w-[56px] text-xs ${
                isActive ? "font-medium" : ""
              }`
            }
            style={({ isActive }) => ({
              color: isActive ? "var(--color-brand)" : "var(--color-ink-400)",
            })}
          >
            <Icon size={22} />
            {label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
