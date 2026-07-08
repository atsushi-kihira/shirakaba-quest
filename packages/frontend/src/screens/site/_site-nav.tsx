import { NavLink } from "react-router-dom";

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 backdrop-blur-sm"
      style={{
        background: "rgba(250,245,232,0.92)",
        borderBottom: "1px solid var(--color-paper-300)",
      }}>
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
        <NavLink to="/" className="flex items-center gap-2 shrink-0">
          <img src="/bizquest-logo.png" alt="BizQuest" className="w-9 h-9 rounded-full object-cover" />
          <div>
            <div className="text-sm font-semibold leading-none" style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
              BizQuest
            </div>
            <div className="text-[10px] leading-none mt-0.5" style={{ color: "var(--color-ink-400)" }}>
              by Bizolve Consulting
            </div>
          </div>
        </NavLink>

        <nav className="hidden sm:flex items-center gap-6">
          {[
            { to: "/features", label: "機能一覧" },
            { to: "/introduction", label: "導入案内" },
            { to: "/privacy", label: "プライバシーポリシー" },
          ].map(({ to, label }) => (
            <NavLink key={to} to={to} className={({ isActive }) =>
              `text-sm transition ${isActive ? "font-medium" : ""}`
            }
              style={({ isActive }) => ({
                color: isActive ? "var(--color-brand)" : "var(--color-ink-500)",
              })}>
              {label}
            </NavLink>
          ))}
        </nav>

        <NavLink to="/login"
          className="shrink-0 text-sm font-medium px-4 py-1.5 rounded-lg text-white transition hover:opacity-90"
          style={{ background: "var(--color-brand)", fontFamily: "var(--font-zen)" }}>
          ログイン
        </NavLink>
      </div>
    </header>
  );
}
