// =============================================================
// ホーム画面
// =============================================================
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Users, ScrollText, Trophy, QrCode, ChevronRight, ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import { MemberAvatar } from "@/components/member-avatar";
import { useAuthStore } from "@/stores/auth-store";
import { useSettings } from "@/hooks/use-settings";

import type { Season, EventCampaign } from "@shared/types";

type MyRankResponse  = { data: { points: number; rank: number } };
type ActiveSeasonResponse = { data: Season | null };
type ActiveEvent = EventCampaign & { relatedMemberName?: string | null; relatedMemberEmoji?: string | null };
type ActiveEventsResponse = { data: ActiveEvent[] };
type OnoSession = {
  id: string;
  status: string;
  myRole: string;
  requesterCompletedAt: number | null;
  responderCompletedAt: number | null;
  partner: { id: string; name: string; emoji: string; bgColor: string; category: string } | null;
};
type OnoListResponse  = { data: OnoSession[] };
type QuestsResponse   = { data: Array<{ id: string; title: string; emoji: string; reward: number; skillCount: number }> };

export function HomeScreen() {
  const user = useAuthStore((s) => s.user);
  const { termQuest, termUsp, characterImageUrl, appTitle } = useSettings();
  const [seasonExpanded, setSeasonExpanded] = useState(false);
  const [pointsExpanded, setPointsExpanded] = useState(false);

  const { data: rankData } = useQuery({
    queryKey: ["ranking", "me"],
    queryFn: () => api.get<MyRankResponse>("/ranking/me"),
    enabled: !!user,
  });

  const { data: onoData, isLoading: onoLoading } = useQuery({
    queryKey: ["oneonone"],
    queryFn: () => api.get<OnoListResponse>("/oneonone"),
    enabled: !!user,
    refetchInterval: 30_000, // 30秒ごとに自動更新
  });

  const { data: questData } = useQuery({
    queryKey: ["quests"],
    queryFn: () => api.get<QuestsResponse>("/quests"),
    enabled: !!user,
  });

  const { data: seasonData } = useQuery({
    queryKey: ["season"],
    queryFn: () => api.get<ActiveSeasonResponse>("/season"),
  });

  const { data: eventsData } = useQuery({
    queryKey: ["events", "active"],
    queryFn: () => api.get<ActiveEventsResponse>("/events/active"),
    enabled: !!user,
  });

  type HistoryItem = { id: string; delta: number; reason: string; label: string; detail?: string; createdAt: number };
  const { data: historyData } = useQuery({
    queryKey: ["ranking", "history"],
    queryFn: () => api.get<{ data: HistoryItem[]; totalPoints: number }>("/ranking/history"),
    enabled: !!user && pointsExpanded,
  });

  const rank          = rankData?.data;
  const sessions      = onoData?.data ?? [];
  const quests        = (questData?.data ?? []).slice(0, 2);
  const activeSeason  = seasonData?.data ?? null;
  const activeEvents  = eventsData?.data ?? [];
  const featuredEvent = activeEvents.find((e) => e.type === "featured_member");
  const specialWeek   = activeEvents.find((e) => e.type === "special_quest_week");
  const welcomeEvents = activeEvents.filter((e): e is ActiveEvent => e.type === "welcome_quest");

  // 通知が必要なセッション
  const needAction = sessions.filter((s) => {
    if (s.status === "pending" && s.myRole === "responder") return true; // 承諾待ち
    if (s.status === "accepted") {
      const myDone = s.myRole === "requester" ? s.requesterCompletedAt : s.responderCompletedAt;
      if (!myDone) return true; // 完了ボタン未押下
    }
    return false;
  });

  const pendingApproval = sessions.filter((s) => s.status === "pending" && s.myRole === "responder");
  const waitingComplete = sessions.filter((s) => {
    if (s.status !== "accepted") return false;
    const myDone = s.myRole === "requester" ? s.requesterCompletedAt : s.responderCompletedAt;
    return !myDone;
  });

  return (
    <div className="px-4 py-6 space-y-5 max-w-xl mx-auto lg:max-w-none pb-24">

      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>おかえりなさい 👋</p>
          <h1 className="text-2xl font-semibold mt-0.5" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            {user?.name ?? "メンバー"}さん
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>{appTitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* キャラクター（小） */}
          <img
            src={characterImageUrl}
            alt="キャラクター"
            className="w-14 h-14 object-contain"
            style={{ filter: "drop-shadow(0 2px 6px rgba(181,56,75,0.15))" }}
            onError={(e) => { e.currentTarget.src = "/character-default.png"; }}
          />
          {user && (
            <MemberAvatar
              memberId={user.id}
              emoji={user.emoji ?? "🙂"}
              bgColor={user.bgColor ?? "bg-amber-100"}
              avatarImageKey={user.avatarImageKey}
              size="md"
              rounded="rounded-full"
            />
          )}
        </div>
      </div>

      {/* アクティブシーズン */}
      {activeSeason && (
        <button
          onClick={() => activeSeason.theme && setSeasonExpanded((v) => !v)}
          className="w-full text-left px-4 py-3 rounded-2xl transition active:opacity-80"
          style={{ background: "rgba(181,56,75,0.07)", border: "1px solid rgba(181,56,75,0.2)", cursor: activeSeason.theme ? "pointer" : "default" }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold mb-0.5" style={{ color: "var(--color-brand)" }}>🌸 現在のシーズン</p>
              <p className="font-semibold text-sm" style={{ color: "var(--color-ink-800)" }}>{activeSeason.name}</p>
            </div>
            {activeSeason.theme && (
              <ChevronDown
                size={16}
                className="shrink-0 transition-transform"
                style={{ color: "var(--color-brand)", transform: seasonExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
              />
            )}
          </div>
          {seasonExpanded && activeSeason.theme && (
            <p className="text-sm mt-2 leading-relaxed" style={{ color: "var(--color-ink-700)" }}>{activeSeason.theme}</p>
          )}
        </button>
      )}

      {/* 特別お題ウィーク */}
      {specialWeek && (
        <div className="px-4 py-3 rounded-2xl" style={{ background: "rgba(212,160,59,0.12)", border: "1px solid rgba(212,160,59,0.3)" }}>
          <p className="text-xs font-semibold mb-0.5" style={{ color: "var(--color-accent)" }}>📅 {specialWeek.title}</p>
          {specialWeek.description && <p className="text-sm" style={{ color: "var(--color-ink-700)" }}>{specialWeek.description}</p>}
        </div>
      )}

      {/* 注目メンバー */}
      {featuredEvent && (
        <div className="px-4 py-3 rounded-2xl" style={{ background: "rgba(90,140,92,0.08)", border: "1px solid rgba(90,140,92,0.25)" }}>
          <p className="text-xs font-semibold mb-0.5" style={{ color: "var(--color-success)" }}>⭐ {featuredEvent.title}</p>
          {featuredEvent.description && <p className="text-sm" style={{ color: "var(--color-ink-700)" }}>{featuredEvent.description}</p>}
        </div>
      )}

      {/* 新メンバー歓迎クエスト */}
      {welcomeEvents.length > 0 && (
        <div className="px-4 py-3 rounded-2xl" style={{ background: "rgba(181,56,75,0.07)", border: "1px solid rgba(181,56,75,0.2)" }}>
          <p className="text-xs font-semibold mb-1" style={{ color: "var(--color-brand)" }}>🎉 新メンバー歓迎クエスト実施中！</p>
          {welcomeEvents.map((ev) => (
            <div key={ev.id} className="flex items-center gap-1 flex-wrap">
              {ev.relatedMemberId ? (
                <Link to={`/members/${ev.relatedMemberId}`} className="text-sm font-semibold underline underline-offset-2" style={{ color: "var(--color-brand)" }}>
                  {ev.relatedMemberEmoji} {ev.relatedMemberName ?? ev.title}
                </Link>
              ) : (
                <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>{ev.title}</span>
              )}
              {ev.relatedMemberId && (
                <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>さんが仲間入り！</span>
              )}
            </div>
          ))}
          <p className="text-xs mt-1" style={{ color: "var(--color-ink-500)" }}>1to1完了で +1pt ボーナス！</p>
        </div>
      )}

      {/* 1to1 要対応バナー（承諾待ち・完了待ち） */}
      {needAction.length > 0 && (
        <Link
          to="/oneonone"
          className="flex items-center gap-3 px-4 py-3 rounded-2xl transition active:opacity-80"
          style={{ background: "var(--color-brand)", color: "white" }}
        >
          <span className="text-xl">🤝</span>
          <div className="flex-1">
            <p className="font-semibold text-sm">
              {pendingApproval.length > 0
                ? `${pendingApproval.length}件の1to1申込が届いています`
                : `${waitingComplete.length}件の1to1 — 完了ボタンを押してください`}
            </p>
            <p className="text-xs opacity-80 mt-0.5">タップして確認する</p>
          </div>
          <ChevronRight size={18} />
        </Link>
      )}

      {/* ポイント */}
      <button
        onClick={() => setPointsExpanded((v) => !v)}
        className="w-full text-left card-paper rounded-3xl p-5 transition active:opacity-80"
      >
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-xl">⭐️</span>
            <span className="text-sm font-medium" style={{ color: "var(--color-ink-600)" }}>現在のポイント</span>
          </div>
          <ChevronDown
            size={16}
            className="transition-transform"
            style={{ color: "var(--color-ink-400)", transform: pointsExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
          />
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
          1to1完了・リアルカード交換・{termQuest}クリアで増やそう！
        </p>
        {pointsExpanded && (
          <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--color-paper-300)" }}>
            <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-ink-600)" }}>獲得履歴（直近）</p>
            {!historyData ? (
              <div className="flex justify-center py-3">
                <Loader2 size={18} className="animate-spin" style={{ color: "var(--color-brand)" }} />
              </div>
            ) : historyData.data.length === 0 ? (
              <p className="text-xs text-center py-2" style={{ color: "var(--color-ink-400)" }}>まだポイント履歴がありません</p>
            ) : (
              <div className="space-y-1.5">
                {historyData.data.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-xs" style={{ color: "var(--color-ink-700)" }}>{item.label}</p>
                      {item.detail && <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>{item.detail}</p>}
                    </div>
                    <span className="text-sm font-bold shrink-0 ml-2" style={{ color: item.delta >= 0 ? "var(--color-accent)" : "var(--color-brand)" }}>
                      {item.delta >= 0 ? "+" : ""}{item.delta}pt
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </button>

      {/* 進行中の1to1（ローディング中） */}
      {onoLoading && (
        <div className="flex justify-center py-4">
          <Loader2 size={20} className="animate-spin" style={{ color: "var(--color-brand)" }} />
        </div>
      )}

      {/* 承諾待ちセッション（受け取り） */}
      {pendingApproval.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
            📬 1to1 申込が届いています
          </h2>
          <div className="space-y-2">
            {pendingApproval.map((s) => (
              <Link
                key={s.id}
                to="/oneonone"
                className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80"
                style={{ borderLeft: "3px solid var(--color-brand)" }}
              >
                {s.partner && (
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${s.partner.bgColor}`}>
                    {s.partner.emoji}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "var(--color-ink-800)" }}>
                    {s.partner?.name ?? "？"}さんから申込
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>承諾・断るを選択してください</p>
                </div>
                <ChevronRight size={16} style={{ color: "var(--color-brand)" }} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 完了待ちセッション */}
      {waitingComplete.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-success)" }}>
            🤝 1to1 完了を記録しよう
          </h2>
          <div className="space-y-2">
            {waitingComplete.map((s) => (
              <Link
                key={s.id}
                to="/oneonone"
                className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80"
                style={{ borderLeft: "3px solid var(--color-success)" }}
              >
                {s.partner && (
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${s.partner.bgColor}`}>
                    {s.partner.emoji}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "var(--color-ink-800)" }}>
                    {s.partner?.name ?? "？"}さん との1to1
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>完了ボタンを押すと +1pt</p>
                </div>
                <ChevronRight size={16} style={{ color: "var(--color-success)" }} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 公開中のお題 */}
      {quests.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
              📜 挑戦できる{termQuest}
            </h2>
            <Link to="/quests" className="text-xs" style={{ color: "var(--color-brand)" }}>
              すべて見る →
            </Link>
          </div>
          <div className="space-y-2">
            {quests.map((q) => (
              <Link key={q.id} to="/quests"
                className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80">
                <span className="text-2xl">{q.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{q.title}</p>
                  <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>{termUsp}{q.skillCount}個 · +{q.reward}pt</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* クイックアクション */}
      <section>
        <h2 className="text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-700)" }}>
          🎮 やること
        </h2>
        <div className="grid grid-cols-1 gap-2">
          <QuickLink to="/members"  icon={<Users size={18} />}      label="なかまを探して1to1しよう" sub="+1pt"  color="var(--color-brand)" />
          <QuickLink to="/quests"   icon={<ScrollText size={18} />} label={`${termQuest}に挑戦しよう`} sub="+5pt〜" color="var(--color-success)" />
          <QuickLink to="/team"     icon={<span className="text-base">🦊</span>} label="チームの活動を確認しよう" sub="" color="var(--color-accent)" />
          <QuickLink to="/ranking"  icon={<Trophy size={18} />}     label="ランキングをチェック"      sub=""       color="var(--color-accent)" />
          <QuickLink to="/me"       icon={<QrCode size={18} />}     label="自分のQRを表示してカードを渡す" sub="🃏"  color="var(--color-ink-500)" />
        </div>
      </section>
    </div>
  );
}

function QuickLink({ to, icon, label, sub, color }: { to: string; icon: React.ReactNode; label: string; sub: string; color: string }) {
  return (
    <Link to={to}
      className="card-paper rounded-2xl px-4 py-3 flex items-center gap-3 transition active:opacity-80 active:scale-[0.98]">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: color + "20", color }}>
        {icon}
      </div>
      <span className="flex-1 text-sm font-medium" style={{ color: "var(--color-ink-700)" }}>{label}</span>
      {sub && <span className="text-xs font-bold" style={{ color: "var(--color-accent)" }}>{sub}</span>}
    </Link>
  );
}
