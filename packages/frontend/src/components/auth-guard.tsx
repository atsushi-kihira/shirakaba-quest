// 認証ガード — 未ログイン時はログイン画面へリダイレクト
import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "@/stores/auth-store";

export function AuthGuard() {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function AdminGuard() {
  const { token, user } = useAuthStore();
  if (!token) return <Navigate to="/login" replace />;
  if (user && user.userType !== "admin") return <Navigate to="/" replace />;
  return <Outlet />;
}
