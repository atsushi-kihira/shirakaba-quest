// =============================================================
// イベント種別の選択（ミーティング・定例会の作成／変更で共通）
// ポイントのつく種別は、ミーティング1回の参加ごとに出席者へポイントが付く。
// =============================================================
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";

export type MeetingEventType = { id: string; slug: string; name: string; emoji: string; pointValue: number };

export function useMeetingEventTypes() {
  return useQuery({
    queryKey: ["events", "meeting-types"],
    queryFn: () => api.get<{ data: MeetingEventType[] }>("/events/meeting-types"),
  });
}

export function EventTypeSelector({ value, onChange, hint, defaultToFirst = true }: {
  value: string;
  onChange: (id: string) => void;
  hint?: string;
  /** 未選択のとき、先頭（通常は「ミーティング」）を自動で選ぶ */
  defaultToFirst?: boolean;
}) {
  const { data } = useMeetingEventTypes();
  const types = data?.data ?? [];

  useEffect(() => {
    if (defaultToFirst && value === "" && types.length > 0) onChange(types[0].id);
  }, [defaultToFirst, value, types, onChange]);

  return (
    <div>
      <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
        🎯 イベント種別 <span style={{ color: "var(--color-brand)" }}>*</span>
      </label>
      <p className="text-xs mb-2" style={{ color: "var(--color-ink-400)" }}>
        {hint ?? "ポイントのつく種別を選ぶと、参加者にポイントが付与されます"}
      </p>
      {!data ? (
        <div className="flex justify-center py-3">
          <Loader2 size={16} className="animate-spin" style={{ color: "var(--color-brand)" }} />
        </div>
      ) : (
        <div className="space-y-1.5">
          {types.map((t) => (
            <label key={t.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl cursor-pointer transition"
              style={{
                background: value === t.id ? "rgba(212,160,59,0.12)" : "var(--color-paper-200)",
                border: value === t.id ? "1.5px solid rgba(212,160,59,0.4)" : "1.5px solid transparent",
              }}>
              <input type="radio" name="eventTypeDefId" value={t.id} checked={value === t.id} onChange={() => onChange(t.id)} className="sr-only" />
              <span className="text-base">{t.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{t.name}</p>
                {t.pointValue > 0 && (
                  <p className="text-xs" style={{ color: "var(--color-accent)" }}>参加するたびに +{t.pointValue}pt</p>
                )}
              </div>
              {value === t.id && <span className="text-xs font-bold" style={{ color: "var(--color-accent)" }}>✓</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
