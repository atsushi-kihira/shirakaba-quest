// =============================================================
// ホーム画面
// =============================================================
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Users, ScrollText, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

type MyRankResponse = { data: { points: number; rank: number } };
type OnoSession = { id: string; status: string; myRole: string; partner: { name: string; emoji: string; bgColor: string } | null };
type OnoListResponse = { data: OnoSession[] };
type QuestsResponse = { data: Array<{ id: string; title: string; emoji: string; reward: number; skillCount: number }> };

export function HomeScreen() {
  const user = useAuthStore((s) => s.user);

  const { data: rankData } = useQuery({
    queryKey: ["ranking", "me"],
    queryFn: () => api.get<MyRankResponse>("/ranking/me"),
    enabled: !!user,
  });

  const { data: onoData, isLoading: onoLoading } = useQuery({
    queryKey: ["oneonone"],
    queryFn: () => api.get<OnoListResponse>("/oneonone"),
    enabled: !!user,
  });

  const { data: questData } = useQuery({
    queryKey: ["quests"],
    queryFn: () => api.get<QuestsResponse>("/quests"),
    enabled: !!user,
  });

  const rank = rankData?.data;
  const sessions = onoData?.data ?? [];
  const pendingSessions = sessions.filter((s) => s.status === "pending" || s.status === "accepted");
  const quests = (questData?.data ?? []).slice(0, 2);

  return (
    <div className="px-4 py-6 space-y-5 max-w-xl mx-auto lg:max-w-none">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>おかえりなさい 👋</p>
          <h1 className="text-2xl font-semibold mt-0.5" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            {user?.name ?? "メンバー"}さん
          </h1>
        </div>
        <div className={`w-11 h-11 rounded-full flex items-center justify-center text-2xl ${user?.bgColor ?? "bg-amber-100"}`}>
          {user?.emoji ?? "🙂"}
        </div>
      </div>

      {/* ポイント */}
      <div className="card-paper rounded-3xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">⭐️</span>
          <span className="text-sm font-medium" style={{ color: "var(--color-ink-600)" }}>現在のポイント</span>
        </div>
        {rank ? (
          <div className="flex items-end gap-3">
            <div className="text-5xl font-bold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-accent)" }}>
              {rank.points}
              <span className="text-xl ml-1">pt</span>
            </div>
            <p className="text-sm mb-1" style={{ color: "var(--color-ink-500)" }}>
              現在 <span className="font-bold" style={{ color: "var(--color-ink-800)" }}>{rank.rank}</span> 位
            </p>
          </div>
        ) : (
          <div className="text-5xl font-bold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-accent)" }}>
            0<span className="text-xl ml-1">pt</span>
          </div>
        )}
        <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
          1to1やお題で増やそう！
        </p>
      </div>

      {/* 進行中の1to1 */}
      {onoLoading && (
        <div className="flex justify-center py-4">
          <Loader2 size={20} className="animate-spin" style={{ color: "var(--color-brand)" }} />
        </div>
      )}
      {pendingSessions.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
            🤝 進行中の1to1
          </h2>
          <div className="space-y-2">
            {pendingSessions.map((s) => (
              <div key={s.id} className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3">
                {s.partner && (
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xl ${s.partner.bgColor}`}>
                    {s.partner.emoji}
                  </div>
                )}
                <div className="flex-1">
                  <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>
                    {s.partner?.name ?? "相手"}
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
                    {s.status === "pending" ? "承諾待ち..." : "承諾済み・完了ボタンを押そう"}
                  </p>
                </div>
                <Link to="/members"
                  className="text-xs px-3 py-1.5 rounded-xl font-medium"
                  style={{ background: "var(--color-brand)", color: "white" }}>
                  詳細
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 公開中のお題 */}
      {quests.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
              📜 挑戦できるお題
            </h2>
            <Link to="/quests" className="text-xs" style={{ color: "var(--color-brand)" }}>
              すべて見る →
            </Link>
          </div>
          <div className="space-y-2">
            {quests.map((q) => (
              <Link key={q.id} to="/quests"
                className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 block transition hover:opacity-90">
                <span className="text-2xl">{q.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{q.title}</p>
                  <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>スキル{q.skillCount}個 · +{q.reward}pt</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* クイックアクション */}
      <div>
        <h2 className="text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
          🎮 やること
        </h2>
        <div className="grid grid-cols-1 gap-2">
          <QuickLink to="/members" icon={<Users size={18} />} label="なかまを探して1to1しよう" sub="+1pt" color="var(--color-brand)" />
          <QuickLink to="/quests"  icon={<ScrollText size={18} />} label="お題に挑戦しよう" sub="+5pt〜" color="var(--color-success)" />
          <QuickLink to="/ranking" icon={<Trophy size={18} />} label="ランキングをチェック" sub="" color="var(--color-accent)" />
        </div>
      </div>
    </div>
  );
}

function QuickLink({ to, icon, label, sub, color }: { to: string; icon: React.ReactNode; label: string; sub: string; color: string }) {
  return (
    <Link to={to}
      className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition hover:opacity-90 active:scale-[0.98]">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: color + "20", color }}>
        {icon}
      </div>
      <span className="text-sm font-medium flex-1" style={{ color: "var(--color-ink-700)" }}>{label}</span>
      {sub && <span className="text-xs font-bold" style={{ color: "var(--color-accent)" }}>{sub}</span>}
    </Link>
  );
}
