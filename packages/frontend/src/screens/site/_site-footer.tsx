import { NavLink } from "react-router-dom";

export function SiteFooter() {
  return (
    <footer className="py-10" style={{ background: "var(--color-paper-200)", borderTop: "1px solid var(--color-paper-300)" }}>
      <div className="max-w-5xl mx-auto px-6">
        <nav className="flex flex-wrap gap-x-8 gap-y-2 justify-center mb-6">
          <NavLink to="/features" className="text-sm transition hover:opacity-70"
            style={{ color: "var(--color-ink-600)" }}>機能一覧</NavLink>
          <NavLink to="/introduction" className="text-sm transition hover:opacity-70"
            style={{ color: "var(--color-ink-600)" }}>ネットワーク向け導入案内</NavLink>
          <NavLink to="/privacy" className="text-sm transition hover:opacity-70"
            style={{ color: "var(--color-brand)" }}>プライバシーポリシー</NavLink>
        </nav>

        <div className="flex flex-wrap gap-x-6 gap-y-1 justify-center mb-4 text-xs"
          style={{ color: "var(--color-ink-400)" }}>
          <span>
            運営：
            <a href="https://bizolve.jp" target="_blank" rel="noopener noreferrer"
              className="underline hover:opacity-70 transition ml-1">
              株式会社Bizolve Consulting
            </a>
          </span>
          <span className="hidden sm:inline">｜</span>
          <span>
            事業者：
            <a href="https://www.maru-hiro.net/index.html" target="_blank" rel="noopener noreferrer"
              className="underline hover:opacity-70 transition ml-1">
              株式会社丸廣
            </a>
          </span>
        </div>

        <p className="text-center text-xs" style={{ color: "var(--color-paper-400)" }}>
          &copy; 2026 BizQuest / Bizolve Consulting. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
