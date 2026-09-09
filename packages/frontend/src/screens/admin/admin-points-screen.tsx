// =============================================================
// 管理画面 — ポイント管理
// 1) シーズンポイントリセット（特定シーズンの履歴を削除）
// 2) 特定ユーザーの特定の履歴を選んで削除
// 3) 過去累計のすべてをリセット（全履歴削除）
// =============================================================
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, AlertTriangle, Trash2, Search, Plus, Minus } from "lucide-react";
import { api } from "@/lib/api";
import type { Season } from "@shared/types";

type AdminMember = { id: string; name: string; emoji: string; bgColor: string; status: string };
type HistoryItem = { id: string; delta: number; label: string; detail?: string; createdAt: number };
type MemberHistoryResponse = { data: { totalPoints: number; history: HistoryItem[] } };
type MemberPointSummary = { data: { memberId: string; memberName: string; allTimePoints: number; seasonPoints: number; activeSeasonName: string | null } };

const TABS = [
  { key: "season", label: "🌸 シーズンリセット" },
  { key: "history", label: "🗑️ 履歴を選んで削除" },
  { key: "all", label: "📊 累計リセット" },
  { key: "adjust", label: "✏️ ポイント調整" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function useActiveMembers() {
  return useQuery({
    queryKey: ["admin", "members", "for-points"],
    queryFn: () => api.get<{ data: AdminMember[] }>("/admin/members"),
    select: (res) => res.data.filter((m) => m.status === "active"),
  });
}

export function AdminPointsScreen() {
  const [tab, setTab] = useState<TabKey>("season");

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-24 max-w-2xl">
      <h1 className="text-2xl font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
        💎 ポイント管理
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-ink-500)" }}>
        ポイントのリセット・履歴の削除を行います。いずれの操作も取り消せません。
      </p>

      <div className="flex gap-1.5 mb-6 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="px-3 py-1.5 rounded-2xl text-sm font-medium whitespace-nowrap transition"
            style={{ background: tab === t.key ? "var(--color-brand)" : "var(--color-paper-200)", color: tab === t.key ? "white" : "var(--color-ink-600)" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "season" && <SeasonResetPanel />}
      {tab === "history" && <HistoryDeletePanel />}
      {tab === "all" && <FullResetPanel />}
      {tab === "adjust" && <AdjustPanel />}
    </div>
  );
}

// ----------------------------------------------------------------
// 対象メンバー選択（全員 or 特定のメンバー）
// ----------------------------------------------------------------
function MemberScopePicker({ selected, onChange }: { selected: string[] | null; onChange: (v: string[] | null) => void }) {
  const { data: members } = useActiveMembers();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const list = members ?? [];
    if (!search.trim()) return list;
    return list.filter((m) => m.name.includes(search.trim()));
  }, [members, search]);

  function toggle(id: string) {
    if (selected === null) return; // "全員"モードでは個別選択しない
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <div>
      <p className="text-xs font-medium mb-2" style={{ color: "var(--color-ink-600)" }}>対象メンバー</p>
      <div className="flex gap-2 mb-3">
        <button onClick={() => onChange(null)}
          className="flex-1 py-2 rounded-2xl text-sm font-medium transition"
          style={{ background: selected === null ? "var(--color-brand)" : "var(--color-paper-200)", color: selected === null ? "white" : "var(--color-ink-600)" }}>
          全員
        </button>
        <button onClick={() => onChange(selected === null ? [] : selected)}
          className="flex-1 py-2 rounded-2xl text-sm font-medium transition"
          style={{ background: selected !== null ? "var(--color-brand)" : "var(--color-paper-200)", color: selected !== null ? "white" : "var(--color-ink-600)" }}>
          特定のメンバーを選ぶ
        </button>
      </div>

      {selected !== null && (
        <div className="rounded-2xl border p-2" style={{ borderColor: "var(--color-paper-300)" }}>
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--color-ink-400)" }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="名前で絞り込み..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border text-xs" style={{ borderColor: "var(--color-paper-300)" }} />
          </div>
          <p className="text-xs mb-1.5" style={{ color: "var(--color-ink-400)" }}>{selected.length}名選択中</p>
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {filtered.map((m) => (
              <label key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:opacity-80">
                <input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} />
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 ${m.bgColor}`}>{m.emoji}</span>
                <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>{m.name}</span>
              </label>
            ))}
            {filtered.length === 0 && (
              <p className="text-xs text-center py-3" style={{ color: "var(--color-ink-400)" }}>該当するメンバーがいません</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// 1) シーズンポイントリセット
// ----------------------------------------------------------------
function SeasonResetPanel() {
  const { data: seasonsData } = useQuery({
    queryKey: ["admin", "seasons"],
    queryFn: () => api.get<{ data: Season[] }>("/admin/seasons"),
  });
  const seasons = seasonsData?.data ?? [];
  const [seasonId, setSeasonId] = useState<string>("");
  const [memberIds, setMemberIds] = useState<string[] | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [result, setResult] = useState<number | null>(null);

  const effectiveSeasonId = seasonId || seasons.find((s) => s.isActive)?.id || seasons[0]?.id || "";
  const selectedSeason = seasons.find((s) => s.id === effectiveSeasonId) ?? null;

  const reset = useMutation({
    mutationFn: () => api.post<{ deletedCount: number }>("/admin/points/reset-season", {
      seasonId: effectiveSeasonId,
      memberIds: memberIds ?? undefined,
    }),
    onSuccess: (res) => {
      setResult(res.deletedCount);
      setShowConfirm(false);
    },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
        指定したシーズンの期間に記録されたポイント獲得履歴を削除します。履歴を残したままマイナス点を積むのではなく、対象期間の履歴そのものを削除します。
      </p>

      {result !== null && (
        <div className="p-4 rounded-2xl text-sm" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
          ✅ {result}件の履歴を削除しました。
        </div>
      )}

      <div className="card-paper p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>対象シーズン</label>
          <select value={effectiveSeasonId} onChange={(e) => setSeasonId(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border text-sm" style={{ borderColor: "var(--color-paper-300)" }}>
            {seasons.length === 0 && <option value="">シーズンがありません</option>}
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.isActive ? "（アクティブ）" : ""}</option>
            ))}
          </select>
        </div>

        <MemberScopePicker selected={memberIds} onChange={setMemberIds} />

        <div className="p-3 rounded-2xl flex gap-2" style={{ background: "rgba(181,56,75,0.08)" }}>
          <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: "var(--color-brand)" }} />
          <p className="text-xs" style={{ color: "var(--color-brand)" }}>
            このシーズン期間のポイント獲得履歴が削除されます（累計ポイントも減ります）。この操作は取り消せません。
          </p>
        </div>

        <button onClick={() => setShowConfirm(true)} disabled={!effectiveSeasonId || (memberIds !== null && memberIds.length === 0)}
          className="w-full py-3 rounded-2xl font-semibold text-white transition hover:opacity-80 flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: "var(--color-brand)" }}>
          <RotateCcw size={16} />
          シーズンのポイントをリセットする
        </button>
      </div>

      {showConfirm && (
        <ConfirmModal
          title="シーズンのポイントをリセットしますか？"
          description={`「${selectedSeason?.name ?? ""}」の期間に記録された${memberIds === null ? "全員" : `選択した${memberIds.length}名`}の履歴を削除します。`}
          isPending={reset.isPending}
          onCancel={() => setShowConfirm(false)}
          onConfirm={() => reset.mutate()}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// 2) 特定ユーザーの特定の履歴を選んで削除
// ----------------------------------------------------------------
function HistoryDeletePanel() {
  const qc = useQueryClient();
  const { data: members } = useActiveMembers();
  const [search, setSearch] = useState("");
  const [memberId, setMemberId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [result, setResult] = useState<number | null>(null);

  const filteredMembers = useMemo(() => {
    const list = members ?? [];
    if (!search.trim()) return list;
    return list.filter((m) => m.name.includes(search.trim()));
  }, [members, search]);

  const { data: historyData, isLoading } = useQuery({
    queryKey: ["admin", "points", "history", memberId],
    queryFn: () => api.get<MemberHistoryResponse>(`/members/${memberId}/history?limit=1000`),
    enabled: !!memberId,
  });
  const history = historyData?.data.history ?? [];
  const selectedMember = members?.find((m) => m.id === memberId) ?? null;

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => api.delete<{ deletedCount: number }>("/admin/points/transactions", { ids }),
    onSuccess: (res) => {
      setResult(res.deletedCount);
      setSelected(new Set());
      setShowConfirm(false);
      qc.invalidateQueries({ queryKey: ["admin", "points", "history", memberId] });
    },
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const allSelected = history.length > 0 && history.every((h) => selected.has(h.id));
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(history.map((h) => h.id)));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
        メンバーを選び、そのメンバーのポイント獲得履歴から削除したい項目を選んで一括削除します（全項目選択も可能です）。
      </p>

      {result !== null && (
        <div className="p-4 rounded-2xl text-sm" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
          ✅ {result}件の履歴を削除しました。
        </div>
      )}

      <div className="card-paper p-4">
        <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>メンバーを選ぶ</label>
        <div className="relative mb-2">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--color-ink-400)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="名前で絞り込み..."
            className="w-full pl-8 pr-3 py-2 rounded-xl border text-sm" style={{ borderColor: "var(--color-paper-300)" }} />
        </div>
        <select value={memberId} onChange={(e) => { setMemberId(e.target.value); setSelected(new Set()); setResult(null); }}
          className="w-full px-3 py-2 rounded-xl border text-sm" style={{ borderColor: "var(--color-paper-300)" }}>
          <option value="">選択してください</option>
          {filteredMembers.map((m) => <option key={m.id} value={m.id}>{m.emoji} {m.name}</option>)}
        </select>
      </div>

      {memberId && (
        <div className="card-paper p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-ink-700)" }}>
              {selectedMember?.emoji} {selectedMember?.name}さんの履歴（{history.length}件）
            </h2>
            {history.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "var(--color-ink-500)" }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                全選択
              </label>
            )}
          </div>

          {isLoading ? (
            <p className="text-sm text-center py-6" style={{ color: "var(--color-ink-400)" }}>読み込み中...</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: "var(--color-ink-400)" }}>履歴がありません</p>
          ) : (
            <div className="max-h-96 overflow-y-auto space-y-1.5 mb-3">
              {history.map((h) => (
                <label key={h.id} className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer"
                  style={{ background: selected.has(h.id) ? "rgba(181,56,75,0.08)" : "var(--color-paper-200)" }}>
                  <input type="checkbox" checked={selected.has(h.id)} onChange={() => toggle(h.id)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm" style={{ color: "var(--color-ink-700)" }}>{h.label}{h.detail ? ` ・ ${h.detail}` : ""}</p>
                    <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
                      {new Date(h.createdAt * 1000).toLocaleString("ja-JP")}
                    </p>
                  </div>
                  <span className="text-sm font-bold shrink-0" style={{ color: h.delta >= 0 ? "var(--color-success)" : "var(--color-brand)" }}>
                    {h.delta >= 0 ? `+${h.delta}` : h.delta}
                  </span>
                </label>
              ))}
            </div>
          )}

          <button onClick={() => setShowConfirm(true)} disabled={selected.size === 0}
            className="w-full py-2.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}>
            <Trash2 size={14} />
            選択した{selected.size}件を削除する
          </button>
        </div>
      )}

      {showConfirm && (
        <ConfirmModal
          title="選択した履歴を削除しますか？"
          description={`${selectedMember?.name ?? ""}さんの履歴を${selected.size}件削除します。`}
          isPending={deleteMutation.isPending}
          onCancel={() => setShowConfirm(false)}
          onConfirm={() => deleteMutation.mutate([...selected])}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// 3) 過去累計のすべてをリセット
// ----------------------------------------------------------------
function FullResetPanel() {
  const [memberIds, setMemberIds] = useState<string[] | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [result, setResult] = useState<number | null>(null);

  const reset = useMutation({
    mutationFn: () => api.post<{ deletedCount: number }>("/admin/points/reset-all", { memberIds: memberIds ?? undefined }),
    onSuccess: (res) => {
      setResult(res.deletedCount);
      setShowConfirm(false);
    },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
        過去累計のポイント獲得履歴をすべて削除します。マイナスの取引を積むのではなく、履歴そのものを削除するため、累計ポイントは0になります。
      </p>

      {result !== null && (
        <div className="p-4 rounded-2xl text-sm" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
          ✅ {result}件の履歴を削除しました。
        </div>
      )}

      <div className="card-paper p-6 space-y-4">
        <MemberScopePicker selected={memberIds} onChange={setMemberIds} />

        <div className="p-3 rounded-2xl flex gap-2" style={{ background: "rgba(181,56,75,0.08)" }}>
          <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: "var(--color-brand)" }} />
          <p className="text-xs" style={{ color: "var(--color-brand)" }}>
            {memberIds === null ? "全メンバー" : "選択したメンバー"}の、これまでのポイント獲得履歴がすべて削除されます。この操作は取り消せません。
          </p>
        </div>

        <button onClick={() => setShowConfirm(true)} disabled={memberIds !== null && memberIds.length === 0}
          className="w-full py-3 rounded-2xl font-semibold text-white transition hover:opacity-80 flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: "var(--color-brand)" }}>
          <RotateCcw size={16} />
          累計ポイントをリセットする
        </button>
      </div>

      {showConfirm && (
        <ConfirmModal
          title="累計ポイントをリセットしますか？"
          description={`${memberIds === null ? "全メンバー" : `選択した${memberIds.length}名`}のポイント履歴をすべて削除します。`}
          isPending={reset.isPending}
          onCancel={() => setShowConfirm(false)}
          onConfirm={() => reset.mutate()}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// 4) 特定メンバーのポイントを手動で調整（加算・減算）
// ----------------------------------------------------------------
function AdjustPanel() {
  const qc = useQueryClient();
  const { data: members } = useActiveMembers();
  const [search, setSearch] = useState("");
  const [memberId, setMemberId] = useState("");
  const [deltaInput, setDeltaInput] = useState("");
  const [note, setNote] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const filteredMembers = useMemo(() => {
    const list = members ?? [];
    if (!search.trim()) return list;
    return list.filter((m) => m.name.includes(search.trim()));
  }, [members, search]);

  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ["admin", "points", "member-summary", memberId],
    queryFn: () => api.get<MemberPointSummary>(`/admin/points/member-summary/${memberId}`),
    enabled: !!memberId,
  });
  const summary = summaryData?.data ?? null;
  const selectedMember = members?.find((m) => m.id === memberId) ?? null;
  const delta = Number.parseInt(deltaInput, 10);
  const deltaValid = Number.isInteger(delta) && delta !== 0;

  const adjust = useMutation({
    mutationFn: () => api.post("/admin/points/adjust", { memberId, delta, note: note.trim() || undefined }),
    onSuccess: () => {
      setResult(`${delta >= 0 ? `+${delta}` : delta}pt 調整しました。`);
      setShowConfirm(false);
      setDeltaInput("");
      setNote("");
      qc.invalidateQueries({ queryKey: ["admin", "points", "member-summary", memberId] });
    },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
        メンバーを選び、ポイントを直接加算・減算します（マイナスの値で減算）。1件の調整履歴として記録され、累計ポイントに即座に反映されます。現在のシーズンが有効な間は、シーズンランキングにも反映されます。
      </p>

      {result !== null && (
        <div className="p-4 rounded-2xl text-sm" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
          ✅ {result}
        </div>
      )}

      <div className="card-paper p-4">
        <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>メンバーを選ぶ</label>
        <div className="relative mb-2">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--color-ink-400)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="名前で絞り込み..."
            className="w-full pl-8 pr-3 py-2 rounded-xl border text-sm" style={{ borderColor: "var(--color-paper-300)" }} />
        </div>
        <select value={memberId} onChange={(e) => { setMemberId(e.target.value); setResult(null); }}
          className="w-full px-3 py-2 rounded-xl border text-sm" style={{ borderColor: "var(--color-paper-300)" }}>
          <option value="">選択してください</option>
          {filteredMembers.map((m) => <option key={m.id} value={m.id}>{m.emoji} {m.name}</option>)}
        </select>
      </div>

      {memberId && (
        <div className="card-paper p-4 space-y-4">
          {summaryLoading ? (
            <p className="text-sm text-center py-4" style={{ color: "var(--color-ink-400)" }}>読み込み中...</p>
          ) : summary ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl p-3 text-center" style={{ background: "var(--color-paper-200)" }}>
                <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>
                  現在のシーズン{summary.activeSeasonName ? `（${summary.activeSeasonName}）` : ""}
                </p>
                <p className="text-xl font-bold" style={{ color: "var(--color-ink-800)" }}>{summary.seasonPoints}pt</p>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ background: "var(--color-paper-200)" }}>
                <p className="text-xs mb-1" style={{ color: "var(--color-ink-500)" }}>累計</p>
                <p className="text-xl font-bold" style={{ color: "var(--color-ink-800)" }}>{summary.allTimePoints}pt</p>
              </div>
            </div>
          ) : null}

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>調整するポイント数</label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setDeltaInput(String((Number.parseInt(deltaInput, 10) || 0) - 1))}
                className="p-2.5 rounded-xl shrink-0" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                <Minus size={16} />
              </button>
              <input value={deltaInput} onChange={(e) => setDeltaInput(e.target.value.replace(/[^-\d]/g, ""))}
                placeholder="例: 5 または -3"
                className="flex-1 px-3 py-2.5 rounded-xl border text-sm text-center" style={{ borderColor: "var(--color-paper-300)" }} />
              <button type="button" onClick={() => setDeltaInput(String((Number.parseInt(deltaInput, 10) || 0) + 1))}
                className="p-2.5 rounded-xl shrink-0" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
                <Plus size={16} />
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>メモ（任意・履歴に表示されます）</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：入力ミスの修正"
              className="w-full px-3 py-2 rounded-xl border text-sm" style={{ borderColor: "var(--color-paper-300)" }} />
          </div>

          <button onClick={() => setShowConfirm(true)} disabled={!deltaValid}
            className="w-full py-2.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}>
            {deltaValid && delta > 0 ? <Plus size={14} /> : <Minus size={14} />}
            {deltaValid ? `${delta >= 0 ? `+${delta}` : delta}pt 調整する` : "調整するポイント数を入力してください"}
          </button>
        </div>
      )}

      {showConfirm && (
        <ConfirmModal
          title="ポイントを調整しますか？"
          description={`${selectedMember?.name ?? ""}さんのポイントを ${delta >= 0 ? `+${delta}` : delta}pt 調整します。`}
          isPending={adjust.isPending}
          onCancel={() => setShowConfirm(false)}
          onConfirm={() => adjust.mutate()}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// 共通の確認モーダル
// ----------------------------------------------------------------
function ConfirmModal({ title, description, isPending, onCancel, onConfirm }: {
  title: string; description: string; isPending: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={() => !isPending && onCancel()}>
      <div className="card-paper p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={20} style={{ color: "var(--color-brand)" }} />
          <h3 className="font-semibold text-lg" style={{ fontFamily: "var(--font-klee)" }}>{title}</h3>
        </div>
        <p className="text-sm mb-4" style={{ color: "var(--color-ink-600)" }}>{description}</p>
        <p className="text-sm mb-4" style={{ color: "var(--color-brand)" }}>この操作は取り消せません。</p>
        <div className="flex gap-3">
          <button onClick={onCancel} disabled={isPending}
            className="flex-1 py-2.5 rounded-2xl text-sm font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            キャンセル
          </button>
          <button onClick={onConfirm} disabled={isPending}
            className="flex-1 py-2.5 rounded-2xl text-sm font-medium text-white flex items-center justify-center gap-1"
            style={{ background: "var(--color-brand)" }}>
            {isPending ? (<><RotateCcw size={14} className="animate-spin" />処理中...</>) : "実行する"}
          </button>
        </div>
      </div>
    </div>
  );
}
