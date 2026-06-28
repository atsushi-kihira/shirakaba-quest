// =============================================================
// イベント画面（一般ユーザー向け）
// - 全イベントをフラットリストで表示（ミーティング連携除外）
// - 自分が作成したイベントは編集・終了・削除可
// - イベント種別をタイトル横にバッジで表示
// =============================================================
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, StopCircle, Trash2, Check, X, Loader2, Calendar } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import type { EventTypeDefinition } from "@shared/types";

// ---- 型定義 ----
type ActiveEvent = {
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
  pointAwardTiming: string | null;
  status: string;
  createdByMemberId: string | null;
  relatedMemberName?: string | null;
  relatedMemberEmoji?: string | null;
  relatedMembers?: { id: string; name: string; emoji: string }[];
  // イベント種別情報（バックエンドから展開）
  typeEmoji?: string | null;
  typeName?: string | null;
  triggerType?: string | null;
  pointValue?: number;
  rewardTarget?: string | null;
  requiresTargetMember?: number;
  linksToMeeting?: number;
  myParticipated?: boolean;
  creatorName?: string | null;
  creatorEmoji?: string | null;
};

type MemberOption = { id: string; name: string; emoji: string; bgColor: string };
type EventTypeDef = EventTypeDefinition & { slug: string };
type ActiveEventsResponse = { data: ActiveEvent[] };
type EventTypesResponse = { data: EventTypeDef[] };
type MembersResponse = { data: MemberOption[] };

// ---- ラベル ----
const TRIGGER_LABELS: Record<string, string> = {
  on_action:          "アクションの実施時",
  display_only:       "表示のみ（ポイントなし）",
  one_on_one:         "1to1完了時（自動）",
  meeting_attendance: "ミーティング参加時（自動）",
};

// ---- ユーティリティ ----
function toDateInput(ts: number | null | undefined): string {
  if (!ts) return "";
  return new Date(ts * 1000).toISOString().slice(0, 10);
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" });
}

// ---- 種別ポイント情報パネル（作成・編集フォーム内表示用）----
function TypeInfoPanel({ typeDef }: { typeDef: EventTypeDef }) {
  if (!typeDef) return null;
  if (typeDef.pointValue <= 0) return null;
  return (
    <div className="rounded-xl px-3 py-2 space-y-1.5"
      style={{ background: "rgba(212,160,59,0.08)", border: "1px solid rgba(212,160,59,0.25)" }}>
      <p className="text-xs font-medium" style={{ color: "var(--color-accent)" }}>この種別のポイント情報</p>
      <div className="flex flex-wrap gap-1.5">
        <span className="text-xs px-2 py-0.5 rounded-full font-bold"
          style={{ background: "rgba(212,160,59,0.15)", color: "var(--color-accent)" }}>
          ポイントあり
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full"
          style={{ background: "var(--color-paper-300)", color: "var(--color-ink-600)" }}>
          {TRIGGER_LABELS[typeDef.triggerType] ?? typeDef.triggerType}
        </span>
      </div>
    </div>
  );
}

// ---- インライン編集フォーム ----
function EditEventForm({
  event, typeDef, memberTypes, onSave, onCancel, isPending,
}: {
  event: ActiveEvent;
  typeDef: EventTypeDef | null;
  memberTypes: EventTypeDef[];
  onSave: (body: object) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description);
  const [selectedTypeDefId, setSelectedTypeDefId] = useState(event.eventTypeDefId ?? "");
  const [startsAt, setStartsAt] = useState(toDateInput(event.startsAt));
  const [endsAt, setEndsAt] = useState(toDateInput(event.endsAt));
  const [multiplier, setMultiplier] = useState(event.multiplier ? String(event.multiplier) : "");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(event.relatedMemberIds ?? []);
  const [search, setSearch] = useState("");

  const typeChanged = selectedTypeDefId !== (event.eventTypeDefId ?? "");
  const resolvedTypeDef = memberTypes.find((t) => t.id === selectedTypeDefId) ?? typeDef;
  const needsTarget = resolvedTypeDef?.requiresTargetMember === 1;

  const { data: membersData } = useQuery({
    queryKey: ["members"],
    queryFn: () => api.get<MembersResponse>("/members"),
    enabled: needsTarget,
    staleTime: 60_000,
  });
  const allMembers = membersData?.data ?? [];
  const filtered = allMembers.filter((m) => !search || m.name.includes(search) || m.emoji.includes(search));

  function toggleMember(id: string) {
    setSelectedMemberIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const canSave = title.trim() && endsAt;

  return (
    <div className="mt-2 p-3 rounded-2xl space-y-3 border-2"
      style={{ borderColor: "var(--color-brand)", background: "var(--color-paper-50)" }}>
      {/* 種別 */}
      {memberTypes.length > 1 && (
        <div>
          <p className="text-xs mb-1 font-medium" style={{ color: "var(--color-ink-500)" }}>イベント種別</p>
          <select value={selectedTypeDefId} onChange={(e) => setSelectedTypeDefId(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border text-sm"
            style={{ borderColor: typeChanged ? "var(--color-accent)" : "var(--color-paper-300)" }}>
            {memberTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.emoji} {t.name}</option>
            ))}
          </select>
          {typeChanged && <p className="text-xs mt-0.5" style={{ color: "var(--color-accent)" }}>⚠ 種別が変更されます</p>}
        </div>
      )}
      {resolvedTypeDef && <TypeInfoPanel typeDef={resolvedTypeDef} />}

      {/* タイトル・説明 */}
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="タイトル *"
        className="w-full px-3 py-2 rounded-xl border text-sm font-semibold"
        style={{ borderColor: "var(--color-paper-300)" }} />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)}
        placeholder="説明（任意）" rows={10}
        className="w-full px-3 py-2 rounded-xl border text-sm resize-y"
        style={{ borderColor: "var(--color-paper-300)" }} />

      {/* 有効期間 */}
      <div>
        <p className="text-xs font-medium mb-1.5" style={{ color: "var(--color-ink-600)" }}>
          有効期間 <span style={{ color: "var(--color-brand)" }}>*</span>
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-xs mb-1" style={{ color: "var(--color-ink-400)" }}>開始日</p>
            <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
              className="w-full px-2 py-1.5 rounded-xl border text-sm"
              style={{ borderColor: "var(--color-paper-300)" }} />
          </div>
          <div>
            <p className="text-xs mb-1" style={{ color: "var(--color-ink-400)" }}>
              終了日 <span style={{ color: "var(--color-brand)" }}>*</span>
            </p>
            <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
              className="w-full px-2 py-1.5 rounded-xl border text-sm"
              style={{ borderColor: endsAt ? "var(--color-paper-300)" : "rgba(181,56,75,0.4)" }} />
          </div>
        </div>
      </div>

      {/* 対象メンバー（複数選択） */}
      {needsTarget && (
        <div>
          <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
            対象メンバー <span className="font-normal">（複数選択可）</span>
            {selectedMemberIds.length > 0 && (
              <span className="ml-1 font-bold" style={{ color: "var(--color-brand)" }}>{selectedMemberIds.length}名</span>
            )}
          </p>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="名前で絞り込む"
            className="w-full px-3 py-1.5 rounded-xl border text-sm mb-1"
            style={{ borderColor: "var(--color-paper-300)" }} />
          <div className="max-h-36 overflow-y-auto space-y-1 rounded-xl p-2"
            style={{ background: "var(--color-paper-200)" }}>
            {filtered.map((m) => (
              <button key={m.id} onClick={() => toggleMember(m.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-xl text-left transition hover:opacity-80"
                style={{
                  background: selectedMemberIds.includes(m.id) ? "rgba(181,56,75,0.12)" : "transparent",
                  border: selectedMemberIds.includes(m.id) ? "1.5px solid rgba(181,56,75,0.3)" : "1.5px solid transparent",
                }}>
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-base ${m.bgColor}`}>{m.emoji}</span>
                <span className="flex-1 text-sm" style={{ color: "var(--color-ink-800)" }}>{m.name}</span>
                {selectedMemberIds.includes(m.id) && <Check size={13} style={{ color: "var(--color-brand)" }} />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 加算ポイント */}
      {resolvedTypeDef && resolvedTypeDef.pointValue > 0 && (
        <div>
          <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
            加算ポイント <span className="font-normal" style={{ color: "var(--color-ink-400)" }}>（任意・空欄=なし）</span>
          </p>
          <input
            type="number" min={0} value={multiplier}
            onChange={(e) => setMultiplier(e.target.value)}
            placeholder="例: 3"
            className="w-full px-3 py-1.5 rounded-xl border text-sm"
            style={{ borderColor: "var(--color-paper-300)" }}
          />
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button onClick={onCancel}
          className="flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          <X size={12} /> キャンセル
        </button>
        <button
          onClick={() => onSave({
            title: title.trim(),
            description: description.trim(),
            startsAt: startsAt ? Math.floor(new Date(startsAt).getTime() / 1000) : undefined,
            endsAt: endsAt ? Math.floor(new Date(endsAt).getTime() / 1000) : null,
            ...(typeChanged && { typeDefId: selectedTypeDefId }),
            ...(needsTarget && { relatedMemberIds: selectedMemberIds }),
            multiplier: multiplier ? Number(multiplier) : null,
          })}
          disabled={!canSave || isPending}
          className="flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs text-white disabled:opacity-50"
          style={{ background: "var(--color-success)" }}>
          <Check size={12} /> 保存
        </button>
      </div>
    </div>
  );
}

// ---- フラットリスト アイテム ----
function EventFlatItem({
  event: ev, userId, typeDef, memberTypes, editableTypeIds, onRefresh,
}: {
  event: ActiveEvent;
  userId: string;
  typeDef: EventTypeDef | null;
  memberTypes: EventTypeDef[];
  editableTypeIds: Set<string>;
  onRefresh: () => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const isOwner = ev.createdByMemberId === userId;
  const canEdit = isOwner && editableTypeIds.has(ev.eventTypeDefId ?? "");

  const effectivePointValue = ev.multiplier ?? 0;
  const hasOnComplete = ev.triggerType === "on_action";

  const participate = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; alreadyDone: boolean; pointsAwarded: number }>(
        `/events/instances/${ev.id}/participate`,
        {}
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events", "active"] });
      onRefresh();
    },
  });

  const update = useMutation({
    mutationFn: (body: object) => api.patch(`/events/instances/${ev.id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events", "active"] });
      setEditing(false);
      onRefresh();
    },
  });

  const relatedMembers =
    ev.relatedMembers && ev.relatedMembers.length > 0
      ? ev.relatedMembers
      : ev.relatedMemberId
        ? [{ id: ev.relatedMemberId, name: ev.relatedMemberName ?? "---", emoji: ev.relatedMemberEmoji ?? "" }]
        : [];

  const typeLabel =
    ev.typeEmoji && ev.typeName ? `${ev.typeEmoji} ${ev.typeName}` : typeDef ? `${typeDef.emoji} ${typeDef.name}` : null;

  const creatorLabel = isOwner ? "あなた" : (ev.creatorName ?? null);

  if (editing) {
    return (
      <EditEventForm
        event={ev}
        typeDef={typeDef}
        memberTypes={memberTypes}
        onSave={(body) => update.mutate(body)}
        onCancel={() => setEditing(false)}
        isPending={update.isPending}
      />
    );
  }

  return (
    <div className="card-paper rounded-2xl p-4">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {/* 種別バッジ + タイトル（リンク） */}
          <div className="flex items-start gap-2 flex-wrap mb-1">
            {typeLabel && (
              <span
                className="text-xs px-2 py-0.5 rounded-full shrink-0 mt-0.5"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}
              >
                {typeLabel}
              </span>
            )}
            <Link
              to={`/events/${ev.id}`}
              className="font-semibold text-sm leading-snug flex-1 underline underline-offset-2"
              style={{ color: "var(--color-ink-800)" }}
            >
              {ev.title}
            </Link>
          </div>

          {/* 作成者 */}
          {creatorLabel && (
            <p className="text-xs mb-1" style={{ color: "var(--color-ink-400)" }}>
              作成:{" "}
              <span style={{ color: isOwner ? "var(--color-brand)" : "var(--color-ink-500)" }}>
                {creatorLabel}
              </span>
            </p>
          )}

          {/* 説明 */}
          {ev.description && (
            <p className="text-xs mt-1 line-clamp-2" style={{ color: "var(--color-ink-500)" }}>
              {ev.description}
            </p>
          )}

          {/* 対象メンバー */}
          {relatedMembers.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {relatedMembers.map((m) => (
                <Link
                  key={m.id}
                  to={`/members/${m.id}`}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full underline underline-offset-2"
                  style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}
                >
                  {m.emoji} {m.name}
                </Link>
              ))}
            </div>
          )}

          {/* 有効期間 */}
          <p className="text-xs mt-1.5 flex items-center gap-1" style={{ color: "var(--color-ink-400)" }}>
            <Calendar size={11} />
            {fmtDate(ev.startsAt)}
            {ev.endsAt ? ` 〜 ${fmtDate(ev.endsAt)}` : "（期限なし）"}
          </p>

          {/* 完了ボタン or 完了済みバッジ */}
          {hasOnComplete && (
            <div className="mt-2">
              {ev.myParticipated ? (
                <span
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: "rgba(90,140,92,0.12)", color: "var(--color-success)" }}
                >
                  <Check size={10} /> 実施済み{effectivePointValue > 0 ? `（+${effectivePointValue}pt）` : ""}
                </span>
              ) : (
                <button
                  onClick={() => participate.mutate()}
                  disabled={participate.isPending}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-2xl font-medium text-white disabled:opacity-50"
                  style={{ background: "var(--color-success)" }}
                >
                  {participate.isPending ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : effectivePointValue > 0 ? (
                    `✅ アクションを実施する（+${effectivePointValue}pt）`
                  ) : (
                    "✅ アクションを実施する"
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        {/* 編集・終了・削除ボタン */}
        {canEdit && (
          <div className="flex gap-1 shrink-0">
            <button
              onClick={() => setEditing(true)}
              title="編集"
              className="p-1.5 rounded-xl hover:opacity-70"
              style={{ background: "var(--color-paper-200)", color: "var(--color-ink-500)" }}
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={() => {
                if (window.confirm(`「${ev.title}」を終了しますか？`)) update.mutate({ status: "ended" });
              }}
              title="終了"
              className="p-1.5 rounded-xl hover:opacity-70"
              style={{ background: "rgba(212,160,59,0.1)", color: "var(--color-accent)" }}
            >
              <StopCircle size={13} />
            </button>
            <button
              onClick={() => {
                if (window.confirm(`「${ev.title}」を削除しますか？`)) update.mutate({ status: "deleted" });
              }}
              title="削除"
              className="p-1.5 rounded-xl hover:opacity-70"
              style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- 新規イベント作成モーダル ----
function CreateEventModal({
  typeDef, onClose, onSuccess,
}: {
  typeDef: EventTypeDef;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [title, setTitle] = useState(typeDef.name);
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState(todayStr());
  const [endsAt, setEndsAt] = useState("");
  const [multiplier, setMultiplier] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const needsTarget = typeDef.requiresTargetMember === 1;

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ["members"],
    queryFn: () => api.get<MembersResponse>("/members"),
    enabled: needsTarget,
    staleTime: 60_000,
  });

  const allMembers = membersData?.data ?? [];
  const filtered = allMembers.filter((m) => !search || m.name.includes(search) || m.emoji.includes(search));

  function toggleMember(id: string) {
    setSelectedMemberIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const create = useMutation({
    mutationFn: () => {
      if (!endsAt) throw new Error("終了日を設定してください");
      if (needsTarget && selectedMemberIds.length === 0) throw new Error("対象メンバーを選択してください");
      return api.post("/events/instances", {
        typeDefId: typeDef.id,
        title: title.trim() || typeDef.name,
        description: description.trim() || undefined,
        startsAt: startsAt ? Math.floor(new Date(startsAt).getTime() / 1000) : undefined,
        endsAt: Math.floor(new Date(endsAt).getTime() / 1000),
        ...(needsTarget && { relatedMemberIds: selectedMemberIds }),
        ...(typeDef.pointValue > 0 && multiplier && { multiplier: Number(multiplier) }),
      });
    },
    onSuccess,
    onError: (e: Error) => setError(e.message),
  });

  const canSubmit = title.trim() && endsAt && (!needsTarget || selectedMemberIds.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl max-h-[90dvh] flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}>
        {/* ヘッダー */}
        <div className="flex items-center justify-between shrink-0">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            {typeDef.emoji} {typeDef.name}を登録する
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-full" style={{ background: "var(--color-paper-200)" }}>
            <X size={15} style={{ color: "var(--color-ink-500)" }} />
          </button>
        </div>

        {/* 種別ポイント情報 */}
        <div className="shrink-0">
          <TypeInfoPanel typeDef={typeDef} />
        </div>

        {/* スクロールエリア */}
        <div className="overflow-y-auto flex-1 space-y-3 -mx-1 px-1">
          {/* タイトル */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
              タイトル <span style={{ color: "var(--color-brand)" }}>*</span>
            </label>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }} />
          </div>

          {/* 説明 */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>説明（任意）</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="内容や目的を入力" rows={10}
              className="w-full px-3 py-2 rounded-xl border text-sm resize-y"
              style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }} />
          </div>

          {/* 有効期間 */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-ink-600)" }}>
              有効期間 <span style={{ color: "var(--color-brand)" }}>*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs mb-1" style={{ color: "var(--color-ink-400)" }}>開始日</p>
                <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
                  className="w-full px-2 py-2 rounded-xl border text-sm"
                  style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }} />
              </div>
              <div>
                <p className="text-xs mb-1" style={{ color: "var(--color-ink-400)" }}>
                  終了日 <span style={{ color: "var(--color-brand)" }}>*</span>
                </p>
                <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
                  className="w-full px-2 py-2 rounded-xl border text-sm"
                  style={{
                    borderColor: endsAt ? "var(--color-paper-300)" : "rgba(181,56,75,0.4)",
                    background: "var(--color-paper-50)",
                  }} />
              </div>
            </div>
          </div>

          {/* 加算ポイント */}
          {typeDef.pointValue > 0 && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
                加算ポイント <span className="font-normal" style={{ color: "var(--color-ink-400)" }}>（任意・空欄=なし）</span>
              </label>
              <input
                type="number" min={0} value={multiplier}
                onChange={(e) => setMultiplier(e.target.value)}
                placeholder="例: 3"
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
              />
            </div>
          )}

          {/* 対象メンバー（複数選択） */}
          {needsTarget && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
                対象メンバー <span className="font-normal">（複数選択可）</span>
                <span style={{ color: "var(--color-brand)" }}> *</span>
                {selectedMemberIds.length > 0 && (
                  <span className="ml-1 font-bold" style={{ color: "var(--color-brand)" }}>
                    {selectedMemberIds.length}名選択中
                  </span>
                )}
              </label>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="名前で絞り込む"
                className="w-full px-3 py-2 rounded-xl border text-sm mb-2"
                style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }} />
              <div className="max-h-44 overflow-y-auto space-y-1 rounded-xl p-2"
                style={{ background: "var(--color-paper-200)" }}>
                {membersLoading ? (
                  <div className="flex justify-center py-4">
                    <Loader2 size={18} className="animate-spin" style={{ color: "var(--color-brand)" }} />
                  </div>
                ) : filtered.map((m) => (
                  <button key={m.id} onClick={() => toggleMember(m.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition hover:opacity-80"
                    style={{
                      background: selectedMemberIds.includes(m.id) ? "rgba(181,56,75,0.12)" : "transparent",
                      border: selectedMemberIds.includes(m.id) ? "1.5px solid rgba(181,56,75,0.3)" : "1.5px solid transparent",
                    }}>
                    <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-lg ${m.bgColor}`}>{m.emoji}</span>
                    <span className="flex-1 text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>{m.name}</span>
                    {selectedMemberIds.includes(m.id) && <Check size={14} style={{ color: "var(--color-brand)" }} />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-center shrink-0" style={{ color: "var(--color-brand)" }}>{error}</p>}

        <button
          onClick={() => create.mutate()}
          disabled={!canSubmit || create.isPending}
          className="shrink-0 w-full py-3 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: "var(--color-brand)" }}>
          {create.isPending ? <Loader2 size={14} className="animate-spin" /> : `${typeDef.emoji} 登録する`}
        </button>
      </div>
    </div>
  );
}

// ---- メイン画面 ----
export function EventsScreen() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [createTypeId, setCreateTypeId] = useState<string | null>(null);

  const { data: eventsData, isLoading: eventsLoading, refetch } = useQuery({
    queryKey: ["events", "active"],
    queryFn: () => api.get<ActiveEventsResponse>("/events/active"),
    enabled: !!user,
  });

  const { data: typesData } = useQuery({
    queryKey: ["events", "types"],
    queryFn: () => api.get<EventTypesResponse>("/events/types"),
    enabled: !!user,
  });

  const allEvents = eventsData?.data ?? [];
  // ミーティング連携イベントを除外したフラットリスト
  const displayEvents = allEvents.filter((ev) => !ev.linksToMeeting);

  const memberTypes = (typesData?.data ?? []).filter((t) => !t.linksToMeeting) as EventTypeDef[];
  const createTypeForModal = memberTypes.find((t) => t.id === createTypeId);
  const editableTypeIds = new Set(memberTypes.map((t) => t.id));

  // 種別マップ（表示用フォールバック）
  const eventTypeMap = new Map<string, EventTypeDef>();
  for (const t of (typesData?.data ?? []) as EventTypeDef[]) {
    eventTypeMap.set(t.id, t);
  }

  function onRefresh() {
    qc.invalidateQueries({ queryKey: ["events", "active"] });
    refetch();
  }

  return (
    <div className="px-4 py-6 pb-24 max-w-xl mx-auto lg:max-w-none">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            📣 イベント
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-500)" }}>
            開催中のイベントに参加しよう
          </p>
        </div>
      </div>

      {/* 作成ボタン */}
      {memberTypes.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {memberTypes.map((t) => (
            <button
              key={t.id}
              onClick={() => setCreateTypeId(t.id)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-medium transition hover:opacity-80"
              style={{ background: "rgba(181,56,75,0.1)", color: "var(--color-brand)" }}
            >
              <Plus size={14} />
              {t.emoji} {t.name}を登録する
            </button>
          ))}
        </div>
      )}

      {/* ローディング */}
      {eventsLoading && (
        <div className="flex justify-center py-12">
          <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-brand)" }} />
        </div>
      )}

      {/* 空状態 */}
      {!eventsLoading && displayEvents.length === 0 && (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">📣</p>
          <p style={{ color: "var(--color-ink-400)" }}>現在開催中のイベントはありません</p>
        </div>
      )}

      {/* フラットリスト */}
      {displayEvents.length > 0 && (
        <div className="space-y-3">
          {displayEvents.map((ev) => (
            <EventFlatItem
              key={ev.id}
              event={ev}
              userId={user?.id ?? ""}
              typeDef={ev.eventTypeDefId ? (eventTypeMap.get(ev.eventTypeDefId) ?? null) : null}
              memberTypes={memberTypes}
              editableTypeIds={editableTypeIds}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}

      {/* 作成モーダル */}
      {createTypeForModal && (
        <CreateEventModal
          typeDef={createTypeForModal}
          onClose={() => setCreateTypeId(null)}
          onSuccess={() => {
            setCreateTypeId(null);
            onRefresh();
          }}
        />
      )}
    </div>
  );
}
