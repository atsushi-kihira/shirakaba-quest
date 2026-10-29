// =============================================================
// ミーティング・定例会の対象者を「グループ」で指定する部分（作成画面用）
// グループは、メンバーと外部ゲストをまとめて登録しておいたもの（作った本人だけが使える）。
// 作成後にグループへ人が加わると、この会にも、確定済みの回を含めて、自動で招待される。
// =============================================================
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";
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

export function GroupScopePicker({ groups, loading, value, onChange }: Props) {
  const { termExternalGuest } = useSettings();
  return (
    <div className="mt-3 space-y-1.5">
      {loading ? (
        <div className="flex justify-center py-3"><Loader2 className="animate-spin" size={16} style={{ color: "var(--color-ink-400)" }} /></div>
      ) : groups.length === 0 ? (
        <p className="text-xs text-center py-3" style={{ color: "var(--color-ink-400)" }}>グループがまだありません。下のリンクから作れます。</p>
      ) : (
        groups.map((g) => (
          <label key={g.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl cursor-pointer transition"
            style={{ background: value === g.id ? "rgba(181,56,75,0.08)" : "var(--color-paper-200)", border: value === g.id ? "1.5px solid rgba(181,56,75,0.3)" : "1.5px solid transparent" }}>
            <input type="radio" name="meetingGroupId" checked={value === g.id} onChange={() => onChange(g.id)} className="sr-only" />
            <span className="text-base">👥</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{g.name}</p>
              <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
                {groupHasPeople(g) ? `メンバー${g.members.length}名・${termExternalGuest}${g.guests.length}人` : "まだ誰も入っていません"}
              </p>
            </div>
            {value === g.id && <span className="text-xs font-bold" style={{ color: "var(--color-brand)" }}>✓</span>}
          </label>
        ))
      )}
      <p className="text-xs px-1" style={{ color: "var(--color-ink-500)" }}>
        グループに入っている{termExternalGuest}にも、自動で招待メールが届きます。作ったあとにグループへ人を追加しても、まだ終わっていないこの予定に自動で招待されます。
      </p>
      <a href="/meetings/groups" target="_blank" rel="noopener noreferrer" className="inline-block text-xs underline px-1" style={{ color: "var(--color-brand)" }}>
        グループを作る・編集する（別のタブで開きます）
      </a>
    </div>
  );
}
