// 認証ガード — 未ログイン時はログイン画面へリダイレクト
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuthStore, isApprovedMember } from "@/stores/auth-store";
import { AppLayout } from "@/components/layout";

// 未ログイン時のログイン画面への遷移先。ログイン後に元の画面へ戻れるよう、
// 今アクセスしようとしていたURL（パス＋クエリ）を redirect パラメータに載せる。
function loginRedirectTo(location: { pathname: string; search: string }) {
  const target = `${location.pathname}${location.search}`;
  return `/login?redirect=${encodeURIComponent(target)}`;
}

export function AuthGuard() {
  const token = useAuthStore((s) => s.token);
  const location = useLocation();
  if (!token) return <Navigate to={loginRedirectTo(location)} replace />;
  return <Outlet />;
}

export function AdminGuard() {
  const { token, user } = useAuthStore();
  const location = useLocation();
  // 未ログイン → 管理者ログイン画面へ（redirect パラメータ付き）
  if (!token) return <Navigate to={loginRedirectTo(location)} replace />;
  // 管理者以外がアクセス → 一般ホームへ
  if (user && user.userType !== "admin") return <Navigate to="/" replace />;
  return <Outlet />;
}

// ログイン済みメンバーには AppLayout（ナビ付き）、未ログインはナビなしで表示
export function MemberAwareLayout() {
  const token = useAuthStore((s) => s.token);
  if (token) return <AppLayout />;
  return <Outlet />;
}

// 承認待ち（ゲスト）のメンバーはアクセスできない画面用のガード。
// ナビ側では非活性表示にしているが、URL直打ちで来た場合の保険としてホームへ戻す。
export function ApprovedMemberGuard() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  // AuthGuard を通過済み＝token はあるが、user 情報（承認状態）が
  // まだ /auth/me から取得できていない一瞬（ログイン直後・リロード直後）に
  // 「未承認」と早合点してホームへ弾いてしまわないよう、確定するまで待つ。
  if (token && !user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
      </div>
    );
  }
  if (!isApprovedMember(user)) return <Navigate to="/home" replace />;
  return <Outlet />;
}
