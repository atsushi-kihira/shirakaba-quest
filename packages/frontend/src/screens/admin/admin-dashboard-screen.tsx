// =============================================================
// 管理ダッシュボード
// =============================================================
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";

type Member = { id: string; status: string; name: string };
type Quest = { id: string; status: string; title: string };
type EventTypeDef = { id: string; isActive: number };
type EventInstance = { id: string; status: string };

export function AdminDashboardScreen() {
  const { termQuest } = useSettings();
  const { data: membersData } = useQuery({
    queryKey: ["admin", "members"],
    queryFn: () => api.get<{ data: Member[] }>("/admin/members"),
  });

  const { data: questsData } = useQuery({
    queryKey: ["admin", "quests"],
    queryFn: () => api.get<{ data: Quest[] }>("/admin/quests"),
  });

  const { data: eventTypeDefsData } = useQuery({
    queryKey: ["admin", "event-type-definitions"],
    queryFn: () => api.get<{ data: EventTypeDef[] }>("/admin/event-type-definitions"),
  });

  const { data: eventInstancesData } = useQuery({
    queryKey: ["admin", "events"],
    queryFn: () => api.get<{ data: EventInstance[] }>("/admin/events"),
  });

  const members = membersData?.data ?? [];
  const quests = questsData?.data ?? [];
  const eventTypeDefs = eventTypeDefsData?.data ?? [];
  const eventInstances = eventInstancesData?.data ?? [];

  const pendingCount  = members.filter((m) => m.status === "pending").length;
  const activeCount   = members.filter((m) => m.status === "active").length;
  const publishedQuests = quests.filter((q) => q.status === "published").length;
  const draftQuests   = quests.filter((q) => q.status === "draft").length;
  const activeTypeDefsCount = eventTypeDefs.filter((t) => t.isActive).length;
  const activeInstancesCount = eventInstances.filter((i) => i.status === "active").length;

  const cards = [
    {
      to: "/admin/members",
      icon: "👥",
      label: "メンバー管理",
      stats: [
        { label: "承認待ち", value: pendingCount, urgent: pendingCount > 0 },
        { label: "アクティブ", value: activeCount, urgent: false },
      ],
    },
    {
      to: "/admin/quests",
      icon: "📜",
      label: `${termQuest}管理`,
      stats: [
        { label: "公開中", value: publishedQuests, urgent: false },
        { label: "下書き", value: draftQuests, urgent: false },
      ],
    },
    {
      to: "/admin/event-types",
      icon: "📣",
      label: "イベント管理",
      stats: [
        { label: "イベント種別", value: activeTypeDefsCount, urgent: false },
        { label: "実施中", value: activeInstancesCount, urgent: false },
      ],
    },
    {
      to: "/admin/points",
      icon: "🔄",
      label: "ポイントリセット",
      stats: [],
    },
    {
      to: "/admin/settings",
      icon: "⚙️",
      label: "アプリ設定",
      stats: [],
    },
  ];

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-24">
      <h1 className="text-2xl font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
        ⚙️ 管理ダッシュボード
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-ink-500)" }}>
        白樺クエストの運営管理
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map((card) => (
          <Link
            key={card.to}
            to={card.to}
            className="card-paper p-5 flex items-center gap-4 hover:opacity-90 transition-opacity"
          >
            <span className="text-3xl">{card.icon}</span>
            <div className="flex-1">
              <div className="font-semibold text-base mb-1"
                style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-800)" }}>
                {card.label}
              </div>
              {card.stats.length > 0 && (
                <div className="flex gap-4">
                  {card.stats.map((s) => (
                    <div key={s.label} className="text-sm">
                      <span
                        className="font-bold mr-1"
                        style={{ color: s.urgent ? "var(--color-brand)" : "var(--color-ink-700)" }}
                      >
                        {s.value}
                      </span>
                      <span style={{ color: "var(--color-ink-500)" }}>{s.label}</span>
                      {s.urgent && s.value > 0 && (
                        <span className="ml-1 text-xs px-1.5 py-0.5 rounded-full text-white"
                          style={{ background: "var(--color-brand)" }}>!</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <ChevronRight size={18} style={{ color: "var(--color-ink-400)" }} />
          </Link>
        ))}
      </div>

      <div className="mt-6 card-paper p-4">
        <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
          💡 新しいメンバーが登録申請したときは「メンバー管理」から承認してください。
        </p>
      </div>
    </div>
  );
}
