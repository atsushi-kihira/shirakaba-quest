// =============================================================
// 管理画面 — イベント管理（種別定義 + インスタンス統合ビュー）
// Layer 1: event_type_definitions（種別テンプレート）
// Layer 2: event_campaigns（種別に紐づくインスタンス）
// =============================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, ChevronDown, ChevronUp, Pencil, Check, X,
  Trash2, RotateCcw, StopCircle, Lock,
} from "lucide-react";
import { api } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";
import { fmtDateISO, tsToDateInput } from "@/lib/date";
import type { EventTypeDefinition } from "@shared/types";

// ---- 型定義 ----
type Instance = {
  id: string;
  type: string;
  eventTypeDefId: string | null;
  title: string;
  description: string;
  startsAt: number;
  endsAt: number | null;
  relatedMemberId: string | null;
  relatedMemberIds: string[];
  multiplier: number | null;
  status: "active" | "ended" | "deleted";
  createdByMemberId: string | null;
  createdAt: number;
};

type Member = { id: string; name: string; emoji: string; status: string };
type TypeDefsResponse = { data: EventTypeDefinition[] };
type InstancesResponse = { data: Instance[] };
type MembersResponse = { data: Member[] };

// ---- ラベル定義 ----
const TRIGGER_LABELS: Record<string, string> = {
  on_action:    "アクションの実施時",
  display_only: "表示のみ（ポイントなし）",
  // レガシー（自動付与系、管理UIには表示しない）
  one_on_one:         "1to1完了時（自動）",
  meeting_attendance: "ミーティング参加時（自動）",
};
const CREATOR_LABELS: Record<string, string> = {
  admin:  "管理者のみ",
  member: "一般ユーザーも可",
};

// ---- 種別編集フォーム（インライン）----
function TypeDefEditForm({ typeDef, instanceCount, onDone }: { typeDef: EventTypeDefinition; instanceCount: number; onDone: () => void }) {
  const qc = useQueryClient();

  const [name, setName] = useState(typeDef.name);
  const [description, setDescription] = useState(typeDef.description);
  const [emoji, setEmoji] = useState(typeDef.emoji);
  // on_action / display_only のみ選択可。レガシー値は on_action にフォールバック
  const [triggerType, setTriggerType] = useState<"on_action" | "display_only">(
    typeDef.triggerType === "display_only" ? "display_only" : "on_action"
  );
  const [hasPoints, setHasPoints] = useState(typeDef.pointValue > 0);
  const [requiresTarget, setRequiresTarget] = useState(typeDef.requiresTargetMember === 1);
  const [creatorRole, setCreatorRole] = useState(typeDef.creatorRole);
  const [linksToMeeting, setLinksToMeeting] = useState(typeDef.linksToMeeting === 1);

  const effectiveHasPoints = triggerType === "on_action" && hasPoints;

  const save = useMutation({
    mutationFn: () => api.patch(`/admin/event-type-definitions/${typeDef.id}`, {
      name: name.trim(),
      description: description.trim(),
      emoji: emoji.trim() || typeDef.emoji,
      triggerType,
      pointValue: effectiveHasPoints ? 1 : 0,
      requiresTargetMember: requiresTarget,
      creatorRole,
      linksToMeeting,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "event-type-definitions"] });
      onDone();
    },
  });

  return (
    <div className="p-4 border-t space-y-3" style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}>
      <p className="text-xs font-semibold" style={{ color: "var(--color-brand)" }}>種別設定を編集</p>

      {instanceCount > 0 && (
        <p className="text-xs px-3 py-2 rounded-xl"
          style={{ background: "rgba(212,160,59,0.12)", color: "var(--color-accent)", border: "1px solid rgba(212,160,59,0.3)" }}>
          ⚠️ この種別には既に {instanceCount} 件のイベントが作成されています。設定変更は管理者責任のもとで行ってください。
        </p>
      )}

      <div className="grid grid-cols-[60px_1fr] gap-2">
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>絵文字</label>
          <input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4}
            className="w-full px-2 py-2 rounded-xl border text-center text-xl"
            style={{ borderColor: "var(--color-paper-300)" }} />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>種別名 *</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border text-sm"
            style={{ borderColor: "var(--color-paper-300)" }} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>説明</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
          className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
          style={{ borderColor: "var(--color-paper-300)" }} />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>トリガー</label>
        <select value={triggerType} onChange={(e) => setTriggerType(e.target.value as "on_action" | "display_only")}
          className="w-full px-3 py-2 rounded-xl border text-sm"
          style={{ borderColor: "var(--color-paper-300)" }}>
          <option value="on_action">アクションの実施時</option>
          <option value="display_only">表示のみ（ポイントなし）</option>
        </select>
      </div>

      {triggerType === "on_action" && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={hasPoints} onChange={(e) => setHasPoints(e.target.checked)} className="rounded" />
          <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>ポイント設定あり（各イベントで加算ポイントを設定）</span>
        </label>
      )}

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={requiresTarget} onChange={(e) => setRequiresTarget(e.target.checked)} className="rounded" />
          <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>対象メンバーの指定が必要</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={linksToMeeting} onChange={(e) => setLinksToMeeting(e.target.checked)} className="rounded" />
          <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>ミーティング連携</span>
        </label>
      </div>
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>インスタンス作成権限</label>
        <div className="grid grid-cols-2 gap-2">
          {(["admin", "member"] as const).map((r) => (
            <button key={r} onClick={() => setCreatorRole(r)}
              className="py-2 rounded-2xl text-sm font-medium transition"
              style={{
                background: creatorRole === r ? "var(--color-brand)" : "var(--color-paper-200)",
                color: creatorRole === r ? "white" : "var(--color-ink-600)",
              }}>
              {CREATOR_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={onDone}
          className="flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          <X size={12} /> キャンセル
        </button>
        <button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}
          className="flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs text-white disabled:opacity-50"
          style={{ background: "var(--color-success)" }}>
          <Check size={12} /> 保存
        </button>
      </div>
    </div>
  );
}

// ---- インスタンスカード ----
function InstanceCard({
  instance: inst, members, onEdit, onEnd, onDelete, onRestore,
}: {
  instance: Instance;
  members: Member[];
  onEdit: (() => void) | null;
  onEnd: (() => void) | null;
  onDelete: (() => void) | null;
  onRestore: (() => void) | null;
}) {
  const { timezone: tz } = useSettings();
  const relatedNames = inst.relatedMemberIds
    .map((id) => members.find((m) => m.id === id))
    .filter(Boolean)
    .map((m) => `${m!.emoji} ${m!.name}`);
  const creatorMember = inst.createdByMemberId
    ? members.find((m) => m.id === inst.createdByMemberId)
    : null;

  const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
    active:  { bg: "rgba(90,140,92,0.12)",  color: "var(--color-success)", label: "実施中" },
    ended:   { bg: "var(--color-paper-300)", color: "var(--color-ink-500)", label: "終了" },
    deleted: { bg: "rgba(181,56,75,0.08)",  color: "var(--color-brand)",   label: "削除済み" },
  };
  const style = STATUS_STYLE[inst.status] ?? STATUS_STYLE.active;

  return (
    <div className="flex items-start gap-3 px-3 py-3 rounded-2xl mt-2"
      style={{ background: inst.status === "deleted" ? "var(--color-paper-100)" : "var(--color-paper-200)", opacity: inst.status !== "active" ? 0.75 : 1 }}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: style.bg, color: style.color }}>
            {style.label}
          </span>
          <span className="text-sm font-semibold truncate" style={{ color: "var(--color-ink-800)" }}>{inst.title}</span>
          {creatorMember && (
            <span className="text-xs px-1.5 py-0.5 rounded-full"
              style={{ background: "rgba(90,140,92,0.1)", color: "var(--color-success)" }}>
              👤 {creatorMember.emoji}{creatorMember.name} 作成
            </span>
          )}
        </div>
        {inst.description && (
          <p className="text-xs truncate mb-0.5" style={{ color: "var(--color-ink-500)" }}>{inst.description}</p>
        )}
        {relatedNames.length > 0 && (
          <p className="text-xs" style={{ color: "var(--color-ink-600)" }}>対象: {relatedNames.join("、")}</p>
        )}
        <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>
          {fmtDateISO(inst.startsAt, tz)}
          {inst.endsAt ? ` 〜 ${fmtDateISO(inst.endsAt, tz)}` : ""}
          {inst.multiplier ? ` · +${inst.multiplier}pt` : ""}
        </p>
      </div>
      <div className="flex gap-1 shrink-0">
        {onRestore && (
          <button onClick={onRestore} title="再開" className="p-1.5 rounded-xl hover:opacity-70"
            style={{ background: "rgba(90,140,92,0.12)", color: "var(--color-success)" }}>
            <RotateCcw size={13} />
          </button>
        )}
        {onEdit && (
          <button onClick={onEdit} title="編集" className="p-1.5 rounded-xl hover:opacity-70"
            style={{ background: "var(--color-paper-300)", color: "var(--color-ink-500)" }}>
            <Pencil size={13} />
          </button>
        )}
        {onEnd && (
          <button onClick={onEnd} title="終了" className="p-1.5 rounded-xl hover:opacity-70"
            style={{ background: "rgba(212,160,59,0.12)", color: "var(--color-accent)" }}>
            <StopCircle size={13} />
          </button>
        )}
        {onDelete && (
          <button onClick={onDelete} title="削除" className="p-1.5 rounded-xl hover:opacity-70"
            style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

// ---- インスタンス編集フォーム ----
function EditInstanceForm({
  instance, members, allTypeDefs, onSave, onCancel, isPending,
}: {
  instance: Instance;
  members: Member[];
  allTypeDefs: EventTypeDefinition[];
  onSave: (body: object) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const { timezone: tz } = useSettings();
  const currentDef = allTypeDefs.find((t) => t.id === instance.eventTypeDefId);
  const [selectedTypeDefId, setSelectedTypeDefId] = useState(instance.eventTypeDefId ?? "");
  const [title, setTitle] = useState(instance.title);
  const [description, setDescription] = useState(instance.description);
  const [startsAt, setStartsAt] = useState(instance.startsAt ? tsToDateInput(instance.startsAt, tz) : "");
  const [endsAt, setEndsAt] = useState(instance.endsAt ? tsToDateInput(instance.endsAt, tz) : "");
  const [multiplier, setMultiplier] = useState(instance.multiplier ? String(instance.multiplier) : "");
  const [selectedIds, setSelectedIds] = useState<string[]>(instance.relatedMemberIds);

  const activeMembers = members.filter((m) => m.status === "active");
  const resolvedDef = allTypeDefs.find((t) => t.id === selectedTypeDefId) ?? currentDef;
  const needsTarget = resolvedDef?.requiresTargetMember === 1;
  const typeChanged = selectedTypeDefId !== (instance.eventTypeDefId ?? "");

  function toggleMember(id: string) {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  return (
    <div className="mt-2 p-3 rounded-2xl space-y-2 border-2"
      style={{ borderColor: "var(--color-brand)", background: "var(--color-paper-50)" }}>
      {/* 種別変更 */}
      <div>
        <p className="text-xs mb-1 font-medium" style={{ color: "var(--color-ink-500)" }}>イベント種別</p>
        <select value={selectedTypeDefId} onChange={(e) => setSelectedTypeDefId(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border text-sm"
          style={{ borderColor: typeChanged ? "var(--color-accent)" : "var(--color-paper-300)" }}>
          <option value="">-- 種別なし --</option>
          {allTypeDefs.filter((t) => t.isActive || t.id === selectedTypeDefId).map((t) => (
            <option key={t.id} value={t.id}>{t.emoji} {t.name}</option>
          ))}
        </select>
        {typeChanged && (
          <p className="text-xs mt-0.5" style={{ color: "var(--color-accent)" }}>⚠ 種別が変更されます</p>
        )}
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="タイトル"
        className="w-full px-3 py-2 rounded-xl border text-sm font-semibold"
        style={{ borderColor: "var(--color-paper-300)" }} />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)}
        placeholder="説明（任意）" rows={2}
        className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
        style={{ borderColor: "var(--color-paper-300)" }} />
      {needsTarget && (
        <div className="max-h-40 overflow-y-auto space-y-1 rounded-xl p-2"
          style={{ background: "var(--color-paper-200)" }}>
          <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-500)" }}>対象メンバー</p>
          {activeMembers.map((m) => (
            <label key={m.id} className="flex items-center gap-2 cursor-pointer px-2 py-1 rounded-lg hover:opacity-80"
              style={{ background: selectedIds.includes(m.id) ? "rgba(181,56,75,0.1)" : "transparent" }}>
              <input type="checkbox" checked={selectedIds.includes(m.id)} onChange={() => toggleMember(m.id)} className="sr-only" />
              <span>{m.emoji} {m.name}</span>
              {selectedIds.includes(m.id) && <Check size={12} className="ml-auto" style={{ color: "var(--color-brand)" }} />}
            </label>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>開始日</p>
          <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
            className="w-full px-2 py-1.5 rounded-xl border text-sm"
            style={{ borderColor: "var(--color-paper-300)" }} />
        </div>
        <div>
          <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>終了日</p>
          <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
            className="w-full px-2 py-1.5 rounded-xl border text-sm"
            style={{ borderColor: "var(--color-paper-300)" }} />
        </div>
      </div>
      <div>
        <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>加算ポイント（任意・空欄=なし）</p>
        <input type="number" min={0} value={multiplier} onChange={(e) => setMultiplier(e.target.value)}
          placeholder="例: 3"
          className="w-full px-2 py-1.5 rounded-xl border text-sm"
          style={{ borderColor: "var(--color-paper-300)" }} />
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onCancel}
          className="flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          <X size={12} /> キャンセル
        </button>
        <button
          onClick={() => onSave({
            typeDefId: typeChanged ? (selectedTypeDefId || null) : undefined,
            title: title.trim(),
            description: description.trim(),
            startsAt: startsAt ? Math.floor(new Date(startsAt).getTime() / 1000) : undefined,
            endsAt: endsAt ? Math.floor(new Date(endsAt).getTime() / 1000) : null,
            multiplier: multiplier ? Number(multiplier) : null,
            relatedMemberIds: needsTarget ? selectedIds : undefined,
          })}
          disabled={!title.trim() || isPending}
          className="flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs text-white disabled:opacity-50"
          style={{ background: "var(--color-success)" }}>
          <Check size={12} /> 保存
        </button>
      </div>
    </div>
  );
}

// ---- インスタンス新規作成フォーム（管理者作成用）----
function CreateInstanceForm({
  typeDef, members, onDone, onCancel,
}: {
  typeDef: EventTypeDefinition;
  members: Member[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const { timezone: tz } = useSettings();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState(tsToDateInput(Math.floor(Date.now() / 1000), tz));
  const [endsAt, setEndsAt] = useState("");
  const [multiplier, setMultiplier] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const activeMembers = members.filter((m) => m.status === "active");
  const needsTarget = typeDef.requiresTargetMember === 1;

  const create = useMutation({
    mutationFn: () => api.post("/admin/events", {
      typeDefId: typeDef.id,
      title: title.trim(),
      description: description.trim(),
      startsAt: startsAt ? Math.floor(new Date(startsAt).getTime() / 1000) : undefined,
      endsAt: endsAt ? Math.floor(new Date(endsAt).getTime() / 1000) : undefined,
      relatedMemberIds: selectedIds.length > 0 ? selectedIds : undefined,
      multiplier: multiplier ? Number(multiplier) : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "events"] });
      qc.invalidateQueries({ queryKey: ["events", "active"] });
      onDone();
    },
  });

  function toggleMember(id: string) {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  return (
    <div className="mt-3 p-4 rounded-2xl space-y-3 border-2"
      style={{ borderColor: "rgba(181,56,75,0.3)", background: "var(--color-paper-50)" }}>
      <p className="text-xs font-semibold" style={{ color: "var(--color-brand)" }}>新しいイベントを作成</p>
      <input value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder={`タイトル（例: 7月${typeDef.name}）`}
        className="w-full px-3 py-2 rounded-xl border text-sm"
        style={{ borderColor: "var(--color-paper-300)" }} />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)}
        placeholder="説明（任意）" rows={2}
        className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
        style={{ borderColor: "var(--color-paper-300)" }} />
      {needsTarget && (
        <div>
          <p className="text-xs font-medium mb-1.5" style={{ color: "var(--color-ink-500)" }}>対象メンバー</p>
          <div className="max-h-44 overflow-y-auto space-y-1 rounded-xl p-2"
            style={{ background: "var(--color-paper-200)" }}>
            {activeMembers.map((m) => (
              <label key={m.id} className="flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded-lg hover:opacity-80"
                style={{ background: selectedIds.includes(m.id) ? "rgba(181,56,75,0.1)" : "transparent" }}>
                <input type="checkbox" checked={selectedIds.includes(m.id)} onChange={() => toggleMember(m.id)} className="sr-only" />
                <span className="text-sm">{m.emoji} {m.name}</span>
                {selectedIds.includes(m.id) && <Check size={13} className="ml-auto" style={{ color: "var(--color-brand)" }} />}
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>開始日</p>
          <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
            className="w-full px-2 py-1.5 rounded-xl border text-sm"
            style={{ borderColor: "var(--color-paper-300)" }} />
        </div>
        <div>
          <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>終了日（任意）</p>
          <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
            className="w-full px-2 py-1.5 rounded-xl border text-sm"
            style={{ borderColor: "var(--color-paper-300)" }} />
        </div>
      </div>
      <div>
        <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>加算ポイント（任意・空欄=なし）</p>
        <input type="number" min={0} value={multiplier} onChange={(e) => setMultiplier(e.target.value)}
          placeholder="例: 3"
          className="w-full px-2 py-1.5 rounded-xl border text-sm"
          style={{ borderColor: "var(--color-paper-300)" }} />
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel}
          className="flex items-center gap-1 px-3 py-2 rounded-2xl text-sm"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          <X size={13} /> キャンセル
        </button>
        <button
          onClick={() => create.mutate()}
          disabled={!title.trim() || (needsTarget && selectedIds.length === 0) || create.isPending}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-2xl text-sm text-white disabled:opacity-50"
          style={{ background: "var(--color-brand)" }}>
          <Plus size={13} /> 作成する
        </button>
      </div>
    </div>
  );
}

// ---- 種別セクション（インスタンス管理＋種別編集）----
function TypeDefSection({
  typeDef, allTypeDefs, instances, members, onRefresh,
}: {
  typeDef: EventTypeDefinition;
  allTypeDefs: EventTypeDefinition[];
  instances: Instance[];
  members: Member[];
  onRefresh: () => void;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [editingTypeDef, setEditingTypeDef] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [showEnded, setShowEnded] = useState(false);

  const toggleTypeDef = useMutation({
    mutationFn: (isActive: boolean) =>
      api.patch(`/admin/event-type-definitions/${typeDef.id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "event-type-definitions"] }),
  });

  const updateInstance = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      api.patch(`/admin/events/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "events"] });
      setEditId(null);
      onRefresh();
    },
  });

  const deleteInstance = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/events/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "events"] });
      onRefresh();
    },
  });

  const activeInstances  = instances.filter((i) => i.status === "active");
  const endedInstances   = instances.filter((i) => i.status === "ended");
  const deletedInstances = instances.filter((i) => i.status === "deleted");
  const isAdminCreator = typeDef.creatorRole === "admin";
  const isMeetingLinked = typeDef.linksToMeeting === 1;

  return (
    <div className="card-paper rounded-3xl overflow-hidden">
      {/* セクションヘッダー */}
      <div className="w-full flex items-center gap-3 px-5 py-4"
        style={{ background: typeDef.isActive ? "transparent" : "var(--color-paper-200)" }}>
        {/* クリックで展開/折りたたみ */}
        <button onClick={() => setExpanded((v) => !v)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          <span className="text-2xl">{typeDef.emoji}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-base" style={{
                fontFamily: "var(--font-klee)",
                color: typeDef.isActive ? "var(--color-ink-900)" : "var(--color-ink-400)",
              }}>
                {typeDef.name}
              </span>
              {typeDef.isSystem === 1 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full inline-flex items-center gap-1"
                  style={{ background: "var(--color-paper-300)", color: "var(--color-ink-500)" }}>
                  <Lock size={10} /> システム
                </span>
              )}
              <span className="text-xs px-1.5 py-0.5 rounded-full"
                style={{
                  background: isAdminCreator ? "rgba(181,56,75,0.12)" : "rgba(90,140,92,0.12)",
                  color: isAdminCreator ? "var(--color-brand)" : "var(--color-success)",
                }}>
                {isAdminCreator ? "管理者作成" : "メンバー作成"}
              </span>
              {isMeetingLinked && (
                <span className="text-xs px-1.5 py-0.5 rounded-full"
                  style={{ background: "rgba(212,160,59,0.15)", color: "var(--color-accent)" }}>
                  ミーティング連携
                </span>
              )}
              <span className="text-xs px-1.5 py-0.5 rounded-full"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}>
                {TRIGGER_LABELS[typeDef.triggerType] ?? typeDef.triggerType}
              </span>
              {typeDef.pointValue > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full"
                  style={{ background: "rgba(212,160,59,0.12)", color: "var(--color-accent)" }}>
                  ポイントあり
                </span>
              )}
              {!typeDef.isActive && (
                <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                  style={{ background: "var(--color-paper-300)", color: "var(--color-ink-400)" }}>無効</span>
              )}
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>
              {activeInstances.length}件実施中
              {endedInstances.length > 0 && ` · ${endedInstances.length}件終了`}
              {deletedInstances.length > 0 && ` · ${deletedInstances.length}件削除済み`}
            </p>
          </div>
        </button>

        {/* ボタン群 */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setEditingTypeDef((v) => !v); setExpanded(true); }}
            title="種別設定を編集"
            className="p-1.5 rounded-xl transition hover:opacity-80"
            style={{ background: editingTypeDef ? "var(--color-brand)" : "var(--color-paper-200)", color: editingTypeDef ? "white" : "var(--color-ink-500)" }}>
            <Pencil size={13} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); toggleTypeDef.mutate(!typeDef.isActive); }}
            disabled={toggleTypeDef.isPending}
            className="text-xs px-2.5 py-1 rounded-xl transition disabled:opacity-50"
            style={{
              background: typeDef.isActive ? "rgba(90,140,92,0.12)" : "var(--color-paper-300)",
              color: typeDef.isActive ? "var(--color-success)" : "var(--color-ink-500)",
            }}>
            {typeDef.isActive ? "有効" : "再開"}
          </button>
          <button onClick={() => setExpanded((v) => !v)}>
            {expanded ? <ChevronUp size={16} style={{ color: "var(--color-ink-400)" }} /> : <ChevronDown size={16} style={{ color: "var(--color-ink-400)" }} />}
          </button>
        </div>
      </div>

      {/* 種別編集フォーム（インライン）*/}
      {editingTypeDef && (
        <TypeDefEditForm
          typeDef={typeDef}
          instanceCount={activeInstances.length + endedInstances.length}
          onDone={() => setEditingTypeDef(false)}
        />
      )}

      {/* セクション本体 */}
      {expanded && !editingTypeDef && (
        <div className="px-5 pb-4 space-y-3 border-t" style={{ borderColor: "var(--color-paper-300)" }}>
          {typeDef.description && (
            <p className="text-xs pt-3" style={{ color: "var(--color-ink-500)" }}>{typeDef.description}</p>
          )}

          {isMeetingLinked && (
            <p className="text-xs py-2 px-3 rounded-xl"
              style={{ background: "rgba(212,160,59,0.1)", color: "var(--color-ink-600)" }}>
              ☕ 新しいイベントはミーティング作成時に種別を選択することで作成されます。
            </p>
          )}

          {!isMeetingLinked && isAdminCreator && !showCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="mt-3 flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-medium transition hover:opacity-80"
              style={{ background: "var(--color-brand)", color: "white" }}>
              <Plus size={14} /> 新しいイベントを作成する
            </button>
          )}

          {!isMeetingLinked && showCreate && (
            <CreateInstanceForm
              typeDef={typeDef} members={members}
              onDone={() => { setShowCreate(false); onRefresh(); }}
              onCancel={() => setShowCreate(false)}
            />
          )}

          {activeInstances.length === 0 && !showCreate && (
            <p className="text-xs py-2" style={{ color: "var(--color-ink-300)" }}>
              {isMeetingLinked ? "ミーティング連携のイベントはまだありません" :
               isAdminCreator ? "実施中のイベントはありません" : "メンバーが作成したイベントはありません"}
            </p>
          )}
          {activeInstances.map((inst) =>
            editId === inst.id ? (
              <EditInstanceForm
                key={inst.id} instance={inst} members={members} allTypeDefs={allTypeDefs}
                onSave={(body) => updateInstance.mutate({ id: inst.id, body })}
                onCancel={() => setEditId(null)} isPending={updateInstance.isPending}
              />
            ) : (
              <InstanceCard
                key={inst.id} instance={inst} members={members}
                onEdit={() => setEditId(inst.id)}
                onEnd={() => { if (window.confirm(`「${inst.title}」を終了しますか？`)) updateInstance.mutate({ id: inst.id, body: { status: "ended" } }); }}
                onDelete={() => { if (window.confirm(`「${inst.title}」を削除しますか？`)) deleteInstance.mutate(inst.id); }}
                onRestore={null}
              />
            )
          )}

          {/* 終了済み */}
          {endedInstances.length > 0 && (
            <div>
              <button onClick={() => setShowEnded((v) => !v)}
                className="flex items-center gap-1.5 text-xs py-1"
                style={{ color: "var(--color-ink-400)" }}>
                {showEnded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                終了済み（{endedInstances.length}件）
              </button>
              {showEnded && endedInstances.map((inst) =>
                editId === inst.id ? (
                  <EditInstanceForm
                    key={inst.id} instance={inst} members={members} allTypeDefs={allTypeDefs}
                    onSave={(body) => updateInstance.mutate({ id: inst.id, body })}
                    onCancel={() => setEditId(null)} isPending={updateInstance.isPending}
                  />
                ) : (
                  <InstanceCard
                    key={inst.id} instance={inst} members={members}
                    onEdit={() => setEditId(inst.id)}
                    onEnd={null}
                    onDelete={() => { if (window.confirm(`「${inst.title}」を削除しますか？`)) deleteInstance.mutate(inst.id); }}
                    onRestore={() => updateInstance.mutate({ id: inst.id, body: { status: "active" } })}
                  />
                )
              )}
            </div>
          )}

          {/* 削除済み */}
          {deletedInstances.length > 0 && (
            <div>
              <button onClick={() => setShowDeleted((v) => !v)}
                className="flex items-center gap-1.5 text-xs py-1"
                style={{ color: "var(--color-ink-300)" }}>
                {showDeleted ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                削除済み（{deletedInstances.length}件）
              </button>
              {showDeleted && deletedInstances.map((inst) => (
                <InstanceCard
                  key={inst.id} instance={inst} members={members}
                  onEdit={null} onEnd={null} onDelete={null}
                  onRestore={() => updateInstance.mutate({ id: inst.id, body: { status: "active" } })}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- 新規種別作成モーダル ----
function CreateTypeModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState("🎪");
  const [triggerType, setTriggerType] = useState<"on_action" | "display_only">("on_action");
  const [hasPoints, setHasPoints] = useState(false);
  const [requiresTarget, setRequiresTarget] = useState(false);
  const [creatorRole, setCreatorRole] = useState<"admin" | "member">("admin");
  const [linksToMeeting, setLinksToMeeting] = useState(false);

  const effectiveHasPoints = triggerType === "on_action" && hasPoints;

  const create = useMutation({
    mutationFn: () => api.post("/admin/event-type-definitions", {
      name: name.trim(), description: description.trim(),
      emoji: emoji || "🎪", triggerType,
      pointValue: effectiveHasPoints ? 1 : 0,
      requiresTargetMember: requiresTarget,
      creatorRole, linksToMeeting,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "event-type-definitions"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-6 w-full max-w-md rounded-3xl max-h-[92dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-klee)" }}>🎪 新しいイベント種別</h2>
          <button onClick={onClose} className="p-1.5 rounded-full" style={{ background: "var(--color-paper-200)" }}>
            <X size={16} style={{ color: "var(--color-ink-500)" }} />
          </button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-[60px_1fr] gap-2">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>絵文字</label>
              <input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4}
                className="w-full px-2 py-2 rounded-xl border text-center text-xl"
                style={{ borderColor: "var(--color-paper-300)" }} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>種別名 *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 懇親会"
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)" }} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>説明（任意）</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
              style={{ borderColor: "var(--color-paper-300)" }} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>トリガー</label>
            <select value={triggerType} onChange={(e) => setTriggerType(e.target.value as "on_action" | "display_only")}
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{ borderColor: "var(--color-paper-300)" }}>
              <option value="on_action">アクションの実施時</option>
              <option value="display_only">表示のみ（ポイントなし）</option>
            </select>
          </div>
          {triggerType === "on_action" && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={hasPoints} onChange={(e) => setHasPoints(e.target.checked)} className="rounded" />
              <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>ポイント設定あり（各イベントで加算ポイントを設定）</span>
            </label>
          )}
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={requiresTarget} onChange={(e) => setRequiresTarget(e.target.checked)} className="rounded" />
              <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>対象メンバーの指定が必要</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={linksToMeeting} onChange={(e) => setLinksToMeeting(e.target.checked)} className="rounded" />
              <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>ミーティング連携</span>
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>インスタンス作成権限</label>
            <div className="grid grid-cols-2 gap-2">
              {(["admin", "member"] as const).map((r) => (
                <button key={r} onClick={() => setCreatorRole(r)}
                  className="py-2 rounded-2xl text-sm font-medium transition"
                  style={{
                    background: creatorRole === r ? "var(--color-brand)" : "var(--color-paper-200)",
                    color: creatorRole === r ? "white" : "var(--color-ink-600)",
                  }}>
                  {CREATOR_LABELS[r]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl text-sm font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            キャンセル
          </button>
          <button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}
            className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}>
            <Plus size={14} /> 作成する
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- メイン画面 ----
export function AdminEventTypesScreen() {
  const qc = useQueryClient();
  const [showCreateType, setShowCreateType] = useState(false);

  const { data: typeDefsData, isLoading: loadingTypes } = useQuery({
    queryKey: ["admin", "event-type-definitions"],
    queryFn: () => api.get<TypeDefsResponse>("/admin/event-type-definitions"),
  });

  const { data: instancesData, isLoading: loadingInst, refetch } = useQuery({
    queryKey: ["admin", "events"],
    queryFn: () => api.get<InstancesResponse>("/admin/events"),
  });

  const { data: membersData } = useQuery({
    queryKey: ["admin", "members"],
    queryFn: () => api.get<MembersResponse>("/admin/members"),
  });

  const typeDefs  = typeDefsData?.data ?? [];
  const instances = instancesData?.data ?? [];
  const members   = membersData?.data ?? [];

  const instancesByTypeDef = new Map<string, Instance[]>();
  const uncategorized: Instance[] = [];
  for (const inst of instances) {
    if (inst.eventTypeDefId) {
      const arr = instancesByTypeDef.get(inst.eventTypeDefId) ?? [];
      arr.push(inst);
      instancesByTypeDef.set(inst.eventTypeDefId, arr);
    } else {
      uncategorized.push(inst);
    }
  }

  function onRefresh() {
    qc.invalidateQueries({ queryKey: ["admin", "events"] });
    refetch();
  }

  if (loadingTypes || loadingInst) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: "var(--color-brand)" }} />
      </div>
    );
  }

  return (
    <div className="px-4 py-6 pb-24 lg:px-0">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            📣 イベント管理
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>
            イベント種別の設定と、各種別のイベント一覧を管理します
          </p>
        </div>
        <button
          onClick={() => setShowCreateType(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-medium text-white"
          style={{ background: "var(--color-brand)" }}>
          <Plus size={14} /> 新しい種別
        </button>
      </div>

      <div className="space-y-4">
        {typeDefs.map((td) => (
          <TypeDefSection
            key={td.id}
            typeDef={td}
            allTypeDefs={typeDefs}
            instances={instancesByTypeDef.get(td.id) ?? []}
            members={members}
            onRefresh={onRefresh}
          />
        ))}

        {uncategorized.filter((i) => i.status !== "deleted").length > 0 && (
          <div className="card-paper rounded-3xl p-4">
            <p className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink-600)" }}>
              📦 未分類イベント（旧データ）
            </p>
            {uncategorized.filter((i) => i.status !== "deleted").map((inst) => (
              <InstanceCard
                key={inst.id} instance={inst} members={members}
                onEdit={null} onEnd={null} onDelete={null} onRestore={null}
              />
            ))}
          </div>
        )}
      </div>

      {showCreateType && <CreateTypeModal onClose={() => setShowCreateType(false)} />}
    </div>
  );
}
