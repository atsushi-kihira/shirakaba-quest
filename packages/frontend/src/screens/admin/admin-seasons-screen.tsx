// =============================================================
// 管理画面 — シーズン管理
// =============================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Play, StopCircle, Pencil, Check, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Season } from "@shared/types";

type SeasonsResponse = { data: Season[] };

export function AdminSeasonsScreen() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "seasons"],
    queryFn: () => api.get<SeasonsResponse>("/admin/seasons"),
  });

  const seasons = data?.data ?? [];

  const activate = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/seasons/${id}/activate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "seasons"] }),
  });

  const end = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/seasons/${id}/end`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "seasons"] }),
  });

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-24 max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          🌸 シーズン管理
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
        シーズンを設定するとランキングをシーズン単位でリセットできます。アクティブなシーズンは1つだけです。
      </p>

      {isLoading ? (
        <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>読み込み中...</div>
      ) : seasons.length === 0 ? (
        <div className="text-center py-12" style={{ color: "var(--color-ink-400)" }}>
          シーズンがまだありません。「新規作成」から作ってみましょう。
        </div>
      ) : (
        <div className="space-y-3">
          {seasons.map((s) => (
            <div key={s.id}>
              {editId === s.id ? (
                <EditForm season={s} onDone={() => setEditId(null)} />
              ) : (
                <div className="card-paper p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold" style={{ color: "var(--color-ink-800)" }}>{s.name}</span>
                        {s.isActive && (
                          <span className="text-xs px-2 py-0.5 rounded-full text-white font-bold"
                            style={{ background: "var(--color-success)" }}>
                            🌸 アクティブ
                          </span>
                        )}
                      </div>
                      {s.theme && (
                        <p className="text-sm mt-1" style={{ color: "var(--color-ink-600)" }}>{s.theme}</p>
                      )}
                      <p className="text-xs mt-1" style={{ color: "var(--color-ink-400)" }}>
                        {new Date(s.startsAt * 1000).toLocaleDateString("ja-JP")}
                        {" 〜 "}
                        {s.endsAt ? new Date(s.endsAt * 1000).toLocaleDateString("ja-JP") : "（終了日未設定）"}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => setEditId(s.id)}
                        className="p-2 rounded-2xl transition hover:opacity-80"
                        style={{ background: "var(--color-paper-200)" }}
                        title="編集"
                      >
                        <Pencil size={14} style={{ color: "var(--color-ink-500)" }} />
                      </button>
                      {!s.isActive && !s.endsAt && (
                        <button
                          onClick={() => activate.mutate(s.id)}
                          disabled={activate.isPending}
                          className="flex items-center gap-1 px-2 py-1.5 rounded-2xl text-xs font-medium text-white transition hover:opacity-80"
                          style={{ background: "var(--color-success)" }}
                          title="アクティブ化"
                        >
                          <Play size={12} />
                          開始
                        </button>
                      )}
                      {s.isActive && (
                        <button
                          onClick={() => end.mutate(s.id)}
                          disabled={end.isPending}
                          className="flex items-center gap-1 px-2 py-1.5 rounded-2xl text-xs font-medium text-white transition hover:opacity-80"
                          style={{ background: "var(--color-brand)" }}
                          title="シーズン終了"
                        >
                          <StopCircle size={12} />
                          終了
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

type PointConfig = {
  pointOneOnOne: string;
  pointRealCard: string;
  pointQuestNormal: string;
  pointQuestHard: string;
  pointWelcomeQuestBonus: string;
};

function PointConfigFields({ pts, onChange }: { pts: PointConfig; onChange: (key: keyof PointConfig, v: string) => void }) {
  const fields: { key: keyof PointConfig; label: string }[] = [
    { key: "pointOneOnOne",          label: "🤝 1to1完了" },
    { key: "pointRealCard",          label: "🃏 リアルカード受け取り" },
    { key: "pointQuestNormal",       label: "⚔️ 通常お題クリア" },
    { key: "pointQuestHard",         label: "🔥 難題クリア" },
    { key: "pointWelcomeQuestBonus", label: "🎉 歓迎クエストボーナス" },
  ];
  return (
    <div>
      <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-ink-600)" }}>
        💎 ポイント配分（空欄でデフォルト値を使用）
      </p>
      <div className="space-y-2">
        {fields.map(({ key, label }) => (
          <div key={key} className="flex items-center gap-2">
            <label className="flex-1 text-xs" style={{ color: "var(--color-ink-600)" }}>{label}</label>
            <input
              type="number"
              min={0}
              value={pts[key]}
              onChange={(e) => onChange(key, e.target.value)}
              placeholder="デフォルト"
              className="w-20 px-2 py-1 rounded-lg border text-sm text-center"
              style={{ borderColor: "var(--color-paper-300)" }}
            />
            <span className="text-xs" style={{ color: "var(--color-ink-400)" }}>pt</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function emptyPts(): PointConfig {
  return { pointOneOnOne: "", pointRealCard: "", pointQuestNormal: "", pointQuestHard: "", pointWelcomeQuestBonus: "" };
}

function ptsToBody(pts: PointConfig) {
  const parse = (v: string) => v.trim() === "" ? null : Number(v);
  return {
    pointOneOnOne:          parse(pts.pointOneOnOne),
    pointRealCard:          parse(pts.pointRealCard),
    pointQuestNormal:       parse(pts.pointQuestNormal),
    pointQuestHard:         parse(pts.pointQuestHard),
    pointWelcomeQuestBonus: parse(pts.pointWelcomeQuestBonus),
  };
}

// ---- 新規作成モーダル ----
function CreateModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [theme, setTheme] = useState("");
  const [pts, setPts] = useState<PointConfig>(emptyPts());

  const create = useMutation({
    mutationFn: () => api.post("/admin/seasons", { name: name.trim(), theme: theme.trim(), ...ptsToBody(pts) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "seasons"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-6 w-full max-w-md rounded-3xl overflow-y-auto" style={{ maxHeight: "90dvh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-klee)" }}>🌸 新しいシーズン</h2>
          <button onClick={onClose} className="p-1.5 rounded-full" style={{ background: "var(--color-paper-200)" }}>
            <X size={16} style={{ color: "var(--color-ink-500)" }} />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>シーズン名 *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 2026年 上期シーズン"
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{ borderColor: "var(--color-paper-300)" }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>テーマ（任意）</label>
            <textarea
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="今シーズンのテーマ・目標を入力"
              rows={3}
              className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
              style={{ borderColor: "var(--color-paper-300)" }}
            />
          </div>
          <PointConfigFields pts={pts} onChange={(key, v) => setPts((p) => ({ ...p, [key]: v }))} />
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl text-sm font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            キャンセル
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={!name.trim() || create.isPending}
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
function EditForm({ season, onDone }: { season: Season & { pointOneOnOne?: number | null; pointRealCard?: number | null; pointQuestNormal?: number | null; pointQuestHard?: number | null; pointWelcomeQuestBonus?: number | null }; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(season.name);
  const [theme, setTheme] = useState(season.theme);
  const [pts, setPts] = useState<PointConfig>({
    pointOneOnOne:          season.pointOneOnOne          != null ? String(season.pointOneOnOne)          : "",
    pointRealCard:          season.pointRealCard           != null ? String(season.pointRealCard)           : "",
    pointQuestNormal:       season.pointQuestNormal        != null ? String(season.pointQuestNormal)        : "",
    pointQuestHard:         season.pointQuestHard          != null ? String(season.pointQuestHard)          : "",
    pointWelcomeQuestBonus: season.pointWelcomeQuestBonus  != null ? String(season.pointWelcomeQuestBonus)  : "",
  });

  const save = useMutation({
    mutationFn: () => api.patch(`/admin/seasons/${season.id}`, { name: name.trim(), theme: theme.trim(), ...ptsToBody(pts) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "seasons"] });
      onDone();
    },
  });

  return (
    <div className="card-paper p-4 border-2" style={{ borderColor: "var(--color-brand)" }}>
      <div className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border text-sm font-semibold"
          style={{ borderColor: "var(--color-paper-300)" }}
        />
        <textarea
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
          style={{ borderColor: "var(--color-paper-300)" }}
        />
        <PointConfigFields pts={pts} onChange={(key, v) => setPts((p) => ({ ...p, [key]: v }))} />
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={onDone} className="flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          <X size={12} /> キャンセル
        </button>
        <button
          onClick={() => save.mutate()}
          disabled={!name.trim() || save.isPending}
          className="flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs text-white disabled:opacity-50"
          style={{ background: "var(--color-success)" }}
        >
          <Check size={12} /> 保存
        </button>
      </div>
    </div>
  );
}
