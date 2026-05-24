// =============================================================
// マイページ
// =============================================================
import { useQuery } from "@tanstack/react-query";
import { Loader2, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { queryClient } from "@/lib/query-client";
import { buildSkillDescription } from "@shared/types";
import type { PublicMember, Skill } from "@shared/types";

type MeResponse = { data: { id: string; name: string; email: string; emoji: string; bgColor: string; userType: string } };
type MemberResponse = { data: PublicMember };
type MyRankResponse = { data: { points: number; rank: number } };

export function MypageScreen() {
  const navigate = useNavigate();
  const { user, clearAuth } = useAuthStore();

  const { data: meData } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<MeResponse>("/auth/me"),
  });

  const memberId = meData?.data?.id ?? user?.id;

  const { data: memberData, isLoading } = useQuery({
    queryKey: ["member", memberId],
    queryFn: () => api.get<MemberResponse>(`/members/${memberId}`),
    enabled: !!memberId && meData?.data?.userType === "member",
  });

  const { data: rankData } = useQuery({
    queryKey: ["ranking", "me"],
    queryFn: () => api.get<MyRankResponse>("/ranking/me"),
    enabled: meData?.data?.userType === "member",
  });

  async function handleLogout() {
    await api.post("/auth/logout").catch(() => {});
    clearAuth();
    queryClient.clear();
    navigate("/login");
  }

  const member = memberData?.data;
  const rank = rankData?.data;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-64">
        <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
      </div>
    );
  }

  return (
    <div className="px-4 py-6 max-w-xl mx-auto">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          👤 マイページ
        </h1>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl transition"
          style={{ color: "var(--color-ink-400)", background: "var(--color-paper-200)" }}
        >
          <LogOut size={14} />
          ログアウト
        </button>
      </div>

      {/* プロフィール */}
      <div className="card-paper rounded-3xl p-6 mb-4">
        <div className="flex items-center gap-4">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-4xl ${member?.bgColor ?? user?.bgColor ?? "bg-amber-100"}`}>
            {member?.emoji ?? user?.emoji ?? "🙂"}
          </div>
          <div>
            <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-klee)" }}>
              {member?.name ?? user?.name}
            </h2>
            <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
              {member?.furigana}
            </p>
            {member?.category && (
              <p className="text-sm font-medium mt-1" style={{ color: "var(--color-ink-600)" }}>
                {member.category}
              </p>
            )}
          </div>
        </div>

        {member?.businessDescription && (
          <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--color-ink-700)" }}>
            {member.businessDescription}
          </p>
        )}
      </div>

      {/* ポイント・順位 */}
      {rank && (
        <div className="card-paper rounded-3xl p-5 mb-4">
          <h2 className="text-base font-semibold mb-3" style={{ fontFamily: "var(--font-klee)" }}>⭐ ポイント</h2>
          <div className="flex items-end gap-4">
            <div>
              <div className="text-4xl font-bold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-accent)" }}>
                {rank.points}
                <span className="text-lg ml-1">pt</span>
              </div>
            </div>
            <div className="text-sm" style={{ color: "var(--color-ink-500)" }}>
              現在 <span className="font-bold text-lg" style={{ color: "var(--color-ink-800)" }}>{rank.rank}</span> 位
            </div>
          </div>
        </div>
      )}

      {/* スキル */}
      {member?.skills && member.skills.length > 0 && (
        <div className="card-paper rounded-3xl p-5">
          <h2 className="text-base font-semibold mb-3" style={{ fontFamily: "var(--font-klee)" }}>✨ 私のスキル</h2>
          <div className="space-y-3">
            {member.skills.map((skill: Skill) => (
              <div key={skill.name} className="flex items-start gap-3">
                <span className={`text-xs px-2.5 py-1 rounded-full ring-1 font-medium shrink-0 ${skill.color}`}>
                  {skill.emoji} {skill.name}
                </span>
                <p className="text-xs leading-relaxed pt-0.5" style={{ color: "var(--color-ink-600)" }}>
                  {buildSkillDescription(skill)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
