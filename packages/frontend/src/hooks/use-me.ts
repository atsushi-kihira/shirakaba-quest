// アプリ起動時にログイン済みユーザー情報を取得するフック
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

type MeResponse = {
  data: {
    id: string;
    name: string;
    email: string;
    emoji: string;
    bgColor: string;
    userType: "member" | "admin";
    status?: string;
    role?: string;
    avatarImageKey?: string | null;
  };
};

export function useMe() {
  const { token, setAuth, clearAuth } = useAuthStore();

  const query = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<MeResponse>("/auth/me"),
    enabled: !!token,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  useEffect(() => {
    if (query.data?.data) {
      const u = query.data.data;
      setAuth(token!, {
        id: u.id,
        userType: u.userType,
        name: u.name,
        email: u.email,
        emoji: u.emoji,
        bgColor: u.bgColor,
        avatarImageKey: u.avatarImageKey ?? null,
      });
    }
    if (query.error) {
      clearAuth();
    }
  }, [query.data, query.error, token, setAuth, clearAuth]);

  return query;
}
