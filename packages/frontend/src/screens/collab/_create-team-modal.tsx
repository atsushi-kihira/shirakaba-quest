// =============================================================
// 協働チーム作成モーダル（緩いチーム / パワーチーム宣言）
// =============================================================
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ActivityPostPrompt } from "@/components/activity-post-prompt";

type CandidateMember = { id: string; name: string; emoji: string; bgColor: string };

export function CreateCollabTeamModal({
  candidateMembers,
  initialMode = "loose",
  onClose,
}: {
  candidateMembers: CandidateMember[];
  initialMode?: "loose" | "power";
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"loose" | "power">(initialMode);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [createdTeamId, setCreatedTeamId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      if (mode === "loose") {
        return api.post<{ data: { id: string } }>("/collab/teams", { name: name.trim(), memberIds: selected });
      }
      return api.post<{ data: { id: string } }>("/collab/teams/declare", { name: name.trim(), memberIds: selected });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["collab", "graph"] });
      setCreatedTeamId(res.data.id);
    },
    onError: (e: Error) => setError(e.message || "作成に失敗しました"),
  });

  if (createdTeamId) {
    return (
      <ActivityPostPrompt
        title={`🎉 「${name.trim()}」を結成しました！`}
        description="協働マップの活動タイムラインに、チーム結成のお知らせを投稿しませんか？"
        contextType="team"
        teamId={createdTeamId}
        suggestedBody={`新しく「${name.trim()}」を結成しました！`}
        onClose={onClose}
      />
    );
  }

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("チーム名を入力してください"); return; }
    if (mode === "loose" && selected.length < 1) {
      setError("緩いチームは自分を含め2名以上必要です。あと1名選んでください");
      return;
    }
    if (mode === "power" && selected.length < 1) {
      setError("パワーチームには他のメンバーを1名以上選んでください");
      return;
    }
    create.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="card-paper p-5 w-full max-w-sm rounded-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          協働チームを作る
        </h2>

        <div className="flex gap-2 mb-4">
          <button onClick={() => setMode("loose")}
            className="flex-1 py-2 rounded-2xl text-sm font-medium transition"
            style={{ background: mode === "loose" ? "var(--color-brand)" : "var(--color-paper-200)", color: mode === "loose" ? "white" : "var(--color-ink-600)" }}>
            🌿 緩いチーム
          </button>
          <button onClick={() => setMode("power")}
            className="flex-1 py-2 rounded-2xl text-sm font-medium transition"
            style={{ background: mode === "power" ? "var(--color-brand)" : "var(--color-paper-200)", color: mode === "power" ? "white" : "var(--color-ink-600)" }}>
            ⚡ パワーチーム宣言
          </button>
        </div>

        <p className="text-xs mb-3" style={{ color: "var(--color-ink-400)" }}>
          {mode === "loose"
            ? "自分を含め2名以上で、承諾なしにすぐチームになれます。"
            : "宣言すると、選んだメンバーに承諾確認が届きます。全員が承諾すると成立します。"}
        </p>

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>チーム名 *</label>
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="例: 新規開拓プロジェクト"
          className="w-full px-3 py-2 rounded-xl border text-sm mb-4"
          style={{ borderColor: "var(--color-paper-300)" }} />

        <label className="block text-xs font-medium mb-2" style={{ color: "var(--color-ink-600)" }}>
          メンバーを選ぶ（{selected.length}名選択中）
        </label>
        <div className="max-h-52 overflow-y-auto space-y-1 rounded-xl p-2 mb-4" style={{ background: "var(--color-paper-200)" }}>
          {candidateMembers.map((m) => (
            <label key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:opacity-80">
              <input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} />
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 ${m.bgColor}`}>{m.emoji}</span>
              <span className="text-sm" style={{ color: "var(--color-ink-700)" }}>{m.name}</span>
            </label>
          ))}
        </div>

        {error && <p className="text-xs mb-3" style={{ color: "var(--color-brand)" }}>{error}</p>}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl text-sm"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>キャンセル</button>
          <button onClick={handleSubmit} disabled={create.isPending}
            className="flex-1 py-2.5 rounded-2xl text-sm text-white disabled:opacity-50"
            style={{ background: "var(--color-brand)" }}>
            {mode === "loose" ? "作成する" : "宣言する"}
          </button>
        </div>
      </div>
    </div>
  );
}
