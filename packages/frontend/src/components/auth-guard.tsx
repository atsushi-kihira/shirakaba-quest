// 認証ガード — 未ログイン時はログイン画面へリダイレクト
import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore, isApprovedMember } from "@/stores/auth-store";
import { AppLayout } from "@/components/layout";

export function AuthGuard() {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function AdminGuard() {
  const { token, user } = useAuthStore();
  // 未ログイン → 管理者ログイン画面へ（redirect パラメータ付き）
  if (!token) return <Navigate to="/login?redirect=/admin" replace />;
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
  const user = useAuthStore((s) => s.user);
  if (!isApprovedMember(user)) return <Navigate to="/home" replace />;
  return <Outlet />;
}
