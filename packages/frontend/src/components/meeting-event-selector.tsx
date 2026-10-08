// =============================================================
// ミーティング・定例会に紐づける「イベント」の選択（ミーティング／定例会の作成・変更で共通）
// 選ぶのは、管理ダッシュボードで作成されたイベント（インスタンス）。ポイントはイベントに設定されていて、
// 選んだイベントのポイントが、ミーティング（定例会は各回）の出席ごとに付く。
// =============================================================
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";

export type MeetingEventOption = {
  id: string; title: string; description: string;
  typeName: string | null; typeEmoji: string | null;
  points: number;
};

export function useMeetingEvents() {
  return useQuery({
    queryKey: ["events", "meeting-events"],
    queryFn: () => api.get<{ data: MeetingEventOption[] }>("/events/meeting-events"),
  });
}

export function MeetingEventSelector({ value, onChange, hint }: {
  /** 選んだイベントのID（"" = イベントなし） */
  value: string;
  onChange: (id: string) => void;
  hint?: string;
}) {
  const { data } = useMeetingEvents();
  const events = data?.data ?? [];

  const option = (id: string, emoji: string, title: string, sub: string | null, subAccent: boolean) => (
    <label key={id || "none"} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl cursor-pointer transition"
      style={{
        background: value === id ? "rgba(212,160,59,0.12)" : "var(--color-paper-200)",
        border: value === id ? "1.5px solid rgba(212,160,59,0.4)" : "1.5px solid transparent",
      }}>
      <input type="radio" name="meetingEventId" value={id} checked={value === id} onChange={() => onChange(id)} className="sr-only" />
      <span className="text-base">{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{title}</p>
        {sub && <p className="text-xs" style={{ color: subAccent ? "var(--color-accent)" : "var(--color-ink-400)" }}>{sub}</p>}
      </div>
      {value === id && <span className="text-xs font-bold" style={{ color: "var(--color-accent)" }}>✓</span>}
    </label>
  );

  return (
    <div>
      <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
        🎯 イベント
      </label>
      <p className="text-xs mb-2" style={{ color: "var(--color-ink-400)" }}>
        {hint ?? "ポイントのつくイベントを選ぶと、参加者にポイントが付与されます"}
      </p>
      {!data ? (
        <div className="flex justify-center py-3">
          <Loader2 size={16} className="animate-spin" style={{ color: "var(--color-brand)" }} />
        </div>
      ) : (
        <div className="space-y-1.5">
          {option("", "—", "イベントなし（ポイントなし）", null, false)}
          {events.map((e) =>
            option(
              e.id, e.typeEmoji ?? "🎉", e.title,
              `${e.typeName ? `${e.typeName}・` : ""}${e.points > 0 ? `参加するたびに +${e.points}pt` : "ポイントなし"}`,
              e.points > 0,
            )
          )}
          {events.length === 0 && (
            <p className="text-xs px-1 pt-1" style={{ color: "var(--color-ink-400)" }}>
              いま選べるイベントはありません。運営がイベントを作成すると、ここに表示されます。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
