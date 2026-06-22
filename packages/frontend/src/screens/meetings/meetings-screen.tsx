// =============================================================
// ミーティング一覧画面
// =============================================================
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Calendar, CheckCircle, Clock, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

type MeetingItem = {
  id: string;
  title: string;
  description: string | null;
  host: { id: string; name: string; emoji: string } | null;
  isHost: boolean;
  scope: "all" | "team" | "selected";
  status: "open" | "confirmed" | "cancelled";
  candidateCount: number;
  deadline: number | null;
  confirmedDate: { startsAt: number; endsAt: number | null } | null;
  hasResponded: boolean;
  createdAt: number;
};

type MeetingsResponse = { data: MeetingItem[] };

const SCOPE_LABEL: Record<string, string> = {
  all: "全メンバー",
  team: "チーム",
  selected: "指定メンバー",
};

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatusBadge({ status, hasResponded }: { status: string; hasResponded: boolean }) {
  if (status === "confirmed") {
    return (
      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ background: "rgba(90,140,92,0.12)", color: "var(--color-success)" }}>
        <CheckCircle size={11} />確定済み
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ background: "var(--color-paper-300)", color: "var(--color-ink-400)" }}>
        <XCircle size={11} />キャンセル
      </span>
    );
  }
  if (!hasResponded) {
    return (
      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ background: "rgba(181,56,75,0.1)", color: "var(--color-brand)" }}>
        <Clock size={11} />回答待ち
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ background: "var(--color-paper-200)", color: "var(--color-ink-400)" }}>
      回答済み
    </span>
  );
}

export function MeetingsScreen() {
  const user = useAuthStore((s) => s.user);

  const { data, isLoading } = useQuery({
    queryKey: ["meetings"],
    queryFn: () => api.get<MeetingsResponse>("/meetings"),
    enabled: !!user,
  });

  const meetings = data?.data ?? [];
  const openCount = meetings.filter((m) => m.status === "open" && !m.hasResponded && !m.isHost).length;

  return (
    <div className="px-4 py-6 pb-24 max-w-xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            📅 ミーティング
          </h1>
          {openCount > 0 && (
            <p className="text-xs mt-0.5" style={{ color: "var(--color-brand)" }}>
              {openCount}件の回答が待っています
            </p>
          )}
        </div>
        <Link
          to="/meetings/new"
          className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-medium text-white"
          style={{ background: "var(--color-brand)" }}
        >
          <Plus size={15} />
          新規作成
        </Link>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
        </div>
      ) : meetings.length === 0 ? (
        <div className="text-center py-16">
          <Calendar size={48} className="mx-auto mb-3 opacity-20" />
          <p className="font-medium" style={{ color: "var(--color-ink-600)" }}>ミーティングはありません</p>
          <p className="text-sm mt-1" style={{ color: "var(--color-ink-400)" }}>
            「新規作成」から日程調整を始めましょう
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {meetings.map((m) => (
            <Link
              key={m.id}
              to={`/meetings/${m.id}`}
              className="block card-paper rounded-3xl px-4 py-4 transition active:opacity-75"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-sm" style={{ color: "var(--color-ink-900)" }}>
                      {m.title}
                    </span>
                    {m.isHost && (
                      <span className="text-xs px-1.5 py-0.5 rounded-md font-medium"
                        style={{ background: "var(--color-accent)", color: "white" }}>
                        主催
                      </span>
                    )}
                  </div>

                  {m.status === "confirmed" && m.confirmedDate ? (
                    <p className="text-sm font-medium mb-2" style={{ color: "var(--color-success)" }}>
                      📅 {formatDate(m.confirmedDate.startsAt)}
                    </p>
                  ) : (
                    <p className="text-xs mb-2" style={{ color: "var(--color-ink-400)" }}>
                      候補日 {m.candidateCount}件 · {SCOPE_LABEL[m.scope]}対象
                    </p>
                  )}

                  <div className="flex items-center gap-2">
                    <StatusBadge status={m.status} hasResponded={m.hasResponded} />
                    {!m.isHost && m.host && (
                      <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>
                        {m.host.emoji} {m.host.name}さん主催
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
