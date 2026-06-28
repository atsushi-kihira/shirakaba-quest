// =============================================================
// 認証ストア（Zustand）
// =============================================================
import { create } from "zustand";
import type { UserType } from "@shared/types";

type AuthUser = {
  id: string;
  userType: UserType;
  name: string;
  email: string;
  emoji: string;
  bgColor: string;
  avatarImageKey?: string | null;
  timezone?: string | null;
};

type AuthStore = {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean;
  setAuth: (token: string, user: AuthUser) => void;
  clearAuth: () => void;
  setLoading: (v: boolean) => void;
};

export const useAuthStore = create<AuthStore>((set) => ({
  token: localStorage.getItem("auth_token"),
  user: null,
  isLoading: false,

  setAuth: (token, user) => {
    localStorage.setItem("auth_token", token);
    set({ token, user });
  },

  clearAuth: () => {
    localStorage.removeItem("auth_token");
    set({ token: null, user: null });
  },

  setLoading: (v) => set({ isLoading: v }),
}));
