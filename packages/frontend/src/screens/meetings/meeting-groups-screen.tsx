// =============================================================
// 対象者の「グループ」の管理画面
// ミーティング・定例会の対象者を、メンバーと外部ゲスト（ビジター）でまとめて登録しておく（作った本人だけが使える）。
// ミーティング・定例会を作るときに「グループ」を選ぶと、まとめて招待できる。
// グループに人を追加すると、そのグループで作った、まだ終わっていないミーティング・定例会（確定済みの回を含む）にも招待が届く。
// =============================================================
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Loader2, Pencil, Plus, Trash2, UserPlus, Users, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useSettings } from "@/hooks/use-settings";
import { MemberSelectList, type SelectableMember } from "@/components/member-select-list";
import { GuestPicker, guestMissingEmail, guestsToPayload, type GuestDraft } from "@/components/guest-picker";

type GroupMember = { id: string; name: string; emoji: string; bgColor: string };
type GroupGuest = { id: string; name: string; email: string; contactId: string | null };
export type MeetingGroup = {
  id: string; name: string; members: GroupMember[]; guests: GroupGuest[];
  activeMeetingCount: number; activeSeriesCount: number;
};
type AddResult = { data: { added: number; meetings: number; series: number } };

const inputStyle = { background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" } as const;
const errText = (e: unknown): string => (e instanceof ApiError ? e.message : "うまくいきませんでした。時間をおいてもう一度お試しください");

/** 追加によって招待が届いた、未実施のミーティング・定例会の件数のお知らせ */
function reachedText(r: { meetings: number; series: number }): string {
  const parts = [r.meetings > 0 ? `ミーティング${r.meetings}件` : "", r.series > 0 ? `定例会${r.series}件` : ""].filter(Boolean);
  return parts.length > 0 ? `このグループで作った、まだ終わっていない${parts.join("・")}にも、招待を送りました。` : "";
}

/** グループから外したことで、これから開催される会からも外れた件数のお知らせ */
function removedText(r: { meetings: number; series: number }): string {
  const parts = [r.meetings > 0 ? `ミーティング${r.meetings}件` : "", r.series > 0 ? `定例会${r.series}件` : ""].filter(Boolean);
  return parts.length > 0 ? `グループから外しました。このグループで作った、これから開催される${parts.join("・")}からも外しました。` : "グループから外しました。";
}

export function MeetingGroupsScreen() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [createError, setCreateError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["meeting-groups"],
    queryFn: () => api.get<{ data: MeetingGroup[] }>("/meeting-groups"),
  });
  const groups = data?.data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["meeting-groups"] });

  const create = useMutation({
    mutationFn: () => api.post<{ data: { id: string } }>("/meeting-groups", { name: name.trim() }),
    onSuccess: (res) => { setName(""); setCreateError(""); setOpenId(res.data.id); refresh(); },
    onError: (e) => setCreateError(errText(e)),
  });

  return (
    <div className="px-4 py-6 pb-24 max-w-xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => navigate(-1)} className="p-2 rounded-2xl hover:opacity-70" style={{ background: "var(--color-paper-200)" }} aria-label="戻る">
          <ChevronLeft size={18} style={{ color: "var(--color-ink-600)" }} />
        </button>
        <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>グループ</h1>
      </div>

      <p className="text-xs mb-4 px-3 py-2.5 rounded-xl leading-relaxed" style={{ background: "rgba(212,160,59,0.12)", color: "var(--color-ink-600)" }}>
        💡 よく声をかける人たちを、メンバーも外部ゲストもまとめて「グループ」にしておくと、ミーティングや定例会を作るときに、グループを選ぶだけで招待できます。
        グループは、あなただけが使えます。グループに人を追加すると、そのグループで作った<b>まだ終わっていないミーティング・定例会（確定済みの回も）</b>にも、自動で招待が届きます。グループから外すと、これから開催される回からも外れます。
      </p>

      <div className="card-paper rounded-2xl p-4 mb-5 space-y-2">
        <label htmlFor="group-name" className="block text-sm font-medium" style={{ color: "var(--color-ink-700)" }}>新しいグループを作る</label>
        <div className="flex gap-2">
          <input id="group-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="グループの名前（例：勉強会メンバー）"
            onKeyDown={(e) => {
              // 日本語入力の文字確定（Enter）では、送信しない（Safari は、確定直後のキー入力が keyCode 229 になる）
              if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229 && name.trim() && !create.isPending) create.mutate();
            }}
            className="flex-1 min-w-0 px-4 py-2.5 rounded-2xl text-sm outline-none border" style={inputStyle} />
          <button type="button" onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
            {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}作る
          </button>
        </div>
        <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>自分は、最初からメンバーに入っています（主催者として、このグループで作った予定に、いつも参加します）。</p>
        {createError && <p className="text-xs" style={{ color: "var(--color-brand)" }}>{createError}</p>}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin" size={22} style={{ color: "var(--color-ink-400)" }} /></div>
      ) : isError ? (
        <p className="text-sm text-center py-8" style={{ color: "var(--color-brand)" }}>グループを読み込めませんでした。時間をおいてもう一度お試しください。</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-center py-8" style={{ color: "var(--color-ink-500)" }}>まだグループがありません。上から作ってみましょう。</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <GroupCard key={g.id} group={g} open={openId === g.id} onToggle={() => setOpenId(openId === g.id ? null : g.id)} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

type CardProps = { group: MeetingGroup; open: boolean; onToggle: () => void; onChanged: () => void };

function GroupCard({ group, open, onToggle, onChanged }: CardProps) {
  const { termExternalGuest } = useSettings();
  const me = useAuthStore((s) => s.user);
  const meId = me?.id;
  const [panel, setPanel] = useState<"member" | "guest" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(group.name);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [guestDrafts, setGuestDrafts] = useState<GuestDraft[]>([]);

  const { data: membersData } = useQuery({
    queryKey: ["members"],
    queryFn: () => api.get<{ data: SelectableMember[] }>("/members"),
    enabled: open && panel === "member",
  });
  const inGroup = new Set(group.members.map((m) => m.id));
  const addable = (membersData?.data ?? []).filter((m) => m.id !== meId && !inGroup.has(m.id));

  const fail = (e: unknown) => { setMessage(""); setError(errText(e)); };
  const addMembers = useMutation({
    mutationFn: () => api.post<AddResult>(`/meeting-groups/${group.id}/members`, { memberIds: pickedIds }),
    onSuccess: (res) => {
      setPickedIds([]); setPanel(null); setError("");
      setMessage(`${res.data.added}名を追加しました。${reachedText(res.data)}`);
      onChanged();
    },
    onError: fail,
  });
  const addGuests = useMutation({
    mutationFn: () => api.post<AddResult>(`/meeting-groups/${group.id}/guests`, { guests: guestsToPayload(guestDrafts) }),
    onSuccess: (res) => {
      setGuestDrafts([]); setPanel(null); setError("");
      setMessage(res.data.added > 0 ? `${res.data.added}人を追加しました。${reachedText(res.data)}` : "すでに登録されているメールアドレスでした。");
      onChanged();
    },
    onError: fail,
  });
  const removeMember = useMutation({
    mutationFn: (id: string) => api.delete<{ data: { meetings: number; series: number } }>(`/meeting-groups/${group.id}/members/${id}`),
    onSuccess: (res) => { setError(""); setMessage(removedText(res.data)); onChanged(); },
    onError: fail,
  });
  const removeGuest = useMutation({
    mutationFn: (id: string) => api.delete<{ data: { meetings: number; series: number } }>(`/meeting-groups/${group.id}/guests/${id}`),
    onSuccess: (res) => { setError(""); setMessage(removedText(res.data)); onChanged(); },
    onError: fail,
  });
  const rename = useMutation({
    mutationFn: () => api.patch(`/meeting-groups/${group.id}`, { name: newName.trim() }),
    onSuccess: () => { setRenaming(false); setError(""); onChanged(); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/meeting-groups/${group.id}`),
    onSuccess: onChanged,
    onError: fail,
  });

  function submitGuests() {
    setError("");
    if (guestDrafts.length === 0) { setError("追加するゲストを入力してください"); return; }
    const bad = guestMissingEmail(guestDrafts);
    if (bad) { setError(`「${bad}」さんのメールアドレスを入力してください`); return; }
    addGuests.mutate();
  }

  const linked = group.activeMeetingCount + group.activeSeriesCount;

  return (
    <div className="card-paper rounded-2xl overflow-hidden">
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
        <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(181,56,75,0.1)" }}>
          <Users size={18} style={{ color: "var(--color-brand)" }} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold truncate" style={{ color: "var(--color-ink-900)" }}>{group.name}</span>
          <span className="block text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
            メンバー{group.members.length + 1}名（自分を含む）・{termExternalGuest}{group.guests.length}人
            {linked > 0 && `・使用中の予定${linked}件`}
          </span>
        </span>
        <span className="text-xs shrink-0" style={{ color: "var(--color-ink-400)" }}>{open ? "閉じる" : "開く"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t" style={{ borderColor: "var(--color-paper-300)" }}>
          {/* 名前の変更 */}
          <div className="pt-3">
            {renaming ? (
              <div className="flex gap-2">
                <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={40} aria-label="グループの名前"
                  className="flex-1 min-w-0 px-3 py-2 rounded-xl text-sm outline-none border" style={inputStyle} />
                <button type="button" onClick={() => rename.mutate()} disabled={!newName.trim() || rename.isPending}
                  className="px-3 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>保存</button>
                <button type="button" onClick={() => { setRenaming(false); setNewName(group.name); }}
                  className="px-3 py-2 rounded-xl text-sm" style={{ color: "var(--color-ink-500)" }}>やめる</button>
              </div>
            ) : (
              <button type="button" onClick={() => setRenaming(true)} className="flex items-center gap-1 text-xs" style={{ color: "var(--color-ink-500)" }}>
                <Pencil size={12} />名前を変える
              </button>
            )}
          </div>

          {/* メンバー */}
          <div className="space-y-2">
            <p className="text-xs font-medium" style={{ color: "var(--color-ink-600)" }}>👥 メンバー（自分を含めて{group.members.length + 1}名）</p>
            <div className="flex flex-wrap gap-1.5">
              {/* 自分は、主催者として、いつもこのグループで作った予定に参加する（外せない） */}
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium" title="あなたは、主催者として、このグループで作った予定に、いつも参加します"
                style={{ background: "rgba(181,56,75,0.08)", border: "1px solid rgba(181,56,75,0.3)", color: "var(--color-ink-800)" }}>
                <span>{me?.emoji ?? "😊"}</span><span>{me?.name ?? "自分"}（自分）</span>
              </span>
              {group.members.map((m) => (
                  <button key={m.id} type="button" disabled={removeMember.isPending} aria-label={`${m.name}さんをグループから外す`}
                    onClick={() => { if (window.confirm(`「${m.name}」さんを、このグループから外しますか？\nこのグループで作った、これから開催されるミーティング・定例会からも外れます（終わった回は、そのままです）。`)) removeMember.mutate(m.id); }}
                    className="flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-xs font-medium disabled:opacity-50"
                    style={{ background: "var(--color-paper-200)", color: "var(--color-ink-800)" }}>
                    <span>{m.emoji}</span><span>{m.name}</span><X size={12} style={{ color: "var(--color-ink-500)" }} />
                  </button>
                ))}
            </div>
            <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>自分は、主催者として、このグループで作った予定に、いつも参加します（追加する必要はありません）。</p>
            <button type="button" onClick={() => { setPanel(panel === "member" ? null : "member"); setError(""); }} aria-expanded={panel === "member"}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium"
              style={{ background: panel === "member" ? "var(--color-paper-300)" : "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
              <UserPlus size={14} />{panel === "member" ? "メンバーの追加をやめる" : "メンバーを追加する"}
            </button>
            {panel === "member" && (
              <div className="rounded-2xl p-3" style={{ background: "var(--color-paper-100)", border: "1px solid var(--color-paper-300)" }}>
                {membersData ? (
                  <>
                    <MemberSelectList members={addable} selectedIds={pickedIds}
                      onToggle={(id) => setPickedIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))} onSetSelected={setPickedIds} />
                    <button type="button" onClick={() => addMembers.mutate()} disabled={pickedIds.length === 0 || addMembers.isPending}
                      className="w-full mt-3 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
                      {addMembers.isPending && <Loader2 size={14} className="animate-spin" />}
                      {pickedIds.length > 0 ? `選んだ${pickedIds.length}名を追加する` : "追加するメンバーを選んでください"}
                    </button>
                  </>
                ) : <div className="flex justify-center py-4"><Loader2 className="animate-spin" size={18} style={{ color: "var(--color-ink-400)" }} /></div>}
              </div>
            )}
          </div>

          {/* 外部ゲスト */}
          <div className="space-y-2">
            <p className="text-xs font-medium" style={{ color: "var(--color-ink-600)" }}>🌐 {termExternalGuest}（{group.guests.length}人）</p>
            {group.guests.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>まだ{termExternalGuest}がいません。</p>
            ) : (
              <div className="space-y-1">
                {group.guests.map((g) => (
                  <div key={g.id} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "var(--color-paper-200)" }}>
                    <span className="text-sm shrink-0">👤</span>
                    <span className="flex-1 min-w-0 text-xs truncate" style={{ color: "var(--color-ink-700)" }}>
                      {g.name}<span style={{ color: "var(--color-ink-400)" }}> · {g.email}</span>
                      <span style={{ color: "var(--color-ink-400)" }}> · {g.contactId ? "📇 外部人脈" : "✉️ メールのみ"}</span>
                    </span>
                    <button type="button" disabled={removeGuest.isPending} aria-label={`${g.name}さんをグループから外す`}
                      onClick={() => { if (window.confirm(`「${g.name}」さんを、このグループから外しますか？\nこのグループで作った、これから開催されるミーティング・定例会からも外れます（終わった回は、そのままです）。`)) removeGuest.mutate(g.id); }}
                      className="shrink-0 p-1 rounded-lg disabled:opacity-40" style={{ color: "var(--color-ink-400)" }}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button type="button" onClick={() => { setPanel(panel === "guest" ? null : "guest"); setError(""); }} aria-expanded={panel === "guest"}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium"
              style={{ background: panel === "guest" ? "var(--color-paper-300)" : "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
              <UserPlus size={14} />{panel === "guest" ? `${termExternalGuest}の追加をやめる` : `${termExternalGuest}を追加する`}
            </button>
            {panel === "guest" && (
              <div className="rounded-2xl p-3 space-y-3" style={{ background: "var(--color-paper-100)", border: "1px solid var(--color-paper-300)" }}>
                <GuestPicker guests={guestDrafts} onGuestsChange={setGuestDrafts}
                  mailNote={(n) => `追加すると、${n}人には、このグループで作った、まだ終わっていないミーティング・定例会の招待メールが届きます。`} />
                <button type="button" onClick={submitGuests} disabled={guestDrafts.length === 0 || addGuests.isPending}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
                  {addGuests.isPending && <Loader2 size={14} className="animate-spin" />}
                  {guestDrafts.length > 0 ? `${guestDrafts.length}人をグループに追加する` : "追加するゲストを入力してください"}
                </button>
              </div>
            )}
          </div>

          {message && <p role="status" className="text-xs px-3 py-2 rounded-xl" style={{ background: "rgba(90,140,92,0.12)", color: "var(--color-success)" }}>{message}</p>}
          {error && <p role="alert" className="text-xs" style={{ color: "var(--color-brand)" }}>{error}</p>}

          <button type="button" disabled={remove.isPending}
            onClick={() => { if (window.confirm(`グループ「${group.name}」を削除しますか？\nこのグループで作ったミーティング・定例会は、そのまま残ります（以降は、グループへの追加が反映されなくなります）。`)) remove.mutate(); }}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs disabled:opacity-50" style={{ color: "var(--color-brand)", border: "1px solid rgba(181,56,75,0.3)" }}>
            <Trash2 size={13} />このグループを削除する
          </button>
        </div>
      )}
    </div>
  );
}
