// =============================================================
// マイページ — プロフィール・QRコード・ポイント・スキル
// =============================================================
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, LogOut, QrCode, X, ChevronRight } from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import QRCode from "qrcode";
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
  const [showQr, setShowQr] = useState(false);

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
    <div className="px-4 py-6 max-w-xl mx-auto pb-24">
      {/* ヘッダー */}
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          👤 マイページ
        </h1>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl"
          style={{ color: "var(--color-ink-400)", background: "var(--color-paper-200)" }}
        >
          <LogOut size={14} />
          ログアウト
        </button>
      </div>

      {/* プロフィールカード */}
      <div className="card-paper rounded-3xl p-5 mb-4">
        <div className="flex items-center gap-4 mb-4">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-4xl shrink-0 ${member?.bgColor ?? user?.bgColor ?? "bg-amber-100"}`}>
            {member?.emoji ?? user?.emoji ?? "🙂"}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-semibold truncate" style={{ fontFamily: "var(--font-klee)" }}>
              {member?.name ?? user?.name}
            </h2>
            {member?.furigana && (
              <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>{member.furigana}</p>
            )}
            {member?.category && (
              <p className="text-sm font-medium mt-0.5" style={{ color: "var(--color-ink-600)" }}>{member.category}</p>
            )}
          </div>
        </div>

        {member?.businessDescription && (
          <p className="text-sm leading-relaxed mb-4" style={{ color: "var(--color-ink-700)" }}>
            {member.businessDescription}
          </p>
        )}

        {/* QRコードボタン */}
        {memberId && (
          <button
            onClick={() => setShowQr(true)}
            className="w-full py-3 rounded-2xl flex items-center justify-center gap-2 font-medium text-sm transition active:opacity-80"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}
          >
            <QrCode size={18} />
            自分のQRコードを表示
          </button>
        )}
      </div>

      {/* ポイント・順位 */}
      {rank && (
        <div className="card-paper rounded-3xl p-5 mb-4">
          <h2 className="text-base font-semibold mb-3" style={{ fontFamily: "var(--font-klee)" }}>⭐ ポイント</h2>
          <div className="flex items-end gap-4">
            <div className="text-4xl font-bold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-accent)" }}>
              {rank.points}
              <span className="text-lg ml-1">pt</span>
            </div>
            <div className="text-sm pb-1" style={{ color: "var(--color-ink-500)" }}>
              現在 <span className="font-bold text-lg" style={{ color: "var(--color-ink-800)" }}>{rank.rank}</span> 位
            </div>
          </div>
        </div>
      )}

      {/* スキル */}
      {member?.skills && member.skills.length > 0 && (
        <div className="card-paper rounded-3xl p-5 mb-4">
          <h2 className="text-base font-semibold mb-3" style={{ fontFamily: "var(--font-klee)" }}>✨ 私のスキル</h2>
          <div className="space-y-3">
            {member.skills.map((skill: Skill) => (
              <div key={skill.name} className="flex items-start gap-3">
                <span className="text-xs px-2.5 py-1 rounded-full ring-1 font-medium shrink-0"
                  style={{ background: "var(--color-paper-200)", color: "var(--color-brand)" }}>
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

      {/* 1to1 管理リンク */}
      <Link
        to="/oneonone"
        className="card-paper rounded-3xl p-4 flex items-center gap-3 active:opacity-80 transition"
      >
        <span className="text-2xl">🤝</span>
        <div className="flex-1">
          <div className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>1to1 の記録</div>
          <div className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>申込・承諾・完了の確認</div>
        </div>
        <ChevronRight size={18} style={{ color: "var(--color-ink-400)" }} />
      </Link>

      {/* QRコードモーダル */}
      {showQr && memberId && (
        <QrModal memberId={memberId} memberName={member?.name ?? user?.name ?? ""} onClose={() => setShowQr(false)} />
      )}
    </div>
  );
}

// ================================================================
// QRコードモーダル
// ================================================================
function QrModal({ memberId, memberName, onClose }: { memberId: string; memberName: string; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrUrl, setQrUrl] = useState<string>("");

  useEffect(() => {
    const url = `${window.location.origin}/receive-card/${memberId}`;
    QRCode.toDataURL(url, {
      width: 280,
      margin: 2,
      color: { dark: "#1A1410", light: "#FAF5E8" },
    }).then((dataUrl) => setQrUrl(dataUrl));
  }, [memberId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="card-paper w-full max-w-sm rounded-t-3xl p-6 pb-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-semibold text-lg" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
              🃏 マイカード QR
            </h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
              このQRを相手にスキャンしてもらうと<br />リアルカードの受け取りが記録されます
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full" style={{ background: "var(--color-paper-200)" }}>
            <X size={18} style={{ color: "var(--color-ink-500)" }} />
          </button>
        </div>

        {/* QRコード */}
        <div className="flex flex-col items-center gap-4">
          {qrUrl ? (
            <div className="p-4 rounded-3xl" style={{ background: "#FAF5E8", border: "2px solid var(--color-paper-300)" }}>
              <img src={qrUrl} alt="QRコード" width={220} height={220} />
            </div>
          ) : (
            <div className="w-56 h-56 rounded-3xl flex items-center justify-center"
              style={{ background: "var(--color-paper-200)" }}>
              <Loader2 size={32} className="animate-spin" style={{ color: "var(--color-brand)" }} />
            </div>
          )}
          <canvas ref={canvasRef} className="hidden" />
          <div className="text-center">
            <p className="font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
              {memberName}
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
              相手のスマホカメラで読み取ってください
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
