// =============================================================
// ミーティング・定例会に紐づける「イベント」の選択（ミーティング／定例会の作成・変更で共通）
// 選択肢は次の2種類。「イベントなし」は用意しない。
//   ・ポイントなしの種別（デフォルトは「ミーティング」）
//   ・管理ダッシュボードで作成されたイベント（インスタンス）。ポイントはイベントに設定されていて、
//     選んだイベントのポイントが、ミーティング（定例会は各回）の出席ごとに付く
// 値は "type:<種別ID>" または "event:<イベントID>"
// =============================================================
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";

export type MeetingEventOption = {
  id: string; title: string; description: string;
  typeName: string | null; typeEmoji: string | null;
  points: number;
};
type PlainType = { id: string; name: string; emoji: string };
type Response = { data: MeetingEventOption[]; plainTypes: PlainType[] };

export function useMeetingEvents() {
  return useQuery({
    queryKey: ["events", "meeting-events"],
    queryFn: () => api.get<Response>("/events/meeting-events"),
  });
}

/** 選択値 → APIに送る項目 */
export function selectionToPayload(value: string): { eventCampaignId?: string; eventTypeDefId?: string } {
  if (value.startsWith("event:")) return { eventCampaignId: value.slice("event:".length) };
  if (value.startsWith("type:")) return { eventTypeDefId: value.slice("type:".length) };
  return {};
}

export function MeetingEventSelector({ value, onChange, hint }: {
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  const { data } = useMeetingEvents();
  const events = data?.data ?? [];
  const plainTypes = data?.plainTypes ?? [];

  // 未選択のときは、デフォルト（ポイントなしの「ミーティング」。なければ先頭のイベント）を選ぶ
  useEffect(() => {
    if (value !== "" || !data) return;
    if (plainTypes.length > 0) onChange(`type:${plainTypes[0].id}`);
    else if (events.length > 0) onChange(`event:${events[0].id}`);
  }, [value, data, plainTypes, events, onChange]);

  const option = (id: string, emoji: string, title: string, sub: string, accent: boolean) => (
    <label key={id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl cursor-pointer transition"
      style={{
        background: value === id ? "rgba(212,160,59,0.12)" : "var(--color-paper-200)",
        border: value === id ? "1.5px solid rgba(212,160,59,0.4)" : "1.5px solid transparent",
      }}>
      <input type="radio" name="meetingEventId" value={id} checked={value === id} onChange={() => onChange(id)} className="sr-only" />
      <span className="text-base">{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{title}</p>
        <p className="text-xs" style={{ color: accent ? "var(--color-accent)" : "var(--color-ink-400)" }}>{sub}</p>
      </div>
      {value === id && <span className="text-xs font-bold" style={{ color: "var(--color-accent)" }}>✓</span>}
    </label>
  );

  return (
    <div>
      <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
        🎯 イベント種別
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
          {plainTypes.map((t) => option(`type:${t.id}`, t.emoji, t.name, "ポイントなし", false))}
          {events.map((e) =>
            option(
              `event:${e.id}`, e.typeEmoji ?? "🎉", e.title,
              `${e.typeName ? `${e.typeName}・` : ""}${e.points > 0 ? `参加するたびに +${e.points}pt` : "ポイントなし"}`,
              e.points > 0,
            )
          )}
        </div>
      )}
    </div>
  );
}
