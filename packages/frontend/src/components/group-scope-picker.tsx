// =============================================================
// ミーティング・定例会の対象者を「グループ」で指定する部分（作成画面用）
// グループは、メンバーと外部ゲストをまとめて登録しておいたもの（作った本人だけが使える）。
// 作成後にグループへ人が加わると、この会にも、確定済みの回を含めて、自動で招待される。
// =============================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";
import { useAuthStore } from "@/stores/auth-store";
import type { MeetingGroup } from "@/screens/meetings/meeting-groups-screen";

export function useMeetingGroups(enabled: boolean) {
  return useQuery({
    queryKey: ["meeting-groups"],
    queryFn: () => api.get<{ data: MeetingGroup[] }>("/meeting-groups"),
    enabled,
  });
}

/** グループに、招待できる人（メンバーか外部ゲスト）が1人でもいるか */
export const groupHasPeople = (g: MeetingGroup | undefined): boolean => !!g && g.members.length + g.guests.length > 0;

type Props = { groups: MeetingGroup[]; loading: boolean; value: string; onChange: (id: string) => void };

/** マウスを重ねたときに出る、グループの中身（名前の一覧） */
function groupTitle(g: MeetingGroup, guestLabel: string): string {
  const members = g.members.map((m) => m.name).join("、") || "（なし）";
  const guests = g.guests.map((x) => x.name).join("、") || "（なし）";
  return `メンバー: 自分、${members}\n${guestLabel}: ${guests}`;
}

export function GroupScopePicker({ groups, loading, value, onChange }: Props) {
  const { termExternalGuest } = useSettings();
  const me = useAuthStore((s) => s.user);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <div className="mt-3 space-y-1.5">
      {loading ? (
        <div className="flex justify-center py-3"><Loader2 className="animate-spin" size={16} style={{ color: "var(--color-ink-400)" }} /></div>
      ) : groups.length === 0 ? (
        <p className="text-xs text-center py-3" style={{ color: "var(--color-ink-400)" }}>グループがまだありません。下のリンクから作れます。</p>
      ) : (
        groups.map((g) => {
          const expanded = expandedId === g.id;
          const selected = value === g.id;
          return (
            <div key={g.id} className="rounded-2xl overflow-hidden"
              style={{ background: selected ? "rgba(181,56,75,0.08)" : "var(--color-paper-200)", border: selected ? "1.5px solid rgba(181,56,75,0.3)" : "1.5px solid transparent" }}>
              <div className="flex items-center" title={groupTitle(g, termExternalGuest)}>
                <label className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 cursor-pointer">
                  <input type="radio" name="meetingGroupId" checked={selected} onChange={() => onChange(g.id)} className="sr-only" />
                  <span className="text-base">👥</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{g.name}</p>
                    <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
                      {groupHasPeople(g) ? `メンバー${g.members.length + 1}名（自分を含む）・${termExternalGuest}${g.guests.length}人` : "まだ誰も入っていません"}
                    </p>
                  </div>
                  {selected && <span className="text-xs font-bold" style={{ color: "var(--color-brand)" }}>✓</span>}
                </label>
                <button type="button" onClick={() => setExpandedId(expanded ? null : g.id)} aria-expanded={expanded} aria-label={`${g.name}の中身を見る`}
                  className="shrink-0 flex items-center gap-0.5 px-3 py-2.5 text-xs" style={{ color: "var(--color-ink-500)" }}>
                  中身<ChevronDown size={14} style={{ transform: expanded ? "rotate(180deg)" : undefined, transition: "transform .15s" }} />
                </button>
              </div>
              {expanded && (
                <div className="px-3 pb-3 space-y-2">
                  <div>
                    <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>👥 メンバー</p>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs" style={{ background: "var(--color-paper-50)", color: "var(--color-ink-800)" }}>
                        {me?.emoji ?? "😊"} {me?.name ?? "自分"}（自分）
                      </span>
                      {g.members.map((m) => (
                        <span key={m.id} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs" style={{ background: "var(--color-paper-50)", color: "var(--color-ink-800)" }}>
                          {m.emoji} {m.name}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>🌐 {termExternalGuest}</p>
                    {g.guests.length === 0 ? (
                      <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>いません</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {g.guests.map((x) => (
                          <span key={x.id} className="px-2 py-0.5 rounded-full text-xs" style={{ background: "var(--color-paper-50)", color: "var(--color-ink-800)" }}>👤 {x.name}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
      <p className="text-xs px-1" style={{ color: "var(--color-ink-500)" }}>
        グループの{termExternalGuest}にも、自動で招待メールが届きます。作ったあとにグループへ人を追加しても、まだ終わっていないこの予定に自動で招待されます。（マウスを重ねても、中身を見られます）
      </p>
      <a href="/meetings/groups" target="_blank" rel="noopener noreferrer" className="inline-block text-xs underline px-1" style={{ color: "var(--color-brand)" }}>
        グループを作る・編集する（別のタブで開きます）
      </a>
    </div>
  );
}
