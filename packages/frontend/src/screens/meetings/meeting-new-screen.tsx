// =============================================================
// ミーティング新規作成画面
// =============================================================
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Loader2, ChevronLeft } from "lucide-react";
import { api } from "@/lib/api";

type Team = { id: string; name: string; emblemEmoji: string };
type Member = { id: string; name: string; emoji: string; bgColor: string };
type TeamsResponse = { data: Team[] };
type MembersResponse = { data: Member[] };

type Candidate = {
  date: string;  // YYYY-MM-DD
  time: string;  // HH:MM (optional)
  endTime: string;
};

function toUnixTimestamp(date: string, time: string): number {
  const dt = time ? new Date(`${date}T${time}:00`) : new Date(`${date}T00:00:00`);
  return Math.floor(dt.getTime() / 1000);
}

function emptyCandidate(): Candidate {
  return { date: "", time: "", endTime: "" };
}

export function MeetingNewScreen() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"all" | "team" | "selected">("all");
  const [teamId, setTeamId] = useState("");
  const [inviteeIds, setInviteeIds] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([emptyCandidate()]);
  const [error, setError] = useState("");

  const { data: teamsData } = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.get<TeamsResponse>("/teams"),
    enabled: scope === "team",
  });

  const { data: membersData } = useQuery({
    queryKey: ["members"],
    queryFn: () => api.get<MembersResponse>("/members"),
    enabled: scope === "selected",
  });

  const createMutation = useMutation({
    mutationFn: (body: object) => api.post<{ data: { id: string } }>("/meetings", body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
      navigate(`/meetings/${res.data.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  function addCandidate() {
    setCandidates([...candidates, emptyCandidate()]);
  }

  function removeCandidate(i: number) {
    setCandidates(candidates.filter((_, idx) => idx !== i));
  }

  function updateCandidate(i: number, field: keyof Candidate, value: string) {
    setCandidates(candidates.map((c, idx) => idx === i ? { ...c, [field]: value } : c));
  }

  function toggleInvitee(id: string) {
    setInviteeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handleSubmit() {
    setError("");
    if (!title.trim()) { setError("タイトルを入力してください"); return; }
    const validCandidates = candidates.filter((c) => c.date);
    if (validCandidates.length === 0) { setError("候補日を1つ以上設定してください"); return; }
    if (scope === "team" && !teamId) { setError("チームを選択してください"); return; }
    if (scope === "selected" && inviteeIds.length === 0) { setError("招待するメンバーを選択してください"); return; }

    createMutation.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      scope,
      teamId: scope === "team" ? teamId : undefined,
      inviteeIds: scope === "selected" ? inviteeIds : undefined,
      candidates: validCandidates.map((c) => ({
        startsAt: toUnixTimestamp(c.date, c.time),
        endsAt: c.endTime ? toUnixTimestamp(c.date, c.endTime) : undefined,
      })),
    });
  }

  const teams = teamsData?.data ?? [];
  const members = (membersData?.data ?? []) as Member[];

  return (
    <div className="px-4 py-6 pb-24 max-w-xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => navigate(-1)} className="p-2 rounded-2xl hover:opacity-70"
          style={{ background: "var(--color-paper-200)" }}>
          <ChevronLeft size={18} style={{ color: "var(--color-ink-600)" }} />
        </button>
        <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          ミーティングを立てる
        </h1>
      </div>

      <div className="space-y-5">
        {/* タイトル */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
            タイトル <span style={{ color: "var(--color-brand)" }}>*</span>
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例：6月の定例ランチ会"
            className="w-full px-4 py-3 rounded-2xl text-sm outline-none border transition"
            style={{
              background: "var(--color-paper-50)",
              borderColor: "var(--color-paper-300)",
              color: "var(--color-ink-900)",
            }}
          />
        </div>

        {/* 説明 */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
            説明（任意）
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="場所や目的など補足情報を入力"
            rows={3}
            className="w-full px-4 py-3 rounded-2xl text-sm outline-none border transition resize-none"
            style={{
              background: "var(--color-paper-50)",
              borderColor: "var(--color-paper-300)",
              color: "var(--color-ink-900)",
            }}
          />
        </div>

        {/* 対象者 */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
            対象者
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["all", "team", "selected"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className="py-2 rounded-2xl text-sm font-medium transition"
                style={{
                  background: scope === s ? "var(--color-brand)" : "var(--color-paper-200)",
                  color: scope === s ? "white" : "var(--color-ink-600)",
                }}
              >
                {s === "all" ? "全員" : s === "team" ? "チーム" : "指定"}
              </button>
            ))}
          </div>

          {scope === "team" && (
            <div className="mt-3">
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl text-sm outline-none border"
                style={{
                  background: "var(--color-paper-50)",
                  borderColor: "var(--color-paper-300)",
                  color: "var(--color-ink-900)",
                }}
              >
                <option value="">チームを選択...</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.emblemEmoji} {t.name}</option>
                ))}
              </select>
            </div>
          )}

          {scope === "selected" && (
            <div className="mt-3 space-y-1.5 max-h-60 overflow-y-auto">
              {members.map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-2xl cursor-pointer transition"
                  style={{
                    background: inviteeIds.includes(m.id) ? "rgba(181,56,75,0.08)" : "var(--color-paper-200)",
                    border: inviteeIds.includes(m.id) ? "1.5px solid rgba(181,56,75,0.3)" : "1.5px solid transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={inviteeIds.includes(m.id)}
                    onChange={() => toggleInvitee(m.id)}
                    className="sr-only"
                  />
                  <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-lg ${m.bgColor}`}>
                    {m.emoji}
                  </span>
                  <span className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>{m.name}</span>
                  {inviteeIds.includes(m.id) && <span className="ml-auto text-xs" style={{ color: "var(--color-brand)" }}>✓</span>}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* 候補日 */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-ink-700)" }}>
            候補日 <span style={{ color: "var(--color-brand)" }}>*</span>
          </label>
          <div className="space-y-2">
            {candidates.map((cand, i) => (
              <div key={i} className="card-paper rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium" style={{ color: "var(--color-ink-500)" }}>
                    候補 {i + 1}
                  </span>
                  {candidates.length > 1 && (
                    <button onClick={() => removeCandidate(i)} className="ml-auto p-1 rounded-xl hover:opacity-70"
                      style={{ color: "var(--color-ink-400)" }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="date"
                    value={cand.date}
                    onChange={(e) => updateCandidate(i, "date", e.target.value)}
                    className="col-span-3 sm:col-span-1 px-3 py-2 rounded-xl text-sm outline-none border"
                    style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
                  />
                  <input
                    type="time"
                    value={cand.time}
                    onChange={(e) => updateCandidate(i, "time", e.target.value)}
                    placeholder="開始時刻"
                    className="col-span-3 sm:col-span-1 px-3 py-2 rounded-xl text-sm outline-none border"
                    style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
                  />
                  <input
                    type="time"
                    value={cand.endTime}
                    onChange={(e) => updateCandidate(i, "endTime", e.target.value)}
                    placeholder="終了時刻"
                    className="col-span-3 sm:col-span-1 px-3 py-2 rounded-xl text-sm outline-none border"
                    style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
                  />
                </div>
              </div>
            ))}

            <button
              onClick={addCandidate}
              className="w-full py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-2 transition hover:opacity-80"
              style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
            >
              <Plus size={15} />
              候補日を追加
            </button>
          </div>
        </div>

        {/* エラー */}
        {error && (
          <p className="text-sm text-center px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>
            {error}
          </p>
        )}

        {/* 作成ボタン */}
        <button
          onClick={handleSubmit}
          disabled={createMutation.isPending}
          className="w-full py-4 rounded-2xl text-base font-medium text-white flex items-center justify-center gap-2 transition disabled:opacity-50"
          style={{ background: "var(--color-brand)" }}
        >
          {createMutation.isPending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            "📅 ミーティングを作成する"
          )}
        </button>
      </div>
    </div>
  );
}
