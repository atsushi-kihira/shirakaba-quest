// =============================================================
// 管理画面 — イベント管理
// =============================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { api } from "@/lib/api";
import type { EventCampaign, EventType } from "@shared/types";

type EventsResponse = { data: EventCampaign[] };
type MembersResponse = { data: Array<{ id: string; name: string; emoji: string }> };

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  special_quest_week:  "📅 特別お題ウィーク",
  welcome_quest:       "🎉 新メンバー歓迎クエスト",
  featured_member:     "⭐ 注目メンバーフォーカス",
  visitor_invite_quest: "🤝 ビジター招待",
};

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

  const events = data?.data ?? [];
  const members = membersData?.data ?? [];

  const endEvent = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/events/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "events"] }),
  });

  const now = Math.floor(Date.now() / 1000);

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
      <p className="text-sm mb-6" style={{ color: "var(--color-ink-500)" }}>
        期間限定イベントを設定できます。アクティブ中のイベントはホーム画面に表示されます。
      </p>

      {isLoading ? (
        <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>読み込み中...</div>
      ) : events.length === 0 ? (
        <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>
          イベントがまだありません。「新規作成」から作ってみましょう。
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((ev) => {
            const isActive = ev.status === "active" && (!ev.endsAt || ev.endsAt >= now);
            const relatedMember = members.find((m) => m.id === ev.relatedMemberId);
            return (
              <div key={ev.id}>
                {editId === ev.id ? (
                  <EditEventForm event={ev} members={members} onDone={() => setEditId(null)} />
                ) : (
                  <div className="card-paper p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                            {EVENT_TYPE_LABELS[ev.type as EventType] ?? ev.type}
                          </span>
                          {isActive && (
                            <span className="text-xs px-2 py-0.5 rounded-full text-white font-bold"
                              style={{ background: "var(--color-success)" }}>
                              実施中
                            </span>
                          )}
                          {!isActive && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                              style={{ background: "var(--color-paper-300)", color: "var(--color-ink-500)" }}>
                              終了
                            </span>
                          )}
                        </div>
                        <p className="font-semibold mt-1" style={{ color: "var(--color-ink-800)" }}>{ev.title}</p>
                        {ev.description && (
                          <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-600)" }}>{ev.description}</p>
                        )}
                        {relatedMember && (
                          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
                            対象: {relatedMember.emoji} {relatedMember.name}
                          </p>
                        )}
                        <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
                          {new Date(ev.startsAt * 1000).toLocaleDateString("ja-JP")}
                          {" 〜 "}
                          {ev.endsAt ? new Date(ev.endsAt * 1000).toLocaleDateString("ja-JP") : "（終了日未設定）"}
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        {isActive && (
                          <button
                            onClick={() => setEditId(ev.id)}
                            className="p-2 rounded-2xl transition hover:opacity-80"
                            style={{ background: "var(--color-paper-200)" }}
                            title="編集"
                          >
                            <Pencil size={14} style={{ color: "var(--color-ink-500)" }} />
                          </button>
                        )}
                        {isActive && (
                          <button
                            onClick={() => endEvent.mutate(ev.id)}
                            disabled={endEvent.isPending}
                            className="p-2 rounded-2xl transition hover:opacity-80"
                            style={{ background: "var(--color-paper-200)" }}
                            title="終了"
                          >
                            <Trash2 size={14} style={{ color: "var(--color-brand)" }} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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
  const [relatedMemberId, setRelatedMemberId] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.post("/admin/events", {
        type,
        title: title.trim(),
        description: description.trim(),
        relatedMemberId: relatedMemberId || undefined,
        endsAt: endsAt ? Math.floor(new Date(endsAt).getTime() / 1000) : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "events"] });
      onClose();
    },
  });

  const needsMember = type === "welcome_quest" || type === "featured_member";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-6 w-full max-w-md rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-klee)" }}>📣 新しいイベント</h2>
          <button onClick={onClose} className="p-1.5 rounded-full" style={{ background: "var(--color-paper-200)" }}>
            <X size={16} style={{ color: "var(--color-ink-500)" }} />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>種別 *</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as EventType)}
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{ borderColor: "var(--color-paper-300)" }}
            >
              {(Object.entries(EVENT_TYPE_LABELS) as [EventType, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>タイトル *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: 7月 特別お題ウィーク"
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{ borderColor: "var(--color-paper-300)" }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>説明（任意）</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
              style={{ borderColor: "var(--color-paper-300)" }}
            />
          </div>
          {needsMember && (
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
                {type === "welcome_quest" ? "対象メンバー（新メンバー）" : "注目メンバー"} *
              </label>
              <select
                value={relatedMemberId}
                onChange={(e) => setRelatedMemberId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)" }}
              >
                <option value="">-- 選択してください --</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.emoji} {m.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>終了日（任意）</label>
            <input
              type="date"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{ borderColor: "var(--color-paper-300)" }}
            />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl text-sm font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            キャンセル
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={!title.trim() || (needsMember && !relatedMemberId) || create.isPending}
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

// ---- 編集フォーム ----
function EditEventForm({
  event,
  members,
  onDone,
}: {
  event: EventCampaign;
  members: Array<{ id: string; name: string; emoji: string }>;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description);
  const [relatedMemberId, setRelatedMemberId] = useState(event.relatedMemberId ?? "");

  const save = useMutation({
    mutationFn: () => api.patch(`/admin/events/${event.id}`, {
      title: title.trim(),
      description: description.trim(),
      relatedMemberId: relatedMemberId || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "events"] });
      onDone();
    },
  });

  const needsMember = event.type === "welcome_quest" || event.type === "featured_member";

  return (
    <div className="card-paper p-4 border-2" style={{ borderColor: "var(--color-brand)" }}>
      <div className="space-y-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border text-sm font-semibold"
          style={{ borderColor: "var(--color-paper-300)" }} />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)}
          rows={2} className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
          style={{ borderColor: "var(--color-paper-300)" }} />
        {needsMember && (
          <select value={relatedMemberId} onChange={(e) => setRelatedMemberId(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border text-sm"
            style={{ borderColor: "var(--color-paper-300)" }}>
            <option value="">-- 選択してください --</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.emoji} {m.name}</option>
            ))}
          </select>
        )}
      </div>
      <div className="flex gap-2 mt-3">
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
