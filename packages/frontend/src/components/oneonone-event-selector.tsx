// =============================================================
// 1to1に結びつける「イベント」の選択
//   target="member"  … メンバーに1to1を申し込むとき（メンバーとの1to1向けのイベントだけを表示）
//   target="visitor" … ビジター（外部ゲスト）を招待するとき（ビジターとの1to1向けのイベントだけを表示）
// ポイントはイベントに設定されていて、1to1を実施したときにそのポイントが付く（ポイントなしのイベントもある）。
// 選べるイベントがなければ何も表示しない。
// =============================================================
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";

type OneOnOneEventOption = {
  id: string; title: string; description: string;
  typeName: string | null; typeEmoji: string | null; points: number;
};

export function OneOnOneEventSelector({ target, value, onChange }: {
  target: "member" | "visitor";
  /** 選んだイベントのID（"" = 未選択） */
  value: string;
  onChange: (id: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ["events", "one-on-one-events", target],
    queryFn: () => api.get<{ data: OneOnOneEventOption[] }>(`/events/one-on-one-events?target=${target}`),
  });
  const events = data?.data ?? [];

  // 未選択のときは先頭のイベントを選んでおく
  useEffect(() => {
    if (value === "" && events.length > 0) onChange(events[0].id);
  }, [value, events, onChange]);

  if (!data) {
    return <div className="flex justify-center py-2"><Loader2 size={14} className="animate-spin" style={{ color: "var(--color-brand)" }} /></div>;
  }
  if (events.length === 0) return null;

  return (
    <div>
      <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
        🎯 イベント
      </label>
      <div className="space-y-1.5">
        {events.map((e) => (
          <label key={e.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl cursor-pointer transition"
            style={{
              background: value === e.id ? "rgba(212,160,59,0.12)" : "var(--color-paper-200)",
              border: value === e.id ? "1.5px solid rgba(212,160,59,0.4)" : "1.5px solid transparent",
            }}>
            <input type="radio" name={`oneOnOneEvent-${target}`} value={e.id} checked={value === e.id} onChange={() => onChange(e.id)} className="sr-only" />
            <span className="text-base">{e.typeEmoji ?? "🤝"}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{e.title}</p>
              <p className="text-xs" style={{ color: e.points > 0 ? "var(--color-accent)" : "var(--color-ink-400)" }}>
                {e.points > 0 ? `実施すると +${e.points}pt` : "ポイントなし"}
              </p>
            </div>
            {value === e.id && <span className="text-xs font-bold" style={{ color: "var(--color-accent)" }}>✓</span>}
          </label>
        ))}
      </div>
    </div>
  );
}
