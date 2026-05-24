// =============================================================
// 管理画面レイアウト
// =============================================================
import { NavLink, Outlet } from "react-router-dom";
import { Users, ScrollText, Settings, LayoutDashboard, RotateCcw } from "lucide-react";

const ADMIN_NAV = [
  { to: "/admin",          icon: LayoutDashboard, label: "ダッシュボード", end: true },
  { to: "/admin/members",  icon: Users,           label: "メンバー管理",   end: false },
  { to: "/admin/quests",   icon: ScrollText,      label: "お題管理",       end: false },
  { to: "/admin/points",   icon: RotateCcw,       label: "ポイントリセット", end: false },
  { to: "/admin/settings", icon: Settings,        label: "アプリ設定",     end: false },
] as const;

export function AdminLayout() {
  return (
    <div className="flex min-h-dvh" style={{ background: "var(--color-paper-100)" }}>
      {/* PC: 左サイドバー */}
      <nav className="hidden lg:flex flex-col w-64 shrink-0 border-r pt-6 px-4 gap-1"
        style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}>
        <div className="flex items-center gap-2 px-3 mb-6">
          <span className="text-2xl">⚙️</span>
          <span className="font-semibold text-lg" style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
            管理ダッシュボード
          </span>
        </div>
        {ADMIN_NAV.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-medium transition ${
                isActive ? "text-white" : "hover:opacity-80"
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
        <div className="mt-auto pb-6 px-3">
          <NavLink to="/" className="text-xs" style={{ color: "var(--color-ink-400)" }}>
            ← メンバー画面へ
          </NavLink>
        </div>
      </nav>

      {/* メインコンテンツ */}
      <main className="flex-1 pb-20 lg:pb-0 max-w-4xl mx-auto w-full px-0 lg:px-8 lg:py-6">
        <Outlet />
      </main>

      {/* モバイル: 下部タブバー */}
      <div className="tab-bar lg:hidden overflow-x-auto">
        {ADMIN_NAV.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition min-w-[52px] text-xs ${
                isActive ? "font-medium" : ""
              }`
            }
            style={({ isActive }) => ({
              color: isActive ? "var(--color-brand)" : "var(--color-ink-400)",
            })}
          >
            <Icon size={20} />
            <span className="whitespace-nowrap" style={{ fontSize: "10px" }}>{label.replace("管理", "")}</span>
          </NavLink>
        ))}
      </div>
    </div>
  );
}
