// =============================================================
// 管理画面 — イベント管理（2層アーキテクチャ統合ビュー）
// Layer 1: イベント種別定義（type defs）をセクション見出しとして表示
// Layer 2: 各種別に紐づくインスタンス（campaigns）を一覧表示
// =============================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ChevronDown, ChevronUp, Pencil, Check, X, Trash2, RotateCcw, StopCircle } from "lucide-react";
import { api } from "@/lib/api";
import type { EventTypeDefinition } from "@shared/types";

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
  pointAwardTiming: string | null;
  allowRepeat: number;
  status: "active" | "ended" | "deleted";
  createdByMemberId: string | null;
  createdAt: number;
};

type Member = { id: string; name: string; emoji: string; bgColor?: string; status: string };
type TypeDefsResponse = { data: EventTypeDefinition[] };
type InstancesResponse = { data: Instance[] };
type MembersResponse = { data: Member[] };
type TeamForPicker = { id: string; name: string; emblemEmoji: string; members: { memberId: string }[] };
type TeamsForPickerResponse = { data: TeamForPicker[] };

function toDateInput(ts: number | null | undefined): string {
  if (!ts) return "";
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("ja-JP");
}

// ---- 管理者用メンバーピッカー（全員 / チーム タブ＋全選択）----
function AdminMemberPickerWithTabs({
  members,
  selectedIds,
  onChange,
}: {
  members: Member[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [activeTab, setActiveTab] = useState<"all" | "team">("all");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [search, setSearch] = useState("");

  const { data: teamsData } = useQuery({
    queryKey: ["admin", "teams"],
    queryFn: () => api.get<TeamsForPickerResponse>("/admin/teams"),
    staleTime: 60_000,
    enabled: activeTab === "team",
  });

  const activeMembers = members.filter((m) => m.status === "active");
  const teams = teamsData?.data ?? [];

  const teamFiltered = (() => {
    if (activeTab !== "team") return activeMembers;
    if (!selectedTeamId) return activeMembers;
    const t = teams.find((t) => t.id === selectedTeamId);
    if (!t) return [];
    const ids = new Set(t.members.map((m) => m.memberId));
    return activeMembers.filter((m) => ids.has(m.id));
  })();

  const filtered = search ? teamFiltered.filter((m) => m.name.includes(search)) : teamFiltered;

  const allFilteredSelected = filtered.length > 0 && filtered.every((m) => selectedIds.includes(m.id));

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  function selectAll() {
    onChange([...new Set([...selectedIds, ...filtered.map((m) => m.id)])]);
  }

  function deselectAll() {
    const set = new Set(filtered.map((m) => m.id));
    onChange(selectedIds.filter((id) => !set.has(id)));
  }

  return (
    <div className="space-y-2">
      {/* タブ */}
      <div className="flex gap-1">
        {(["all", "team"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setSearch(""); setSelectedTeamId(""); }}
            className="flex-1 text-xs py-1.5 rounded-xl font-medium transition"
            style={{
              background: activeTab === tab ? "var(--color-brand)" : "var(--color-paper-300)",
              color: activeTab === tab ? "white" : "var(--color-ink-600)",
            }}
          >
            {tab === "all" ? "全員" : "チームで絞り込む"}
          </button>
        ))}
      </div>

      {/* チームセレクター */}
      {activeTab === "team" && (
        <select
          value={selectedTeamId}
          onChange={(e) => setSelectedTeamId(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border text-sm"
          style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
        >
          <option value="">— チームを選択 —</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.emblemEmoji} {t.name}</option>
          ))}
        </select>
      )}

      {/* 絞り込み検索 + 全選択 */}
      <div className="flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="名前で絞り込む"
          className="flex-1 px-3 py-1.5 rounded-xl border text-sm"
          style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)" }}
        />
        <button
          onClick={allFilteredSelected ? deselectAll : selectAll}
          disabled={filtered.length === 0}
          className="px-3 py-1.5 rounded-xl text-xs font-medium shrink-0 transition disabled:opacity-40"
          style={{
            background: allFilteredSelected ? "rgba(181,56,75,0.12)" : "var(--color-paper-200)",
            color: allFilteredSelected ? "var(--color-brand)" : "var(--color-ink-600)",
            border: allFilteredSelected ? "1.5px solid rgba(181,56,75,0.3)" : "1.5px solid transparent",
          }}
        >
          {allFilteredSelected ? "全解除" : "全選択"}
        </button>
      </div>

      {/* 選択中カウント */}
      {selectedIds.length > 0 && (
        <p className="text-xs font-semibold" style={{ color: "var(--color-brand)" }}>
          {selectedIds.length}名選択中
        </p>
      )}

      {/* メンバーリスト */}
      <div
        className="max-h-44 overflow-y-auto space-y-1 rounded-xl p-2"
        style={{ background: "var(--color-paper-200)" }}
      >
        {filtered.length === 0 ? (
          <p className="text-xs text-center py-4" style={{ color: "var(--color-ink-400)" }}>
            {activeTab === "team" && !selectedTeamId ? "チームを選択してください" : "メンバーが見つかりません"}
          </p>
        ) : (
          filtered.map((m) => (
            <label
              key={m.id}
              className="flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded-lg hover:opacity-80 transition"
              style={{ background: selectedIds.includes(m.id) ? "rgba(181,56,75,0.1)" : "transparent" }}
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(m.id)}
                onChange={() => toggle(m.id)}
                className="sr-only"
              />
              <span className="text-sm">{m.emoji} {m.name}</span>
              {selectedIds.includes(m.id) && (
                <Check size={12} className="ml-auto" style={{ color: "var(--color-brand)" }} />
              )}
            </label>
          ))
        )}
      </div>
    </div>
  );
}

// ---- 種別ごとのセクション ----
function TypeDefSection({
  typeDef,
  allTypeDefs,
  instances,
  members,
  onRefresh,
}: {
  typeDef: EventTypeDefinition;
  allTypeDefs: EventTypeDefinition[];
  instances: Instance[];
  members: Member[];
  onRefresh: () => void;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [showEnded, setShowEnded] = useState(false);

  // 種別の有効/無効切り替え
  const toggleTypeDef = useMutation({
    mutationFn: (isActive: boolean) =>
      api.patch(`/admin/event-type-definitions/${typeDef.id}`, { isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "event-type-definitions"] });
    },
  });

  // インスタンス操作
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
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left transition hover:opacity-80"
        style={{ background: typeDef.isActive ? "transparent" : "var(--color-paper-200)" }}
      >
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
              <span className="text-xs px-1.5 py-0.5 rounded-full"
                style={{ background: "var(--color-paper-300)", color: "var(--color-ink-500)" }}>
                システム
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
            {!typeDef.isActive && (
              <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                style={{ background: "var(--color-paper-300)", color: "var(--color-ink-400)" }}>
                無効
              </span>
            )}
          </div>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-400)" }}>
            {activeInstances.length}件実施中
            {endedInstances.length > 0 && ` · ${endedInstances.length}件終了`}
            {deletedInstances.length > 0 && ` · ${deletedInstances.length}件削除済み`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* 有効/無効トグル（システム種別は名前等のみ編集可だが有効化は可） */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleTypeDef.mutate(!typeDef.isActive);
            }}
            disabled={toggleTypeDef.isPending}
            className="text-xs px-2.5 py-1 rounded-xl transition disabled:opacity-50"
            style={{
              background: typeDef.isActive ? "rgba(90,140,92,0.12)" : "var(--color-paper-300)",
              color: typeDef.isActive ? "var(--color-success)" : "var(--color-ink-500)",
            }}
          >
            {typeDef.isActive ? "有効" : "再開"}
          </button>
          {expanded ? <ChevronUp size={16} style={{ color: "var(--color-ink-400)" }} /> : <ChevronDown size={16} style={{ color: "var(--color-ink-400)" }} />}
        </div>
      </button>

      {/* セクション本体 */}
      {expanded && (
        <div className="px-5 pb-4 space-y-3 border-t" style={{ borderColor: "var(--color-paper-300)" }}>
          {typeDef.description && (
            <p className="text-xs pt-3" style={{ color: "var(--color-ink-500)" }}>{typeDef.description}</p>
          )}

          {/* ミーティング連携の場合は管理画面から直接インスタンス作成しない */}
          {isMeetingLinked ? (
            <p className="text-xs py-2 px-3 rounded-xl"
              style={{ background: "rgba(212,160,59,0.1)", color: "var(--color-ink-600)" }}>
              ☕ インスタンスはミーティング作成時に種別を選択することで紐づきます。<br />
              ミーティング管理画面で確認・編集できます。
            </p>
          ) : (
            <>
              {/* 管理者作成タイプの新規作成ボタン */}
              {isAdminCreator && !showCreate && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-3 flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-medium transition hover:opacity-80"
                  style={{ background: "var(--color-brand)", color: "white" }}
                >
                  <Plus size={14} />
                  新しいイベントを作成する
                </button>
              )}

              {/* 新規作成フォーム */}
              {showCreate && (
                <CreateInstanceForm
                  typeDef={typeDef}
                  members={members}
                  onDone={() => { setShowCreate(false); onRefresh(); }}
                  onCancel={() => setShowCreate(false)}
                />
              )}

              {/* アクティブインスタンス */}
              {activeInstances.length === 0 && !showCreate && (
                <p className="text-xs py-2" style={{ color: "var(--color-ink-300)" }}>
                  {isAdminCreator ? "実施中のイベントはありません" : "メンバーが作成したイベントはありません"}
                </p>
              )}
              {activeInstances.map((inst) =>
                editId === inst.id ? (
                  <EditInstanceForm
                    key={inst.id}
                    instance={inst}
                    members={members}
                    typeDef={typeDef}
                    allTypeDefs={allTypeDefs}
                    onSave={(body) => updateInstance.mutate({ id: inst.id, body })}
                    onCancel={() => setEditId(null)}
                    isPending={updateInstance.isPending}
                  />
                ) : (
                  <InstanceCard
                    key={inst.id}
                    instance={inst}
                    members={members}
                    onEdit={() => setEditId(inst.id)}
                    onEnd={() => {
                      if (window.confirm(`「${inst.title}」を終了しますか？`)) {
                        updateInstance.mutate({ id: inst.id, body: { status: "ended" } });
                      }
                    }}
                    onDelete={() => {
                      if (window.confirm(`「${inst.title}」を削除しますか？`)) {
                        deleteInstance.mutate(inst.id);
                      }
                    }}
                    onRestore={null}
                  />
                )
              )}

              {/* 終了済みインスタンス */}
              {endedInstances.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowEnded((v) => !v)}
                    className="flex items-center gap-1.5 text-xs py-1"
                    style={{ color: "var(--color-ink-400)" }}
                  >
                    {showEnded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    終了済み（{endedInstances.length}件）
                  </button>
                  {showEnded && endedInstances.map((inst) =>
                    editId === inst.id ? (
                      <EditInstanceForm
                        key={inst.id}
                        instance={inst}
                        members={members}
                        typeDef={typeDef}
                        allTypeDefs={allTypeDefs}
                        onSave={(body) => updateInstance.mutate({ id: inst.id, body })}
                        onCancel={() => setEditId(null)}
                        isPending={updateInstance.isPending}
                      />
                    ) : (
                      <InstanceCard
                        key={inst.id}
                        instance={inst}
                        members={members}
                        onEdit={() => setEditId(inst.id)}
                        onEnd={null}
                        onDelete={() => {
                          if (window.confirm(`「${inst.title}」を削除しますか？`)) {
                            deleteInstance.mutate(inst.id);
                          }
                        }}
                        onRestore={() => updateInstance.mutate({ id: inst.id, body: { status: "active" } })}
                      />
                    )
                  )}
                </div>
              )}

              {/* 削除済みインスタンス */}
              {deletedInstances.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowDeleted((v) => !v)}
                    className="flex items-center gap-1.5 text-xs py-1"
                    style={{ color: "var(--color-ink-300)" }}
                  >
                    {showDeleted ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    削除済み（{deletedInstances.length}件）
                  </button>
                  {showDeleted && deletedInstances.map((inst) => (
                    <InstanceCard
                      key={inst.id}
                      instance={inst}
                      members={members}
                      onEdit={null}
                      onEnd={null}
                      onDelete={null}
                      onRestore={() => updateInstance.mutate({ id: inst.id, body: { status: "active" } })}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---- インスタンスカード ----
function InstanceCard({
  instance: inst,
  members,
  onEdit,
  onEnd,
  onDelete,
  onRestore,
}: {
  instance: Instance;
  members: Member[];
  onEdit: (() => void) | null;
  onEnd: (() => void) | null;
  onDelete: (() => void) | null;
  onRestore: (() => void) | null;
}) {
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
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>{inst.title}</span>
          <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: style.bg, color: style.color }}>
            {style.label}
          </span>
          {inst.multiplier != null && inst.multiplier > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full"
              style={{ background: "rgba(212,160,59,0.15)", color: "var(--color-accent)" }}>
              +{inst.multiplier}pt
            </span>
          )}
          <span className="text-xs px-1.5 py-0.5 rounded-full"
            style={{
              background: inst.allowRepeat === 0 ? "var(--color-paper-300)" : "rgba(90,140,92,0.12)",
              color: inst.allowRepeat === 0 ? "var(--color-ink-500)" : "var(--color-success)",
            }}>
            {inst.allowRepeat === 0 ? "1回限り" : "繰り返し可"}
          </span>
        </div>
        {inst.description && (
          <p className="text-xs mt-0.5 truncate" style={{ color: "var(--color-ink-500)" }}>{inst.description}</p>
        )}
        {relatedNames.length > 0 && (
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-600)" }}>
            対象: {relatedNames.join("、")}
          </p>
        )}
        <div className="flex items-center gap-3 mt-0.5">
          <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
            {formatDate(inst.startsAt)}
            {inst.endsAt ? ` 〜 ${formatDate(inst.endsAt)}` : "〜"}
          </p>
          {creatorMember && (
            <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
              作成: {creatorMember.emoji} {creatorMember.name}
            </p>
          )}
          {!creatorMember && !inst.createdByMemberId && (
            <p className="text-xs" style={{ color: "var(--color-ink-300)" }}>管理者が作成</p>
          )}
        </div>
      </div>
      <div className="flex gap-1 shrink-0">
        {onEdit && (
          <button onClick={onEdit} className="p-1.5 rounded-xl hover:opacity-70"
            style={{ color: "var(--color-ink-500)", background: "var(--color-paper-50)" }}>
            <Pencil size={13} />
          </button>
        )}
        {onEnd && (
          <button onClick={onEnd} className="p-1.5 rounded-xl hover:opacity-70"
            style={{ color: "var(--color-ink-400)", background: "var(--color-paper-50)" }}
            title="終了">
            <StopCircle size={13} />
          </button>
        )}
        {onRestore && (
          <button onClick={onRestore} className="p-1.5 rounded-xl hover:opacity-70"
            style={{ color: "var(--color-success)", background: "rgba(90,140,92,0.1)" }}
            title="再開">
            <RotateCcw size={13} />
          </button>
        )}
        {onDelete && (
          <button onClick={onDelete} className="p-1.5 rounded-xl hover:opacity-70"
            style={{ color: "var(--color-brand)", background: "rgba(181,56,75,0.08)" }}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

// ---- インスタンス編集フォーム ----
function EditInstanceForm({
  instance, members, typeDef, allTypeDefs, onSave, onCancel, isPending,
}: {
  instance: Instance;
  members: Member[];
  typeDef: EventTypeDefinition;
  allTypeDefs: EventTypeDefinition[];
  onSave: (body: object) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [selectedTypeDefId, setSelectedTypeDefId] = useState(instance.eventTypeDefId ?? typeDef.id);
  const [title, setTitle] = useState(instance.title);
  const [description, setDescription] = useState(instance.description);
  const [startsAt, setStartsAt] = useState(toDateInput(instance.startsAt));
  const [endsAt, setEndsAt] = useState(toDateInput(instance.endsAt));
  const [multiplier, setMultiplier] = useState(instance.multiplier ? String(instance.multiplier) : "");
  const [selectedIds, setSelectedIds] = useState<string[]>(instance.relatedMemberIds);
  const [allowRepeat, setAllowRepeat] = useState(instance.allowRepeat !== 0);

  const currentTypeDef = allTypeDefs.find((t) => t.id === selectedTypeDefId) ?? typeDef;
  const needsTarget = currentTypeDef.requiresTargetMember === 1;
  const typeChanged = selectedTypeDefId !== (instance.eventTypeDefId ?? typeDef.id);

  return (
    <div className="mt-2 p-3 rounded-2xl space-y-2 border-2" style={{ borderColor: "var(--color-brand)", background: "var(--color-paper-50)" }}>
      {/* 種別変更 */}
      <div>
        <p className="text-xs mb-1 font-medium" style={{ color: "var(--color-ink-500)" }}>イベント種別</p>
        <select
          value={selectedTypeDefId}
          onChange={(e) => setSelectedTypeDefId(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border text-sm"
          style={{ borderColor: typeChanged ? "var(--color-accent)" : "var(--color-paper-300)" }}
        >
          {allTypeDefs.filter((t) => t.isActive || t.id === selectedTypeDefId).map((t) => (
            <option key={t.id} value={t.id}>{t.emoji} {t.name}</option>
          ))}
        </select>
        {typeChanged && (
          <p className="text-xs mt-0.5" style={{ color: "var(--color-accent)" }}>⚠ 種別が変更されます</p>
        )}
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder="タイトル"
        className="w-full px-3 py-2 rounded-xl border text-sm font-semibold"
        style={{ borderColor: "var(--color-paper-300)" }} />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)}
        placeholder="説明（任意）" rows={10}
        className="w-full px-3 py-2 rounded-xl border text-sm resize-y"
        style={{ borderColor: "var(--color-paper-300)" }} />
      {needsTarget && (
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-ink-500)" }}>対象メンバー</p>
          <AdminMemberPickerWithTabs members={members} selectedIds={selectedIds} onChange={setSelectedIds} />
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
      {currentTypeDef.pointValue > 0 && (
        <div>
          <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>加算ポイント（任意）</p>
          <input type="number" min={0} value={multiplier} onChange={(e) => setMultiplier(e.target.value)}
            placeholder="例: 3"
            className="w-full px-2 py-1.5 rounded-xl border text-sm"
            style={{ borderColor: "var(--color-paper-300)" }} />
        </div>
      )}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={allowRepeat}
          onChange={(e) => setAllowRepeat(e.target.checked)}
          className="w-4 h-4 rounded"
        />
        <span className="text-xs" style={{ color: "var(--color-ink-700)" }}>
          何度でも実施可（繰り返し可）
        </span>
      </label>
      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          <X size={12} /> キャンセル
        </button>
        <button
          onClick={() => onSave({
            typeDefId: typeChanged ? selectedTypeDefId : undefined,
            title: title.trim(),
            description: description.trim(),
            startsAt: startsAt ? Math.floor(new Date(startsAt).getTime() / 1000) : undefined,
            endsAt: endsAt ? Math.floor(new Date(endsAt).getTime() / 1000) : null,
            multiplier: multiplier ? Number(multiplier) : null,
            relatedMemberIds: needsTarget ? selectedIds : undefined,
            allowRepeat: allowRepeat ? 1 : 0,
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

// ---- インスタンス新規作成フォーム（管理者作成用） ----
function CreateInstanceForm({
  typeDef, members, onDone, onCancel,
}: {
  typeDef: EventTypeDefinition;
  members: Member[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState(toDateInput(Math.floor(Date.now() / 1000)));
  const [endsAt, setEndsAt] = useState("");
  const [multiplier, setMultiplier] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [allowRepeat, setAllowRepeat] = useState(true);

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
      allowRepeat: allowRepeat ? 1 : 0,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "events"] });
      qc.invalidateQueries({ queryKey: ["events", "active"] });
      onDone();
    },
  });

  return (
    <div className="mt-3 p-4 rounded-2xl space-y-3 border-2" style={{ borderColor: "rgba(181,56,75,0.3)", background: "var(--color-paper-50)" }}>
      <p className="text-xs font-semibold" style={{ color: "var(--color-brand)" }}>新しいイベントを作成</p>
      <input value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder={`タイトル（例: 7月${typeDef.name}）`}
        className="w-full px-3 py-2 rounded-xl border text-sm"
        style={{ borderColor: "var(--color-paper-300)" }} />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)}
        placeholder="説明（任意）" rows={10}
        className="w-full px-3 py-2 rounded-xl border text-sm resize-y"
        style={{ borderColor: "var(--color-paper-300)" }} />
      {needsTarget && (
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-ink-500)" }}>対象メンバー</p>
          <AdminMemberPickerWithTabs members={members} selectedIds={selectedIds} onChange={setSelectedIds} />
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
      {typeDef.pointValue > 0 && (
        <div>
          <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>加算ポイント（任意）</p>
          <input type="number" min={0} value={multiplier} onChange={(e) => setMultiplier(e.target.value)}
            placeholder="例: 3"
            className="w-full px-2 py-1.5 rounded-xl border text-sm"
            style={{ borderColor: "var(--color-paper-300)" }} />
        </div>
      )}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={allowRepeat}
          onChange={(e) => setAllowRepeat(e.target.checked)}
          className="w-4 h-4 rounded"
        />
        <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>
          何度でも実施可（繰り返し可）
        </span>
      </label>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex items-center gap-1 px-3 py-2 rounded-2xl text-sm"
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

// ---- メイン画面 ----
export function AdminEventsScreen() {
  const qc = useQueryClient();

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

  // インスタンスを eventTypeDefId でグループ化
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
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--color-brand)" }} />
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
            イベント種別ごとにイベントを管理します
          </p>
        </div>
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

        {/* 種別未分類インスタンス（旧データ） */}
        {uncategorized.filter((i) => i.status !== "deleted").length > 0 && (
          <div className="card-paper rounded-3xl p-4">
            <p className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink-600)" }}>
              📦 未分類イベント（旧データ）
            </p>
            {uncategorized.filter((i) => i.status !== "deleted").map((inst) => (
              <InstanceCard
                key={inst.id}
                instance={inst}
                members={members}
                onEdit={null}
                onEnd={null}
                onDelete={null}
                onRestore={null}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 card-paper p-4 rounded-2xl">
        <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
          💡 イベント種別の追加・詳細設定は「イベント種別管理」画面で行えます。
        </p>
      </div>
    </div>
  );
}
