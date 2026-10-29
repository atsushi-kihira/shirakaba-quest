// =============================================================
// 定例会に、あとから参加者（メンバー・外部ゲスト）を追加する（主催者向け）
//   ・確定済みの定例会では、追加した人は、これから開催されるすべての回にも入り、日程のお知らせが届く
//   ・投票中の定例会では、投票のお願いが届く
//   ・外部ゲストには、専用ページ（確定済みなら、これからの全開催日が並ぶ）のURLを、メールで案内する
// =============================================================
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserPlus, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";
import { MemberSelectList, type SelectableMember } from "@/components/member-select-list";
import { GuestPicker, guestMissingEmail, guestsToPayload, type GuestDraft } from "@/components/guest-picker";

type Props = {
  seriesId: string;
  scope: string;
  confirmed: boolean;
  /** いまの対象メンバーのID（すでにいる人は、選択肢に出さない） */
  currentMemberIds: string[];
  /** グループで作成した定例会の場合、そのグループ名 */
  groupName: string | null;
  /** 主催者が外せるメンバー（絵文字・名前つき） */
  removableMembers: Array<{ id: string; name: string; emoji: string }>;
};

const errText = (e: unknown): string => (e instanceof ApiError ? e.message : "うまくいきませんでした。時間をおいてもう一度お試しください");

export function SeriesParticipantsPanel({ seriesId, scope, confirmed, currentMemberIds, groupName, removableMembers }: Props) {
  const { termExternalGuest } = useSettings();
  const qc = useQueryClient();
  const [panel, setPanel] = useState<"member" | "guest" | null>(null);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [guestDrafts, setGuestDrafts] = useState<GuestDraft[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const canAddMembers = scope !== "all";

  const { data: membersData } = useQuery({
    queryKey: ["members"],
    queryFn: () => api.get<{ data: SelectableMember[] }>("/members"),
    enabled: panel === "member",
  });
  const current = new Set(currentMemberIds);
  const addable = (membersData?.data ?? []).filter((m) => !current.has(m.id));
  const scopeNote = confirmed ? "確定済みの、これから開催されるすべての回にも入ります。日程のお知らせが届きます。" : "投票のお願いが届きます。";

  const done = (text: string) => {
    setError(""); setMessage(text); setPanel(null);
    qc.invalidateQueries({ queryKey: ["meeting-series", seriesId] });
    qc.invalidateQueries({ queryKey: ["meetings"] });
  };
  const fail = (e: unknown) => { setMessage(""); setError(errText(e)); };

  const addMembers = useMutation({
    mutationFn: () => api.post<{ data: { added: number } }>(`/meeting-series/${seriesId}/members`, { memberIds: pickedIds }),
    onSuccess: (res) => {
      setPickedIds([]);
      done(res.data.added > 0 ? `${res.data.added}名を追加しました。${scopeNote}` : "選んだ方は、すでに対象に入っていました。");
    },
    onError: fail,
  });
  const addGuests = useMutation({
    mutationFn: () => api.post<{ data: { added: number; skipped: number } }>(`/meeting-series/${seriesId}/guests`, { guests: guestsToPayload(guestDrafts) }),
    onSuccess: (res) => {
      setGuestDrafts([]);
      done(res.data.added > 0
        ? `${res.data.added}人を追加し、案内のメールを送りました。${res.data.skipped > 0 ? `（${res.data.skipped}人は、同じメールアドレスの方がすでにいました）` : ""}`
        : "選んだ方は、すでに追加されていました。");
    },
    onError: fail,
  });

  const removeMember = useMutation({
    mutationFn: (id: string) => api.delete(`/meeting-series/${seriesId}/members/${id}`),
    onSuccess: () => done(confirmed ? "外しました。これから開催される回からも外れました。" : "外しました。"),
    onError: fail,
  });

  function submitGuests() {
    setError("");
    const bad = guestMissingEmail(guestDrafts);
    if (bad) { setError(`「${bad}」さんのメールアドレスを入力してください`); return; }
    addGuests.mutate();
  }

  const toggle = (which: "member" | "guest") => { setPanel(panel === which ? null : which); setError(""); };
  const tabStyle = (on: boolean) => ({ background: on ? "var(--color-paper-300)" : "var(--color-paper-200)", color: "var(--color-ink-700)" });

  return (
    <div className="card-paper rounded-2xl p-4 mb-5 space-y-3">
      <p className="text-sm font-semibold" style={{ color: "var(--color-ink-700)" }}>➕ 参加者を追加</p>
      <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
        あとから人を追加できます。{confirmed ? "追加した人は、確定済みのこれからの開催回すべてに入り、お知らせが届きます。" : "追加した人には、投票のお願いが届きます。"}
        {groupName && <>　このミーティングはグループ「{groupName}」で作成したので、グループに人を追加しても、自動でここに招待されます。</>}
      </p>

      {removableMembers.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium" style={{ color: "var(--color-ink-600)" }}>👥 参加メンバー（✕で外せます）</p>
          <div className="flex flex-wrap gap-1.5">
            {removableMembers.map((m) => (
              <button key={m.id} type="button" disabled={removeMember.isPending} aria-label={`${m.name}さんをこの定例会から外す`}
                onClick={() => {
                  if (window.confirm(`「${m.name}」さんを、この定例会から外しますか？\n${confirmed ? "これから開催される回からも外れます（終わった回は、そのままです）。" : "投票も消えます。"}${groupName ? `\nグループ「${groupName}」には残ります。` : ""}`)) removeMember.mutate(m.id);
                }}
                className="flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-xs font-medium disabled:opacity-50"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-800)" }}>
                <span>{m.emoji}</span><span>{m.name}</span><X size={12} style={{ color: "var(--color-ink-500)" }} />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`grid gap-2 ${canAddMembers ? "grid-cols-2" : "grid-cols-1"}`}>
        {canAddMembers && (
          <button type="button" onClick={() => toggle("member")} aria-expanded={panel === "member"}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl text-sm font-medium" style={tabStyle(panel === "member")}>
            <UserPlus size={14} />メンバーを追加
          </button>
        )}
        <button type="button" onClick={() => toggle("guest")} aria-expanded={panel === "guest"}
          className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl text-sm font-medium" style={tabStyle(panel === "guest")}>
          <UserPlus size={14} />{termExternalGuest}を追加
        </button>
      </div>

      {panel === "member" && (
        <div className="rounded-2xl p-3" style={{ background: "var(--color-paper-100)", border: "1px solid var(--color-paper-300)" }}>
          {membersData ? (
            addable.length === 0 ? (
              <p className="text-xs text-center py-3" style={{ color: "var(--color-ink-400)" }}>追加できるメンバーがいません（全員がすでに対象です）。</p>
            ) : (
              <>
                <MemberSelectList members={addable} selectedIds={pickedIds}
                  onToggle={(id) => setPickedIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))} onSetSelected={setPickedIds} />
                <button type="button" onClick={() => addMembers.mutate()} disabled={pickedIds.length === 0 || addMembers.isPending}
                  className="w-full mt-3 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
                  {addMembers.isPending && <Loader2 size={14} className="animate-spin" />}
                  {pickedIds.length > 0 ? `選んだ${pickedIds.length}名を追加する` : "追加するメンバーを選んでください"}
                </button>
              </>
            )
          ) : <div className="flex justify-center py-4"><Loader2 className="animate-spin" size={18} style={{ color: "var(--color-ink-400)" }} /></div>}
        </div>
      )}

      {panel === "guest" && (
        <div className="rounded-2xl p-3 space-y-3" style={{ background: "var(--color-paper-100)", border: "1px solid var(--color-paper-300)" }}>
          <GuestPicker guests={guestDrafts} onGuestsChange={setGuestDrafts}
            mailNote={(n) => `${n}人に、追加と同時に案内のメールを送ります。専用ページで、${confirmed ? "これからの開催日" : "候補の日程"}を確認できます。`} />
          <button type="button" onClick={submitGuests} disabled={guestDrafts.length === 0 || addGuests.isPending}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
            {addGuests.isPending && <Loader2 size={14} className="animate-spin" />}
            {guestDrafts.length > 0 ? `${guestDrafts.length}人を追加して案内を送る` : "追加するゲストを入力してください"}
          </button>
        </div>
      )}

      {message && <p role="status" className="text-xs px-3 py-2 rounded-xl" style={{ background: "rgba(90,140,92,0.12)", color: "var(--color-success)" }}>{message}</p>}
      {error && <p role="alert" className="text-xs" style={{ color: "var(--color-brand)" }}>{error}</p>}
    </div>
  );
}
