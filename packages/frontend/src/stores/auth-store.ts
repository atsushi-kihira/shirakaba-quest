// =============================================================
// 認証ストア（Zustand）
// =============================================================
import { create } from "zustand";
import type { UserType } from "@shared/types";
import { queryClient } from "@/lib/query-client";

type AuthUser = {
  id: string;
  userType: UserType;
  name: string;
  email: string;
  emoji: string;
  bgColor: string;
  avatarImageKey?: string | null;
  timezone?: string | null;
  isPilot1?: boolean;
  isPilot2?: boolean;
  personalTheme?: string | null;
  businessCommunityJoinedDate?: string | null;
};

type AuthStore = {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean;
  setAuth: (token: string, user: AuthUser) => void;
  clearAuth: () => void;
  setLoading: (v: boolean) => void;
};

export const useAuthStore = create<AuthStore>((set, get) => ({
  token: localStorage.getItem("auth_token"),
  user: null,
  isLoading: false,

  setAuth: (token, user) => {
    // 端末を共有していて、直前まで別のメンバーがログインしていた場合に、
    // そのメンバーのキャッシュ済みデータ（スケジューラーの公開URLなど）が
    // 新しいログインユーザーの画面に一瞬でも表示されてしまう事故を防ぐため、
    // ログインユーザーが切り替わったタイミングでキャッシュを必ず破棄する。
    const prevUserId = get().user?.id;
    localStorage.setItem("auth_token", token);
    set({ token, user });
    if (prevUserId && prevUserId !== user.id) {
      queryClient.clear();
    }
  },

  clearAuth: () => {
    localStorage.removeItem("auth_token");
    set({ token: null, user: null });
    queryClient.clear();
  },

  setLoading: (v) => set({ isLoading: v }),
}));
