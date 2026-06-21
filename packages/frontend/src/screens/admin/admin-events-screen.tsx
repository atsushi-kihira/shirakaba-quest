// =============================================================
// 管理画面 — イベント管理
// =============================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Check, X, Square, CheckSquare, StopCircle } from "lucide-react";
import { api } from "@/lib/api";
import type { EventCampaign, EventType } from "@shared/types";

type EventsResponse = { data: (EventCampaign & { relatedMemberIds?: string[] })[] };
type MembersResponse = { data: Array<{ id: string; name: string; emoji: string; status: string }> };

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  special_quest_week:   "📅 特別お題ウィーク",
  welcome_quest:        "🎉 新メンバー歓迎クエスト",
  featured_member:      "⭐ 注目メンバーフォーカス",
  visitor_invite_quest: "🤝 ビジター招待",
};

function toDateInput(ts: number | null | undefined): string {
  if (!ts) return "";
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function AdminEventsScreen() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "events"],
    queryFn: () => api.get<EventsResponse>("/admin/events"),
  });

  const { data: membersData } = useQuery({
    queryKey: ["admin", "members"],
    queryFn: () => api.get<MembersResponse>("/admin/members"),
  });

  const allEvents = data?.data ?? [];
  const members = (membersData?.data ?? []).filter((m) => m.status === "active");

  // active 先・ended 後の順に並べ替え
  const activeEvents = allEvents.filter((e) => e.status === "active");
  const endedEvents  = allEvents.filter((e) => e.status === "ended");

  const endEvent = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/events/${id}`, { status: "ended" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "events"] }),
  });

  const deleteEvent = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/events/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "events"] }),
  });

  function renderEventRow(ev: EventCampaign & { relatedMemberIds?: string[] }, isEnded = false) {
    const relatedMemberIds = ev.relatedMemberIds ?? (ev.relatedMemberId ? [ev.relatedMemberId] : []);
    const relatedMemberNames = relatedMemberIds
      .map((id) => members.find((m) => m.id === id))
      .filter(Boolean)
      .map((m) => `${m!.emoji} ${m!.name}`);

    if (editId === ev.id) {
      return (
        <EditEventForm
          key={ev.id}
          event={ev}
          members={members}
          onDone={() => setEditId(null)}
        />
      );
    }

    return (
      <div key={ev.id} className="card-paper p-4" style={{ opacity: isEnded ? 0.7 : 1 }}>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                {EVENT_TYPE_LABELS[ev.type as EventType] ?? ev.type}
              </span>
              {!isEnded ? (
                <span className="text-xs px-2 py-0.5 rounded-full text-white font-bold"
                  style={{ background: "var(--color-success)" }}>実施中</span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                  style={{ background: "var(--color-paper-300)", color: "var(--color-ink-500)" }}>終了</span>
              )}
              {ev.multiplier && ev.multiplier > 1 && (
                <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                  style={{ background: "rgba(212,160,59,0.18)", color: "var(--color-accent)" }}>
                  ×{ev.multiplier} ボーナス
                </span>
              )}
            </div>
            <p className="font-semibold" style={{ color: "var(--color-ink-800)" }}>{ev.title}</p>
            {ev.description && (
              <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-600)" }}>{ev.description}</p>
            )}
            {relatedMemberNames.length > 0 && (
              <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
                対象: {relatedMemberNames.join("、")}
              </p>
            )}
            <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
              {new Date(ev.startsAt * 1000).toLocaleDateString("ja-JP")}
              {" 〜 "}
              {ev.endsAt ? new Date(ev.endsAt * 1000).toLocaleDateString("ja-JP") : "（終了日未設定）"}
            </p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={() => setEditId(ev.id)}
              className="p-2 rounded-2xl transition hover:opacity-80"
              style={{ background: "var(--color-paper-200)" }}
              title="編集"
            >
              <Pencil size={14} style={{ color: "var(--color-ink-500)" }} />
            </button>
            {!isEnded && (
              <button
                onClick={() => endEvent.mutate(ev.id)}
                disabled={endEvent.isPending}
                className="p-2 rounded-2xl transition hover:opacity-80"
                style={{ background: "var(--color-paper-200)" }}
                title="終了にする"
              >
                <StopCircle size={14} style={{ color: "var(--color-accent)" }} />
              </button>
            )}
            <button
              onClick={() => {
                if (confirm(`「${ev.title}」を削除しますか？この操作はリストから非表示にします。`)) {
                  deleteEvent.mutate(ev.id);
                }
              }}
              disabled={deleteEvent.isPending}
              className="p-2 rounded-2xl transition hover:opacity-80"
              style={{ background: "var(--color-paper-200)" }}
              title="削除（非表示）"
            >
              <Trash2 size={14} style={{ color: "var(--color-brand)" }} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-24 max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          📣 イベント管理
        </h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-medium text-white"
          style={{ background: "var(--color-brand)" }}
        >
          <Plus size={14} />
          新規作成
        </button>
      </div>
      <p className="text-sm mb-5" style={{ color: "var(--color-ink-500)" }}>
        期間限定イベントを設定できます。実施中のイベントはホーム画面に表示されます。
        <br />
        <span className="text-xs">🟢 終了ボタン：終了イベントとして下部に残す　🗑️ 削除ボタン：リストから非表示</span>
      </p>

      {isLoading ? (
        <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>読み込み中...</div>
      ) : allEvents.length === 0 ? (
        <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>
          イベントがまだありません。「新規作成」から作ってみましょう。
        </div>
      ) : (
        <div className="space-y-3">
          {activeEvents.map((ev) => renderEventRow(ev, false))}

          {endedEvents.length > 0 && (
            <>
              <div className="flex items-center gap-2 pt-2">
                <div className="flex-1 border-t" style={{ borderColor: "var(--color-paper-300)" }} />
                <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>終了済み</span>
                <div className="flex-1 border-t" style={{ borderColor: "var(--color-paper-300)" }} />
              </div>
              {endedEvents.map((ev) => renderEventRow(ev, true))}
            </>
          )}
        </div>
      )}

      {showCreate && <CreateEventModal members={members} onClose={() => setShowCreate(false)} />}
    </div>
  );
}

// ---- 新規作成モーダル ----
function CreateEventModal({
  members,
  onClose,
}: {
  members: Array<{ id: string; name: string; emoji: string }>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [type, setType] = useState<EventType>("special_quest_week");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState(toDateInput(Math.floor(Date.now() / 1000)));
  const [endsAt, setEndsAt] = useState("");
  const [multiplier, setMultiplier] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.post("/admin/events", {
        type,
        title: title.trim(),
        description: description.trim(),
        relatedMemberIds: selectedMemberIds.length > 0 ? selectedMemberIds : undefined,
        startsAt: startsAt ? Math.floor(new Date(startsAt).getTime() / 1000) : undefined,
        endsAt: endsAt ? Math.floor(new Date(endsAt).getTime() / 1000) : undefined,
        multiplier: multiplier ? Number(multiplier) : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "events"] });
      qc.invalidateQueries({ queryKey: ["events", "active"] });
      onClose();
    },
  });

  const needsMembers = type === "welcome_quest" || type === "featured_member";
  const multiSelect  = type === "welcome_quest";

  function toggleMember(id: string) {
    if (multiSelect) {
      setSelectedMemberIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
    } else {
      setSelectedMemberIds((prev) => (prev[0] === id ? [] : [id]));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-6 w-full max-w-md rounded-3xl max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-klee)" }}>📣 新しいイベント</h2>
          <button onClick={onClose} className="p-1.5 rounded-full" style={{ background: "var(--color-paper-200)" }}>
            <X size={16} style={{ color: "var(--color-ink-500)" }} />
          </button>
        </div>
        <div className="space-y-4">
          <Field label="種別 *">
            <select value={type} onChange={(e) => { setType(e.target.value as EventType); setSelectedMemberIds([]); }}
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{ borderColor: "var(--color-paper-300)" }}>
              {(Object.entries(EVENT_TYPE_LABELS) as [EventType, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="タイトル *">
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="例: 7月 特別お題ウィーク"
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{ borderColor: "var(--color-paper-300)" }} />
          </Field>
          <Field label="説明（任意）">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              rows={2} className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
              style={{ borderColor: "var(--color-paper-300)" }} />
          </Field>
          {needsMembers && (
            <Field label={`${multiSelect ? "対象メンバー（複数選択可）" : "注目メンバー"} *`}>
              <MemberSelector
                members={members}
                selected={selectedMemberIds}
                multi={multiSelect}
                onToggle={toggleMember}
              />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="開始日">
              <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)" }} />
            </Field>
            <Field label="終了日（任意）">
              <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)" }} />
            </Field>
          </div>
          <Field label="ポイント倍率（任意）例: 2">
            <input type="number" min={1} max={10} value={multiplier} onChange={(e) => setMultiplier(e.target.value)}
              placeholder="空欄=倍率なし"
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{ borderColor: "var(--color-paper-300)" }} />
          </Field>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl text-sm font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            キャンセル
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={!title.trim() || (needsMembers && selectedMemberIds.length === 0) || create.isPending}
            className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}
          >
            <Plus size={14} />
            作成する
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- 編集フォーム（全項目対応）----
function EditEventForm({
  event,
  members,
  onDone,
}: {
  event: EventCampaign & { relatedMemberIds?: string[] };
  members: Array<{ id: string; name: string; emoji: string }>;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(event.relatedMemberIds ?? (event.relatedMemberId ? [event.relatedMemberId] : []));
  const [startsAt, setStartsAt] = useState(toDateInput(event.startsAt));
  const [endsAt, setEndsAt] = useState(toDateInput(event.endsAt));
  const [multiplier, setMultiplier] = useState(event.multiplier ? String(event.multiplier) : "");

  const save = useMutation({
    mutationFn: () => api.patch(`/admin/events/${event.id}`, {
      title: title.trim(),
      description: description.trim(),
      relatedMemberIds: selectedMemberIds,
      startsAt: startsAt ? Math.floor(new Date(startsAt).getTime() / 1000) : undefined,
      endsAt: endsAt ? Math.floor(new Date(endsAt).getTime() / 1000) : null,
      multiplier: multiplier ? Number(multiplier) : null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "events"] });
      qc.invalidateQueries({ queryKey: ["events", "active"] });
      onDone();
    },
  });

  const needsMembers = event.type === "welcome_quest" || event.type === "featured_member";
  const multiSelect  = event.type === "welcome_quest";

  function toggleMember(id: string) {
    if (multiSelect) {
      setSelectedMemberIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    } else {
      setSelectedMemberIds((prev) => (prev[0] === id ? [] : [id]));
    }
  }

  return (
    <div className="card-paper p-4 border-2 space-y-3" style={{ borderColor: "var(--color-brand)" }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          {EVENT_TYPE_LABELS[event.type as EventType] ?? event.type}
        </span>
      </div>
      <Field label="タイトル *">
        <input value={title} onChange={(e) => setTitle(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border text-sm font-semibold"
          style={{ borderColor: "var(--color-paper-300)" }} />
      </Field>
      <Field label="説明">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)}
          rows={2} className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
          style={{ borderColor: "var(--color-paper-300)" }} />
      </Field>
      {needsMembers && (
        <Field label={multiSelect ? "対象メンバー（複数選択可）" : "注目メンバー"}>
          <MemberSelector members={members} selected={selectedMemberIds} multi={multiSelect} onToggle={toggleMember} />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="開始日">
          <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border text-sm"
            style={{ borderColor: "var(--color-paper-300)" }} />
        </Field>
        <Field label="終了日">
          <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border text-sm"
            style={{ borderColor: "var(--color-paper-300)" }} />
        </Field>
      </div>
      <Field label="ポイント倍率">
        <input type="number" min={1} max={10} value={multiplier} onChange={(e) => setMultiplier(e.target.value)}
          placeholder="空欄=倍率なし"
          className="w-full px-3 py-2 rounded-xl border text-sm"
          style={{ borderColor: "var(--color-paper-300)" }} />
      </Field>
      <div className="flex gap-2 pt-1">
        <button onClick={onDone} className="flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          <X size={12} /> キャンセル
        </button>
        <button onClick={() => save.mutate()} disabled={!title.trim() || save.isPending}
          className="flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs text-white disabled:opacity-50"
          style={{ background: "var(--color-success)" }}>
          <Check size={12} /> 保存
        </button>
      </div>
    </div>
  );
}

// ---- メンバー選択コンポーネント ----
function MemberSelector({
  members,
  selected,
  multi,
  onToggle,
}: {
  members: Array<{ id: string; name: string; emoji: string }>;
  selected: string[];
  multi: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="max-h-44 overflow-y-auto rounded-xl border divide-y"
      style={{ borderColor: "var(--color-paper-300)" }}>
      {members.map((m) => {
        const checked = selected.includes(m.id);
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onToggle(m.id)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition hover:opacity-80"
            style={{ background: checked ? "rgba(181,56,75,0.07)" : "transparent" }}
          >
            {multi ? (
              checked
                ? <CheckSquare size={16} style={{ color: "var(--color-brand)", flexShrink: 0 }} />
                : <Square size={16} style={{ color: "var(--color-ink-300)", flexShrink: 0 }} />
            ) : (
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${checked ? "border-brand" : ""}`}
                style={{ borderColor: checked ? "var(--color-brand)" : "var(--color-ink-300)" }}>
                {checked && <div className="w-2 h-2 rounded-full" style={{ background: "var(--color-brand)" }} />}
              </div>
            )}
            <span className="text-base">{m.emoji}</span>
            <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>{m.name}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---- ラベル付きフィールド ----
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>{label}</label>
      {children}
    </div>
  );
}
