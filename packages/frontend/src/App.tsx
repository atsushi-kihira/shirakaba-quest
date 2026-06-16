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
import { OneOnOneScreen } from "@/screens/oneonone/oneonone-screen";
import { ReceiveCardScreen } from "@/screens/cards/receive-card-screen";
import { AdminLayout } from "@/screens/admin/admin-layout";
import { AdminDashboardScreen } from "@/screens/admin/admin-dashboard-screen";
import { AdminMembersScreen } from "@/screens/admin/admin-members-screen";
import { AdminQuestsScreen } from "@/screens/admin/admin-quests-screen";
import { AdminPointsScreen } from "@/screens/admin/admin-points-screen";
import { AdminSettingsScreen } from "@/screens/admin/admin-settings-screen";
import { AdminUspsScreen } from "@/screens/admin/admin-usps-screen";
import { AdminSeasonsScreen } from "@/screens/admin/admin-seasons-screen";
import { AdminEventsScreen } from "@/screens/admin/admin-events-screen";
import { AdminTeamsScreen } from "@/screens/admin/admin-teams-screen";
import { useMe } from "@/hooks/use-me";

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

            {/* リアルカード受け取り（ログイン必要だが AppLayout 外） */}
            <Route path="/receive-card/:memberId" element={<ReceiveCardScreen />} />

            {/* メンバー向け（要認証） */}
            <Route element={<AuthGuard />}>
              <Route element={<AppLayout />}>
                <Route index element={<HomeScreen />} />
                <Route path="members" element={<MembersScreen />} />
                <Route path="members/:id" element={<MemberDetailScreen />} />
                <Route path="quests" element={<QuestsScreen />} />
                <Route path="ranking" element={<RankingScreen />} />
                <Route path="me" element={<MypageScreen />} />
                <Route path="oneonone" element={<OneOnOneScreen />} />
              </Route>
            </Route>

            {/* 管理者向け（要管理者認証） */}
            <Route path="admin" element={<AdminGuard />}>
              <Route element={<AdminLayout />}>
                <Route index element={<AdminDashboardScreen />} />
                <Route path="members" element={<AdminMembersScreen />} />
                <Route path="usps" element={<AdminUspsScreen />} />
                <Route path="quests" element={<AdminQuestsScreen />} />
                <Route path="seasons" element={<AdminSeasonsScreen />} />
                <Route path="events" element={<AdminEventsScreen />} />
                <Route path="teams" element={<AdminTeamsScreen />} />
                <Route path="points" element={<AdminPointsScreen />} />
                <Route path="settings" element={<AdminSettingsScreen />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppWithMe>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
