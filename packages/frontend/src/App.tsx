import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { AuthGuard, AdminGuard } from "@/components/auth-guard";
import { AppLayout } from "@/components/layout";
import { LoginScreen } from "@/screens/auth/login-screen";
import { RegisterScreen } from "@/screens/auth/register-screen";
import { HomeScreen } from "@/screens/home/home-screen";
import { MembersScreen } from "@/screens/members/members-screen";
import { MemberDetailScreen } from "@/screens/members/member-detail-screen";
import { QuestsScreen } from "@/screens/quests/quests-screen";
import { RankingScreen } from "@/screens/ranking/ranking-screen";
import { MypageScreen } from "@/screens/mypage/mypage-screen";
import { AdminLayout } from "@/screens/admin/admin-layout";
import { AdminDashboardScreen } from "@/screens/admin/admin-dashboard-screen";
import { AdminMembersScreen } from "@/screens/admin/admin-members-screen";
import { AdminQuestsScreen } from "@/screens/admin/admin-quests-screen";
import { AdminPointsScreen } from "@/screens/admin/admin-points-screen";
import { AdminSettingsScreen } from "@/screens/admin/admin-settings-screen";
import { useMe } from "@/hooks/use-me";

// ログイン済み時にユーザー情報をロードするラッパー
function AppWithMe({ children }: { children: React.ReactNode }) {
  useMe();
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppWithMe>
          <Routes>
            {/* 認証不要 */}
            <Route path="/login" element={<LoginScreen />} />
            <Route path="/register" element={<RegisterScreen />} />

            {/* メンバー向け（要認証） */}
            <Route element={<AuthGuard />}>
              <Route element={<AppLayout />}>
                <Route index element={<HomeScreen />} />
                <Route path="members" element={<MembersScreen />} />
                <Route path="members/:id" element={<MemberDetailScreen />} />
                <Route path="quests" element={<QuestsScreen />} />
                <Route path="ranking" element={<RankingScreen />} />
                <Route path="me" element={<MypageScreen />} />
              </Route>
            </Route>

            {/* 管理者向け（要管理者認証） */}
            <Route path="admin" element={<AdminGuard />}>
              <Route element={<AdminLayout />}>
                <Route index element={<AdminDashboardScreen />} />
                <Route path="members" element={<AdminMembersScreen />} />
                <Route path="quests" element={<AdminQuestsScreen />} />
                <Route path="points" element={<AdminPointsScreen />} />
                <Route path="settings" element={<AdminSettingsScreen />} />
              </Route>
            </Route>

            {/* その他 */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppWithMe>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
