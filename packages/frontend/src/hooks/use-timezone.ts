// =============================================================
// タイムゾーンフック
// メンバー個人のタイムゾーン → システム設定のタイムゾーン → Asia/Tokyo の優先順で返す
// =============================================================
import { useAuthStore } from "@/stores/auth-store";
import { useSettings } from "./use-settings";

export function useTimezone(): string {
  const user = useAuthStore((s) => s.user);
  const { timezone: systemTz } = useSettings();
  if (user?.userType === "member" && user.timezone) return user.timezone;
  return systemTz || "Asia/Tokyo";
}
