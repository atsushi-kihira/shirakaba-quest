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
import { MeetingsScreen } from "@/screens/meetings/meetings-screen";
import { MeetingNewScreen } from "@/screens/meetings/meeting-new-screen";
import { MeetingDetailScreen } from "@/screens/meetings/meeting-detail-screen";
import { ScheduleScreen } from "@/screens/schedule/schedule-screen";
import { AdminLayout } from "@/screens/admin/admin-layout";
import { AdminDashboardScreen } from "@/screens/admin/admin-dashboard-screen";
import { AdminMembersScreen } from "@/screens/admin/admin-members-screen";
import { AdminQuestsScreen } from "@/screens/admin/admin-quests-screen";
import { AdminPointsScreen } from "@/screens/admin/admin-points-screen";
import { AdminSettingsScreen } from "@/screens/admin/admin-settings-screen";
import { AdminUspsScreen } from "@/screens/admin/admin-usps-screen";
import { AdminSeasonsScreen } from "@/screens/admin/admin-seasons-screen";
import { AdminEventTypesScreen } from "@/screens/admin/admin-event-types-screen";
import { EventsScreen } from "@/screens/events/events-screen";
import { EventDetailScreen } from "@/screens/events/event-detail-screen";
import { AdminTeamsScreen } from "@/screens/admin/admin-teams-screen";
import { AdminMeetingsScreen } from "@/screens/admin/admin-meetings-screen";
import { SchedulerDashboardScreen } from "@/screens/scheduler/scheduler-dashboard-screen";
import { SchedulerIntegrationsScreen } from "@/screens/scheduler/scheduler-integrations-screen";
import { SchedulerSettingsScreen } from "@/screens/scheduler/scheduler-settings-screen";
import { SchedulerBookingsScreen } from "@/screens/scheduler/scheduler-bookings-screen";
import { SchedulerBookingDetailScreen } from "@/screens/scheduler/scheduler-booking-detail-screen";
import { PublicBookingPage } from "@/screens/public-booking/public-booking-page";
import { PublicBookingForm } from "@/screens/public-booking/public-booking-form";
import { PublicBookingConfirmation } from "@/screens/public-booking/public-booking-confirmation";
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

            {/* 外部ゲスト向け日程回答（認証不要） */}
            <Route path="/schedule/:token" element={<ScheduleScreen />} />

            {/* 1on1 スケジューラー公開予約ページ（認証不要） */}
            <Route path="/book/confirmation/:token" element={<PublicBookingConfirmation />} />
            <Route path="/book/:memberSlug/form" element={<PublicBookingForm />} />
            <Route path="/book/:memberSlug" element={<PublicBookingPage />} />

            {/* メンバー向け（要認証） */}
            <Route element={<AuthGuard />}>
              <Route element={<AppLayout />}>
                <Route index element={<HomeScreen />} />
                <Route path="members" element={<MembersScreen />} />
                <Route path="members/:id" element={<MemberDetailScreen />} />
                <Route path="quests" element={<QuestsScreen />} />
                <Route path="ranking" element={<RankingScreen />} />
                <Route path="me" element={<MypageScreen />} />
                <Route path="team" element={<Navigate to="/members" replace />} />
                <Route path="events" element={<EventsScreen />} />
                <Route path="events/:id" element={<EventDetailScreen />} />
                <Route path="oneonone" element={<OneOnOneScreen />} />
                <Route path="meetings" element={<MeetingsScreen />} />
                <Route path="meetings/new" element={<MeetingNewScreen />} />
                <Route path="meetings/:id" element={<MeetingDetailScreen />} />
                {/* 1on1 スケジューラー（ホスト向け） */}
                <Route path="scheduler" element={<SchedulerDashboardScreen />} />
                <Route path="scheduler/integrations" element={<SchedulerIntegrationsScreen />} />
                <Route path="scheduler/settings" element={<SchedulerSettingsScreen />} />
                <Route path="scheduler/bookings" element={<SchedulerBookingsScreen />} />
                <Route path="scheduler/bookings/:id" element={<SchedulerBookingDetailScreen />} />
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
                <Route path="events" element={<Navigate to="/admin/event-types" replace />} />
                <Route path="event-types" element={<AdminEventTypesScreen />} />
                <Route path="teams" element={<AdminTeamsScreen />} />
                <Route path="meetings" element={<AdminMeetingsScreen />} />
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
